/**
 * 앱 시작 시 SQLite → Zustand 하이드레이션.
 * 서버 연결 전에 로컬 캐시에서 대화 목록과 메시지를 복원하여 즉시 UI 표시.
 * Tauri 환경이 아니면 no-op.
 */
import { isTauriEnv } from './db';
import { useChatStore } from '@/store/chatStore';
import { useSystemStore } from '@/store/systemStore';
import { useContextStore, type ConversationBranch } from '@/store/contextStore';

export async function hydrateFromDb(): Promise<void> {
  if (!isTauriEnv()) return;

  try {
    const db = await import('./db');
    await db.initDb();
    useSystemStore.getState().setDbConnected(true);

    const chat = useChatStore.getState();

    // 1. 프로젝트 목록 복원
    const projects = await db.loadProjects();
    if (projects.length > 0) {
      chat.setProjects(projects.map(p => ({
        key: p.key,
        name: p.name,
        path: p.path,
        defaultEngine: p.defaultEngine,
        source: p.source as 'configured' | 'discovered',
        type: (p.type ?? 'project') as 'project' | 'channel',
      })));
    }

    // 1b. 활성 프로젝트 복원 (저장된 값이 없으면 첫 번째 프로젝트)
    if (projects.length > 0 && !chat.activeProjectKey) {
      chat.setActiveProject(projects[0].key);
    }

    // 2. 모든 프로젝트의 대화 목록 복원 (custom_label 보존)
    const convs = await db.loadAllConversations();
    if (convs.length > 0) {
      chat.loadConversations(convs.map(c => ({
        id: c.id,
        projectKey: c.projectKey,
        label: c.label,
        created_at: c.createdAt,
        source: c.source,
        engine: c.engine,
        model: c.model,
        persona: c.persona,
        triggerMode: c.triggerMode,
      })), true);
    }

    // 2b. 마지막 활성 대화 복원 + 메시지 로드
    const freshChat = useChatStore.getState();
    let activeConvId = freshChat.activeConversationId;
    if (convs.length > 0 && !activeConvId) {
      const lastConvId = localStorage.getItem('tunachat:lastConvId');
      if (lastConvId && freshChat.conversations[lastConvId]) {
        freshChat.setActiveConversation(lastConvId);
        activeConvId = lastConvId;
      } else {
        const firstConvId = convs[0]?.id;
        if (firstConvId) {
          freshChat.setActiveConversation(firstConvId);
          activeConvId = firstConvId;
        }
      }
    }

    // 2c. 활성 대화의 메시지 로드
    if (activeConvId) {
      const msgs = await db.loadMessages(activeConvId);
      if (msgs.length > 0) {
        useChatStore.getState().setHistory(activeConvId, msgs.map(m => ({
          id: m.id,
          role: m.role as 'user' | 'assistant',
          content: m.content,
          timestamp: m.timestamp,
          status: (m.status || 'done') as 'done' | 'error',
          engine: m.engine ?? undefined,
          model: m.model ?? undefined,
        })));
      }
    }

    // 3. 브랜치 목록 복원 — 프로젝트별로 그룹화
    const ctxStore = useContextStore.getState();
    const branchesByProject = new Map<string, ConversationBranch[]>();
    for (const conv of convs) {
      const branches = await db.loadBranches(conv.id);
      for (const b of branches) {
        const list = branchesByProject.get(conv.projectKey) ?? [];
        list.push({
          id: b.id,
          label: b.label,
          status: b.status as ConversationBranch['status'],
          checkpointId: b.checkpointId,
          rtSessionId: b.sessionId,
          gitBranch: b.gitBranch,
          parentBranchId: b.parentBranchId,
        });
        branchesByProject.set(conv.projectKey, list);
      }
    }
    for (const [pk, branches] of branchesByProject) {
      ctxStore.setProjectConvBranches(pk, branches, true);
    }

    // 4. 메모 로드 — 모든 프로젝트의 savedMessageIds 복원
    const projectKeys = new Set(convs.map(c => c.projectKey));
    for (const pk of projectKeys) {
      const memos = await db.loadMemos(pk);
      if (memos.length > 0) {
        const entries = memos.map(m => ({
          id: m.id,
          type: m.type as 'decision' | 'review' | 'idea' | 'context',
          title: (m.content || '').split('\n')[0].slice(0, 10),
          content: m.content,
          source: `msg:${m.messageId}`,
          tags: JSON.parse(m.tags || '[]') as string[],
          timestamp: m.createdAt * 1000,
        }));
        ctxStore.setMemoryEntries(entries);
      }
      const savedIds = await db.loadSavedMessageIds(pk);
      if (savedIds.size > 0) {
        ctxStore.hydrateMessageIds(savedIds);
      }
    }

    // 5. 자동 스캔: 저장된 워크스페이스 루트가 있으면 재스캔하여 프로젝트 목록 갱신
    try {
      const savedRoot = localStorage.getItem('tunachat:workspaceRoot');
      if (savedRoot && isTauriEnv()) {
        const { invoke } = await import('@tauri-apps/api/core');
        const results = await invoke<Array<{
          key: string; name: string; path: string; type: string;
          defaultEngine: string; gitBranch: string | null;
        }>>('scan_workspace', { root: savedRoot });

        if (results.length > 0) {
          const currentChat = useChatStore.getState();
          const existingKeys = new Set(currentChat.projects.map(p => p.key));
          const newProjects = results.filter(r => !existingKeys.has(r.key));

          if (newProjects.length > 0) {
            const merged = [
              ...currentChat.projects,
              ...newProjects.map(r => ({
                key: r.key, name: r.name, path: r.path,
                defaultEngine: r.defaultEngine,
                source: (r.type === 'discovered' ? 'discovered' : 'configured') as 'configured' | 'discovered',
                type: r.type as 'project' | 'channel',
              })),
            ];
            currentChat.setProjects(merged);
            for (const r of newProjects) {
              await db.upsertProject({
                key: r.key, name: r.name, path: r.path,
                defaultEngine: r.defaultEngine,
                source: r.type === 'discovered' ? 'discovered' : 'configured',
                type: r.type,
              });
            }
            console.log('[dbHydrate] auto-scan found', newProjects.length, 'new projects');
          }

          // Update paths for existing projects that didn't have one
          for (const r of results) {
            const existing = useChatStore.getState().projects.find(p => p.key === r.key);
            if (existing && !existing.path) {
              useChatStore.getState().setProjects(
                useChatStore.getState().projects.map(p =>
                  p.key === r.key ? { ...p, path: r.path } : p
                )
              );
              await db.upsertProject({ key: r.key, name: r.name, path: r.path });
            }
          }
        }
      }
    } catch { /* scan failed — continue without it */ }

    // 6. 첫 실행: 프로젝트가 없으면 기본 프로젝트 + 대화 생성
    if (useChatStore.getState().projects.length === 0) {
      const defaultProject = {
        key: 'default',
        name: 'tunaChat',
        source: 'configured' as const,
        type: 'project' as const,
      };
      chat.setProjects([defaultProject]);
      chat.setActiveProject('default');
      const convId = chat.createConversation('default', 'main', 'New Chat');
      // persist to SQLite
      await db.upsertProject({ key: 'default', name: 'tunaChat', source: 'configured', type: 'project' });
      const conv = chat.conversations[convId];
      if (conv) {
        await db.upsertConversation({
          id: conv.id, projectKey: conv.projectKey, label: conv.label,
          type: conv.type, createdAt: conv.createdAt,
        });
      }
      console.log('[dbHydrate] first launch — created default project and conversation');
    } else {
      console.log('[dbHydrate] loaded', projects.length, 'projects,', convs.length, 'conversations from SQLite');
    }
  } catch (err) {
    console.warn('[dbHydrate] failed, continuing without cache:', err);
  }
}
