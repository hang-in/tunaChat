/**
 * tauriClient — Tauri invoke/event 기반 클라이언트.
 *
 * Rust 백엔드의 Tauri commands를 호출하고,
 * sidecar:event 이벤트를 수신하여 Zustand 스토어를 업데이트합니다.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useChatStore } from '@/store/chatStore';
import { useRunStore } from '@/store/runStore';
import { useSystemStore } from '@/store/systemStore';
import * as dbSync from '@/lib/dbSync';
import { isTauriEnv } from '@/lib/db';
import { loadAgentFile, toolsToAllowedList, parseModelString } from '@/lib/agentLoader';

type RequestParams = Record<string, unknown>;

/** Sidecar event payload (Rust → Frontend) */
interface SidecarEvent {
  id: number | null;
  event: string | null;
  data: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  error: string | null;
}

/** Track the streaming assistant message ID per request */
const streamingMsgIds = new Map<number, string>();

class TauriClient {
  private _unlisten: UnlistenFn | null = null;
  private _sidecarStarted = false;
  private _progressStartTime: number | null = null;

  /** Initialize: start sidecar and listen to events (no-op in browser dev) */
  async init(): Promise<void> {
    // Populate engine list immediately (works in both Tauri and browser dev)
    this.sendRpc('engine.list');

    if (this._sidecarStarted) return;
    if (!isTauriEnv()) return; // browser dev / e2e — skip

    this._unlisten = await listen<SidecarEvent>('sidecar:event', (e) => {
      this.handleSidecarEvent(e.payload);
    });

    try {
      await invoke('start_sidecar');
      this._sidecarStarted = true;
    } catch (err) {
      console.warn('[tauriClient] sidecar start failed:', err);
    }
  }

  /** Handle sidecar events and update Zustand stores */
  private handleSidecarEvent(payload: SidecarEvent): void {
    const { id: reqId, event: eventType, data, error } = payload;

    if (error) {
      console.error('[sidecar]', error);
      // Reset run status and finalize any streaming messages on error
      const convId = useChatStore.getState().activeConversationId;
      if (convId) {
        const chat = useChatStore.getState();
        const msgId = reqId != null ? streamingMsgIds.get(reqId) : undefined;
        if (msgId) {
          chat.editMessage(convId, msgId, `Error: ${error}`);
          chat.finalizeStreamingMessages(convId);
          if (reqId != null) streamingMsgIds.delete(reqId);
        }
        useRunStore.getState().setRunStatus(convId, 'idle');
        import('@/store/contextStore').then(({ useContextStore }) => {
          useContextStore.getState().setProgress(null);
        });
      }
      return;
    }

    if (!eventType || !data) return;

    const convId = useChatStore.getState().activeConversationId;
    if (!convId) return;

    const chat = useChatStore.getState();

    switch (eventType) {
      case 'started': {
        useRunStore.getState().setRunStatus(convId, 'running');
        // Initialize progress indicator
        const engine = (data.engine as string) || '';
        const model = (data.model as string) || '';
        import('@/store/contextStore').then(({ useContextStore }) => {
          useContextStore.getState().setProgress({
            engine, model, step: 0, elapsed: 0, actions: [],
          });
        });
        this._progressStartTime = Date.now();
        break;
      }
      case 'action': {
        const action = data.action as Record<string, unknown> | undefined;
        if (!action) break;
        const kind = action.kind as string;
        const title = action.title as string;
        const progressText = kind === 'note' ? title : `[${kind}] ${title}`;

        // Append to progressContent (rolling log) — not content
        const msgId = reqId != null ? streamingMsgIds.get(reqId) : undefined;
        if (msgId) {
          chat.updateProgress(convId, msgId, progressText);
        }

        // Update StatusStrip progress
        const phase = (action.phase as string) === 'completed' ? 'completed' as const : 'started' as const;
        const ok = action.ok as boolean | undefined;
        import('@/store/contextStore').then(({ useContextStore }) => {
          const prev = useContextStore.getState().progress;
          const elapsed = this._progressStartTime
            ? Math.round((Date.now() - this._progressStartTime) / 1000)
            : (prev?.elapsed ?? 0);
          const step = (prev?.step ?? 0) + (phase === 'started' ? 1 : 0);
          const actions = [...(prev?.actions ?? []), { tool: kind, args: title, phase, ok }];
          useContextStore.getState().setProgress({
            engine: prev?.engine ?? '',
            model: prev?.model ?? '',
            step,
            elapsed,
            actions,
          });
        });
        break;
      }
      case 'completed': {
        const answer = (data.answer as string) || '';
        let msgId = reqId != null ? streamingMsgIds.get(reqId) : undefined;

        // HMR recovery: streamingMsgIds was lost but there may be a
        // streaming assistant message in the store (created before HMR)
        if (!msgId) {
          const msgs = chat.messages[convId] || [];
          const streamingMsg = [...msgs].reverse().find(m => m.role === 'assistant' && m.status === 'streaming');
          if (streamingMsg) {
            msgId = streamingMsg.id;
          }
        }

        if (msgId) {
          // Update existing streaming message with final answer
          chat.editMessage(convId, msgId, answer);
          chat.finalizeStreamingMessages(convId);
          dbSync.syncMessageUpdate(convId, msgId, answer);
          dbSync.syncFinalizeMessages(convId);
          if (reqId != null) streamingMsgIds.delete(reqId);
        } else {
          // No tracked message — don't create a duplicate.
          // Just finalize any remaining streaming messages with this answer.
          const msgs = chat.messages[convId] || [];
          const lastStreaming = [...msgs].reverse().find(m => m.role === 'assistant' && m.status === 'streaming');
          if (lastStreaming) {
            chat.editMessage(convId, lastStreaming.id, answer);
            chat.finalizeStreamingMessages(convId);
            dbSync.syncMessageUpdate(convId, lastStreaming.id, answer);
            dbSync.syncFinalizeMessages(convId);
          }
          // If truly no streaming message exists, this was an unexpected event — ignore
        }

        // Track token usage
        const usage = data.usage as Record<string, unknown> | undefined;
        if (usage) {
          const innerUsage = (usage.usage as Record<string, number>) || {};
          const inputTokens = (innerUsage.input_tokens ?? 0) + (innerUsage.cache_read_input_tokens ?? 0) + (innerUsage.cache_creation_input_tokens ?? 0);
          const outputTokens = innerUsage.output_tokens ?? 0;
          const costUsd = (usage.total_cost_usd as number) ?? 0;
          if (inputTokens > 0 || outputTokens > 0) {
            dbSync.syncTokenUsage(convId, inputTokens, outputTokens, costUsd);
            dbSync.syncTraceLog({
              conversationId: convId, eventType: 'completed',
              tokenCount: inputTokens + outputTokens, costUsd,
              detail: JSON.stringify({ input: inputTokens, output: outputTokens, engine: data.engine }),
            });
          }
        }

        // Persist resume token for session continuation
        const resume = data.resume as Record<string, string> | undefined;
        if (resume?.engine && resume?.value) {
          import('@/lib/db').then(db => {
            db.updateResumeToken(convId, resume.engine, resume.value).catch(() => {});
          }).catch(() => {});
        }

        useRunStore.getState().setRunStatus(convId, 'idle');
        this._progressStartTime = null;
        // Clear progress indicator
        import('@/store/contextStore').then(({ useContextStore }) => {
          useContextStore.getState().setProgress(null);
        });
        // Refresh context after run completion (memos, branches may have changed)
        const completedConv = useChatStore.getState().conversations[convId];
        if (completedConv?.projectKey) {
          setTimeout(() => {
            this.sendRpc('project.context', { conversation_id: convId, project: completedConv.projectKey });
          }, 2000);
        }
        break;
      }
    }
  }

  /**
   * Send RPC — routes to Tauri invoke commands.
   * Handles message creation/tracking for chat.send.
   */
  async sendRpc(method: string, params: RequestParams = {}): Promise<unknown> {
    switch (method) {
      case 'chat.send': {
        const convId = params.conversation_id as string;
        const text = params.text as string;
        if (!convId || !text) return;

        const chat = useChatStore.getState();

        // Push placeholder assistant message (streaming)
        const assistantMsgId = crypto.randomUUID();
        const assistantTimestamp = Date.now();
        chat.pushMessage(convId, {
          id: assistantMsgId,
          role: 'assistant',
          content: '',
          timestamp: assistantTimestamp,
          status: 'streaming',
        });
        dbSync.syncMessage({
          id: assistantMsgId, conversationId: convId, role: 'assistant',
          content: '', timestamp: assistantTimestamp, status: 'streaming',
        });

        try {
          // Resolve project path for CLI agent cwd
          const conv = chat.conversations[convId];
          const projectPath = conv?.projectKey
            ? chat.projects.find(p => p.key === conv.projectKey)?.path
            : undefined;

          // Load agent persona if set on conversation
          let systemPrompt: string | undefined;
          let allowedTools: string[] | undefined;
          let invokeEngine = params.engine as string | undefined;
          let invokeModel = params.model as string | undefined;

          const persona = conv?.persona;
          if (persona && isTauriEnv()) {
            // Try loading agent file: docs/agents/<persona>.md
            const agentPath = projectPath
              ? `${projectPath}/docs/agents/${persona}.md`
              : undefined;
            if (agentPath) {
              const agentConfig = await loadAgentFile(agentPath);
              if (agentConfig) {
                systemPrompt = agentConfig.systemPrompt;
                allowedTools = toolsToAllowedList(agentConfig.tools);
                const parsed = parseModelString(agentConfig.model);
                if (!invokeEngine) invokeEngine = parsed.engine;
                if (!invokeModel) invokeModel = parsed.model;
              }
            }
          }

          const reqId = await invoke<number>('chat_send', {
            prompt: text,
            engine: invokeEngine,
            model: invokeModel,
            resumeToken: params.resume_token as string | undefined,
            projectPath,
            systemPrompt,
            allowedTools,
          });
          // Track which assistant message belongs to this request
          streamingMsgIds.set(reqId, assistantMsgId);
          return reqId;
        } catch (err) {
          const errText = `Error: ${err}`;
          chat.editMessage(convId, assistantMsgId, errText);
          chat.finalizeStreamingMessages(convId);
          dbSync.syncMessageUpdate(convId, assistantMsgId, errText);
          dbSync.syncFinalizeMessages(convId);
          useRunStore.getState().setRunStatus(convId, 'idle');
        }
        return;
      }
      case 'run.cancel': {
        const reqId = params.request_id as number;
        if (reqId) return invoke('chat_cancel', { requestId: reqId });
        return;
      }

      // --- Local handlers (no server needed) ---

      case 'conversation.create': {
        const chat = useChatStore.getState();
        const project = params.project as string;
        const convId = params.conversation_id as string || crypto.randomUUID();
        chat.createConversation(project, 'main');
        dbSync.syncConversation({
          id: convId, projectKey: project, label: 'New Chat',
          createdAt: Date.now(),
        });
        return;
      }
      case 'conversation.delete': {
        const convId = params.conversation_id as string;
        if (!convId) return;
        useChatStore.getState().removeConversation(convId);
        dbSync.syncDeleteConversation(convId);
        return;
      }
      case 'conversation.history': {
        const convId = params.conversation_id as string;
        const branchId = params.branch_id as string | undefined;
        if (!convId) return;

        // Determine the store key: branch messages use `branch:${branchId}`
        const storeKey = branchId ? `branch:${branchId}` : convId;

        if (isTauriEnv()) {
          try {
            const db = await import('@/lib/db');
            const d = await db.initDb();
            const rows = await d.select<Array<{
              id: string; role: string; content: string;
              timestamp: number; status: string;
              engine: string | null; model: string | null;
            }>>(
              'SELECT id, role, content, timestamp, status, engine, model FROM messages WHERE conversation_id = $1 ORDER BY timestamp',
              [storeKey],
            );
            if (rows.length > 0) {
              useChatStore.getState().setHistory(storeKey, rows.map(r => ({
                id: r.id,
                role: r.role as 'user' | 'assistant',
                content: r.content,
                timestamp: r.timestamp,
                status: (r.status || 'done') as 'done' | 'error',
                engine: r.engine ?? undefined,
                model: r.model ?? undefined,
              })));
            } else if (branchId) {
              // Branch has no persisted messages yet — load from parent conv up to checkpoint
              const chat = useChatStore.getState();
              const sys = useSystemStore.getState();
              const checkpointId = sys.branchPanelCheckpointId;
              const parentMsgs = chat.messages[convId] || [];
              if (checkpointId && parentMsgs.length > 0) {
                const cpIdx = parentMsgs.findIndex(m => m.id === checkpointId);
                if (cpIdx >= 0) {
                  chat.setHistory(storeKey, parentMsgs.slice(0, cpIdx + 1).map(m => ({ ...m })));
                }
              }
            }
          } catch { /* ignore in non-Tauri */ }
        }
        return;
      }
      case 'project.list': {
        // Reload projects from SQLite → store
        if (isTauriEnv()) {
          try {
            const db = await import('@/lib/db');
            const projects = await db.loadProjects();
            if (projects.length > 0) {
              useChatStore.getState().setProjects(projects.map(p => ({
                key: p.key, name: p.name, path: p.path,
                defaultEngine: p.defaultEngine,
                source: p.source as 'configured' | 'discovered',
                type: (p.type ?? 'project') as 'project' | 'channel',
              })));
            }
          } catch { /* non-Tauri */ }
        }
        return;
      }
      case 'conversation.list': {
        // Load conversations for a specific project from SQLite
        const projectKey = params.project as string;
        if (!projectKey || !isTauriEnv()) return;
        try {
          const db = await import('@/lib/db');
          const convs = await db.loadConversations(projectKey);
          if (convs.length > 0) {
            useChatStore.getState().loadConversations(convs.map(c => ({
              id: c.id, projectKey: c.projectKey, label: c.label,
              created_at: c.createdAt, source: c.source,
              engine: c.engine, model: c.model,
              persona: c.persona, triggerMode: c.triggerMode,
            })), true);
          }
        } catch { /* non-Tauri */ }
        return;
      }
      case 'project.context': {
        const projectKey = params.project as string;
        if (!projectKey) return;
        const project = useChatStore.getState().projects.find(p => p.key === projectKey);
        if (!project) return;

        // Load real context from Rust if path is available
        let gitBranch: string | null = null;
        let markdown = '';
        if (project.path && isTauriEnv()) {
          try {
            const ctx = await invoke<{
              gitBranch: string | null;
              gitDirtyCount: number;
              hasClaudeSession: boolean;
              hasGeminiSession: boolean;
              hasCodexSession: boolean;
              markdown: string;
              fileCount: number;
            }>('get_project_context', { projectPath: project.path });
            gitBranch = ctx.gitBranch;
            markdown = ctx.markdown;
          } catch { /* non-Tauri or path invalid */ }
        }

        // Load memos from SQLite
        let memoryEntries: Array<{ id: string; type: string; title: string; content: string; source: string; tags: string[]; timestamp: number }> = [];
        if (isTauriEnv()) {
          try {
            const db = await import('@/lib/db');
            const memos = await db.loadMemos(projectKey);
            memoryEntries = memos.map(m => ({
              id: m.id,
              type: m.type,
              title: (m.content || '').split('\n')[0].slice(0, 10),
              content: m.content,
              source: `msg:${m.messageId}`,
              tags: JSON.parse(m.tags || '[]') as string[],
              timestamp: m.createdAt * 1000,
            }));
          } catch { /* ignore */ }
        }

        // Load conv settings for merge
        const convId = params.conversation_id as string;
        if (convId) {
          const conv = useChatStore.getState().conversations[convId];
          if (conv) {
            const settings: Record<string, string | undefined> = {};
            if (conv.engine) settings.engine = conv.engine;
            if (conv.model) settings.model = conv.model;
            if (conv.persona) settings.persona = conv.persona;
            if (conv.triggerMode) settings.triggerMode = conv.triggerMode;
            if (Object.keys(settings).length > 0) {
              useChatStore.getState().updateConvSettings(convId, settings);
            }
          }
        }

        const { useContextStore } = await import('@/store/contextStore');
        useContextStore.getState().setProjectContext({
          project: projectKey,
          engine: project.defaultEngine || 'claude',
          model: null,
          persona: null,
          triggerMode: '',
          resumeToken: null,
          gitCurrentBranch: gitBranch,
          availableEngines: {
            claude: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
            gemini: ['gemini-2.5-pro', 'gemini-2.5-flash'],
            codex: ['o3', 'o4-mini'],
            opencode: [],
          },
          memoryEntries: memoryEntries as any,
          activeBranches: [],
          convBranches: [],
          pendingReviewCount: 0,
          recentDiscussions: [],
          markdown,
        });
        return;
      }
      case 'branch.list.json': {
        // Load branches for all conversations in a project
        const projectKey = params.project as string;
        if (!projectKey || !isTauriEnv()) return;
        try {
          const db = await import('@/lib/db');
          const convs = await db.loadConversations(projectKey);
          const { useContextStore } = await import('@/store/contextStore');
          type BranchStatus = 'active' | 'adopted' | 'archived' | 'discarded';
          const allBranches: Array<{ id: string; label: string; status: BranchStatus; checkpointId?: string; rtSessionId?: string; gitBranch?: string; parentBranchId?: string }> = [];
          for (const conv of convs) {
            const branches = await db.loadBranches(conv.id);
            for (const b of branches) {
              allBranches.push({
                id: b.id, label: b.label,
                status: b.status as BranchStatus,
                checkpointId: b.checkpointId,
                rtSessionId: b.sessionId,
                gitBranch: b.gitBranch,
                parentBranchId: b.parentBranchId,
              });
            }
          }
          useContextStore.getState().setProjectConvBranches(projectKey, allBranches, true);
        } catch { /* non-Tauri */ }
        return;
      }
      case 'memory.list.json': {
        // Load memos for project
        const projectKey = params.project as string;
        if (!projectKey || !isTauriEnv()) return;
        try {
          const db = await import('@/lib/db');
          const memos = await db.loadMemos(projectKey);
          if (memos.length > 0) {
            const { useContextStore } = await import('@/store/contextStore');
            useContextStore.getState().setMemoryEntries(memos.map(m => ({
              id: m.id,
              type: m.type as 'decision' | 'review' | 'idea' | 'context',
              title: (m.content || '').split('\n')[0].slice(0, 10),
              content: m.content,
              source: `msg:${m.messageId}`,
              tags: JSON.parse(m.tags || '[]') as string[],
              timestamp: m.createdAt * 1000,
            })));
          }
        } catch { /* non-Tauri */ }
        return;
      }
      case 'model.set': {
        const convId = params.conversation_id as string;
        if (!convId) return;
        const settings: Record<string, string | undefined> = {};
        if (params.engine) settings.engine = params.engine as string;
        if (params.model) settings.model = params.model as string;
        useChatStore.getState().updateConvSettings(convId, settings);
        dbSync.syncConvSettings(convId, settings);
        return;
      }
      case 'persona.set': {
        const convId = params.conversation_id as string;
        if (!convId) return;
        const persona = params.persona as string;
        useChatStore.getState().updateConvSettings(convId, { persona });
        dbSync.syncConvSettings(convId, { persona });
        return;
      }
      case 'trigger.set': {
        const convId = params.conversation_id as string;
        if (!convId) return;
        const triggerMode = params.mode as string;
        useChatStore.getState().updateConvSettings(convId, { triggerMode });
        dbSync.syncConvSettings(convId, { triggerMode });
        return;
      }
      // --- Branch operations (local, no server) ---

      case 'branch.create': {
        const convId = params.conversation_id as string;
        const checkpointId = params.checkpoint_id as string;
        const label = params.label as string || 'branch';
        const parentBranchId = params.parent_branch_id as string | null;
        if (!convId) return;

        const branchId = crypto.randomUUID();
        const chat = useChatStore.getState();
        chat.setActiveBranch(branchId, label);

        const conv = chat.conversations[convId];
        const projectKey = conv?.projectKey ?? '';

        // Open branch panel
        useSystemStore.getState().openBranchPanel(branchId, convId, label, projectKey, checkpointId);

        // Persist to SQLite
        dbSync.syncBranch({
          id: branchId, conversationId: convId, label,
          checkpointId, sessionId: convId,
          parentBranchId: parentBranchId ?? undefined,
        });

        // Copy messages up to checkpoint into branch channel
        const msgs = chat.messages[convId] || [];
        const cpIdx = msgs.findIndex(m => m.id === checkpointId);
        if (cpIdx >= 0) {
          const branchMsgs = msgs.slice(0, cpIdx + 1).map(m => ({ ...m }));
          chat.setHistory(`branch:${branchId}`, branchMsgs);
        }

        // Refresh branch list
        if (projectKey) {
          this.sendRpc('branch.list.json', { project: projectKey });
        }
        return;
      }
      case 'branch.adopt': {
        const convId = params.conversation_id as string;
        const branchId = params.branch_id as string;
        if (!convId || !branchId) return;

        const chat = useChatStore.getState();
        chat.setActiveBranch(null);
        dbSync.syncBranchStatus(branchId, 'adopted');

        // Close branch panel if viewing this branch
        const sys = useSystemStore.getState();
        if (sys.branchPanelBranchId === branchId) {
          sys.closeBranchPanel();
        }

        // Merge branch messages into main conversation
        const branchMsgs = chat.messages[`branch:${branchId}`] || [];
        if (branchMsgs.length > 0) {
          const mainMsgs = chat.messages[convId] || [];
          // Find checkpoint and replace messages after it
          const lastBranchMsg = branchMsgs[branchMsgs.length - 1];
          if (lastBranchMsg) {
            chat.setHistory(convId, [...mainMsgs, ...branchMsgs.filter(m =>
              !mainMsgs.some(mm => mm.id === m.id)
            )]);
          }
        }

        // Refresh context
        const conv = chat.conversations[convId];
        if (conv?.projectKey) {
          this.sendRpc('project.context', { conversation_id: convId, project: conv.projectKey });
        }
        return;
      }
      case 'branch.archive': {
        const branchId = params.branch_id as string;
        if (!branchId) return;
        const chat = useChatStore.getState();
        if (chat.activeBranchId === branchId) {
          chat.setActiveBranch(null);
        }
        dbSync.syncBranchStatus(branchId, 'archived');
        const sys = useSystemStore.getState();
        if (sys.branchPanelBranchId === branchId) {
          sys.closeBranchPanel();
        }
        return;
      }
      case 'branch.delete': {
        const branchId = params.branch_id as string;
        if (!branchId) return;
        const chat = useChatStore.getState();
        if (chat.activeBranchId === branchId) {
          chat.setActiveBranch(null);
        }
        const { useContextStore } = await import('@/store/contextStore');
        useContextStore.getState().removeConvBranch(branchId);
        chat.clearMessages(`branch:${branchId}`);
        dbSync.syncDeleteBranch(branchId);
        const sys = useSystemStore.getState();
        if (sys.branchPanelBranchId === branchId) {
          sys.closeBranchPanel();
        }
        // Dispatch custom event for BranchPanel listener
        window.dispatchEvent(new CustomEvent('branch-deleted', { detail: { branch_id: branchId } }));
        return;
      }

      // --- Message operations (local, no server) ---

      case 'message.delete': {
        const convId = params.conversation_id as string;
        const msgId = params.message_id as string;
        if (!convId || !msgId) return;
        useChatStore.getState().removeMessage(convId, msgId);
        dbSync.syncMessageDelete(convId, msgId);
        return;
      }
      case 'message.retry': {
        // Re-send the user message that precedes this assistant message
        const convId = params.conversation_id as string;
        const msgId = params.message_id as string;
        if (!convId || !msgId) return;
        const chat = useChatStore.getState();
        const msgs = chat.messages[convId] || [];
        const msgIdx = msgs.findIndex(m => m.id === msgId);
        if (msgIdx < 0) return;

        // Find the preceding user message
        let userMsg: typeof msgs[0] | null = null;
        for (let i = msgIdx - 1; i >= 0; i--) {
          if (msgs[i].role === 'user') { userMsg = msgs[i]; break; }
        }
        if (!userMsg) return;

        // Remove the old assistant message
        chat.removeMessage(convId, msgId);
        dbSync.syncMessageDelete(convId, msgId);

        // Re-send
        this.sendRpc('chat.send', { conversation_id: convId, text: userMsg.content });
        return;
      }
      case 'message.adopt': {
        // Adopt a branch message into the main conversation
        // For now, this is a no-op since branch adopt handles it
        return;
      }

      case 'engine.list': {
        const engines: Record<string, string[]> = {
          claude: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
          gemini: ['gemini-2.5-pro', 'gemini-2.5-flash'],
          codex: ['o3', 'o4-mini'],
          opencode: [],
        };
        import('@/store/contextStore').then(({ useContextStore }) => {
          useContextStore.getState().setEngineList(engines);
        });
        return engines;
      }
      default:
        console.debug(`[tauriClient] not implemented: ${method}`, params);
        return undefined;
    }
  }

  async searchCode(query: string, project: string, lang?: string) {
    if (!isTauriEnv()) return;
    const { useContextStore } = await import('@/store/contextStore');
    useContextStore.getState().setCodeSearchLoading(true);
    try {
      const raw = await invoke<string>('code_search', {
        query, projectPath: project, lang,
      });
      // rawq outputs text — wrap in CodeSearchResponse
      useContextStore.getState().setCodeSearchResults({
        query, project, available: true,
        results: [{
          file: '', lines: [0, 0], language: '', scope: '',
          confidence: 1.0, content: raw, token_count: 0,
        }],
        query_ms: 0, total_tokens: 0,
      });
    } catch (err) {
      console.error('[rawq] search failed:', err);
      useContextStore.getState().setCodeSearchResults({
        query, project, available: false, results: [],
        query_ms: 0, total_tokens: 0, error: String(err),
      });
    }
  }

  async getCodeMap(project: string, depth?: number, lang?: string) {
    if (!isTauriEnv()) return;
    try {
      const raw = await invoke<string>('code_map', {
        projectPath: project, depth: depth ?? 2, lang,
      });
      const { useContextStore } = await import('@/store/contextStore');
      useContextStore.getState().setCodeMap({
        project, available: true, map: { raw },
      });
    } catch (err) {
      console.error('[rawq] map failed:', err);
    }
  }

  destroy(): void {
    this._unlisten?.();
    this._unlisten = null;
  }
}

export const tauriClient = new TauriClient();
