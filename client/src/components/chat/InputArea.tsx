import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useChatStore } from '@/store/chatStore';
import { useRunStore } from '@/store/runStore';
import { useContextStore } from '@/store/contextStore';
import { useSystemStore } from '@/store/systemStore';
import { useConvSettings } from '@/lib/useConvSettings';
import { useIsMobile } from '@/lib/useIsMobile';
import { tauriClient } from '@/lib/tauriClient';
import * as dbSync from '@/lib/dbSync';
import { cn } from '@/lib/utils';
import { showToast } from '@/components/chat/ActionToast';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import {
  PaperPlaneRight,
  Stop,
  GitMerge,
  GitBranch,
  Lightning,
  Brain,
  Broadcast,
  CaretDown,
  ArrowBendUpLeft,
  X,
  MagnifyingGlass,
  TreeStructure,
  Gear,
  UserCircle,
  Plus,
  BookOpen,
  Eye,
} from '@phosphor-icons/react';

// --- Command palette ---
interface CmdDef {
  name: string;
  desc: string;
  icon: React.ReactNode;
  insert: string;          // text inserted into input (replaces "!" prefix)
  immediate?: boolean;     // if true, send immediately on select
}

const COMMANDS: CmdDef[] = [
  { name: 'help', desc: '커맨드 및 엔진 목록', icon: <MagnifyingGlass size={14} className="text-on-surface-variant/60" />, insert: '!help', immediate: true },
  { name: 'new', desc: '새 대화 세션 시작', icon: <Plus size={14} className="text-emerald-400" />, insert: '!new', immediate: true },
  { name: 'search', desc: '코드 검색', icon: <MagnifyingGlass size={14} className="text-blue-400" />, insert: '!search ' },
  { name: 'map', desc: '프로젝트 구조 보기', icon: <TreeStructure size={14} className="text-emerald-400" />, insert: '!map ' },
  { name: 'model', desc: '엔진/모델 변경', icon: <Lightning size={14} className="text-primary" />, insert: '!model ' },
  { name: 'models', desc: '사용 가능한 모델 목록', icon: <Lightning size={14} className="text-primary/60" />, insert: '!models', immediate: true },
  { name: 'persona', desc: '페르소나 관리', icon: <UserCircle size={14} className="text-violet-400" />, insert: '!persona ' },
  { name: 'trigger', desc: '트리거 모드 변경', icon: <Broadcast size={14} className="text-emerald-400" />, insert: '!trigger ' },
  { name: 'status', desc: '현재 세션 상태', icon: <Gear size={14} className="text-blue-400" />, insert: '!status', immediate: true },
  { name: 'project', desc: '프로젝트 바인딩 관리', icon: <TreeStructure size={14} className="text-amber-400" />, insert: '!project ' },
  { name: 'memory', desc: '프로젝트 메모리 관리', icon: <BookOpen size={14} className="text-violet-400" />, insert: '!memory ' },
  { name: 'branch', desc: '대화 분기 관리', icon: <GitBranch size={14} className="text-violet-400" />, insert: '!branch ' },
  { name: 'context', desc: '프로젝트 컨텍스트 표시', icon: <Eye size={14} className="text-amber-400" />, insert: '!context', immediate: true },
  { name: 'cancel', desc: '실행 중인 작업 취소', icon: <Stop size={14} className="text-red-400" />, insert: '!cancel', immediate: true },
];

function CommandPalette({ query, onSelect, selectedIndex }: {
  query: string;
  onSelect: (cmd: CmdDef) => void;
  selectedIndex: number;
}) {
  const filtered = COMMANDS.filter(c => c.name.includes(query.toLowerCase()));

  if (filtered.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 mb-1 mx-0 w-full max-w-sm bg-[#1a1a1a]/95 backdrop-blur-xl border border-white/10 rounded-lg shadow-2xl overflow-hidden z-20">
      <div className="px-3 py-1.5 border-b border-white/5 text-[10px] text-on-surface-variant/40 font-semibold uppercase tracking-wider">Commands</div>
      {filtered.map((cmd, i) => (
        <button
          key={cmd.name}
          onMouseDown={e => { e.preventDefault(); onSelect(cmd); }}
          className={cn(
            'flex items-center gap-2.5 w-full px-3 py-1.5 text-left transition-colors',
            i === selectedIndex % filtered.length
              ? 'bg-white/15 text-on-surface'
              : 'text-on-surface-variant/70 hover:bg-white/5',
          )}
        >
          {cmd.icon}
          <span className="text-[12px] font-medium">!{cmd.name}</span>
          <span className="text-[11px] text-on-surface-variant/40 ml-auto">{cmd.desc}</span>
        </button>
      ))}
    </div>
  );
}

// --- QuickChips ---
const TRIGGER_MODES = [
  { value: 'always', label: 'Always', desc: '모든 메시지에 응답' },
  { value: 'mentions', label: 'Mentions', desc: '멘션 시에만 응답' },
  { value: 'off', label: 'Off', desc: '자동 응답 끔' },
] as const;

function QuickChipEngine({ convId, compact }: { convId: string; compact?: boolean }) {
  const { engine, model, availableEngines } = useConvSettings(convId);
  const updateSettings = useChatStore(s => s.updateConvSettings);
  const [open, setOpen] = useState(false);
  const isRunning = useRunStore(s => (s.activeRuns[convId] ?? 'idle') !== 'idle');

  const selectModel = (eng: string, m: string) => {
    if (isRunning) return;
    updateSettings(convId, { engine: eng, model: m });
    tauriClient.sendRpc('model.set', { conversation_id: convId, engine: eng, model: m });
    showToast(`Model → ${eng}/${m}`);
    setOpen(false);
  };

  const selectEngine = (eng: string) => {
    if (isRunning) return;
    updateSettings(convId, { engine: eng, model: undefined });
    tauriClient.sendRpc('model.set', { conversation_id: convId, engine: eng });
    showToast(`Engine → ${eng}`);
    setOpen(false);
  };

  const engineIds = Object.keys(availableEngines);
  const hasEngines = engineIds.length > 0;

  return (
    <Popover open={open} onOpenChange={v => { if (isRunning) return; setOpen(v); }}>
      <PopoverTrigger
        disabled={isRunning}
        className={cn(
          "flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors",
          isRunning
            ? "bg-white/5 text-on-surface-variant/30 cursor-not-allowed"
            : "bg-white/5 hover:bg-white/10 text-on-surface-variant/70 hover:text-on-surface cursor-pointer",
        )}
      >
        <Lightning size={12} weight="fill" className="text-primary" />
        <span className="hidden sm:inline">{engine}{model ? `/${model}` : ''}</span>
        {!compact && <CaretDown size={10} className="opacity-50" />}
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-52 p-1 max-h-72 overflow-y-auto">
        {!hasEngines ? (
          <div className="px-2 py-3 text-[11px] text-on-surface-variant/40 text-center">
            서버에서 엔진 목록을 받지 못했습니다
          </div>
        ) : (
          engineIds.map(eng => {
            const models = availableEngines[eng] ?? [];
            const isActive = eng === engine;
            return (
              <div key={eng}>
                <button
                  onClick={() => selectEngine(eng)}
                  className={cn(
                    'w-full text-left px-2 py-1 rounded text-[11px] font-semibold uppercase tracking-wide transition-colors',
                    isActive ? 'text-primary' : 'text-on-surface-variant/60 hover:text-on-surface-variant',
                  )}
                >
                  {eng}
                </button>
                {models.map(m => (
                  <button
                    key={m}
                    onClick={() => selectModel(eng, m)}
                    className={cn(
                      'w-full text-left px-3 py-0.5 rounded text-[11px] font-mono transition-colors',
                      eng === engine && m === model
                        ? 'bg-primary/15 text-primary'
                        : 'text-on-surface-variant/70 hover:bg-white/5',
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
            );
          })
        )}
      </PopoverContent>
    </Popover>
  );
}

function QuickChipPersona({ convId, compact }: { convId: string; compact?: boolean }) {
  const { persona } = useConvSettings(convId);
  const updateSettings = useChatStore(s => s.updateConvSettings);
  const [open, setOpen] = useState(false);
  const isRunning = useRunStore(s => (s.activeRuns[convId] ?? 'idle') !== 'idle');

  const PRESETS = ['default', 'concise', 'creative', 'technical'];

  const selectPersona = (p: string) => {
    if (isRunning) return;
    const value = p === 'default' ? '' : p;
    updateSettings(convId, { persona: value || undefined });
    tauriClient.sendRpc('persona.set', { conversation_id: convId, persona: value });
    showToast(`Persona → ${p}`);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={v => { if (isRunning) return; setOpen(v); }}>
      <PopoverTrigger
        disabled={isRunning}
        className={cn(
          "flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors",
          isRunning
            ? "bg-white/5 text-on-surface-variant/30 cursor-not-allowed"
            : "bg-white/5 hover:bg-white/10 text-on-surface-variant/70 hover:text-on-surface cursor-pointer",
        )}
      >
        <Brain size={12} className="text-violet-400" />
        {!compact && <span className="hidden sm:inline">{persona || 'default'}</span>}
        {!compact && <CaretDown size={10} className="opacity-50" />}
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-44 p-1">
        <div className="text-[10px] font-semibold text-on-surface-variant/50 uppercase px-2 pt-0.5 pb-1 mb-0.5 border-b border-outline-variant/20">Persona</div>
        {PRESETS.map(p => (
          <button
            key={p}
            onClick={() => selectPersona(p)}
            className={cn(
              'w-full text-left px-2 py-0.5 rounded text-[11px] transition-colors',
              (p === 'default' ? !persona : persona === p)
                ? 'bg-primary/15 text-primary font-medium'
                : 'hover:bg-white/5 text-on-surface-variant',
            )}
          >
            {p}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function QuickChipTrigger({ convId, compact }: { convId: string; compact?: boolean }) {
  const { triggerMode: trigger } = useConvSettings(convId);
  const updateSettings = useChatStore(s => s.updateConvSettings);
  const [open, setOpen] = useState(false);
  const isRunning = useRunStore(s => (s.activeRuns[convId] ?? 'idle') !== 'idle');

  const selectTrigger = (mode: string) => {
    if (isRunning) return;
    updateSettings(convId, { triggerMode: mode });
    tauriClient.sendRpc('trigger.set', { conversation_id: convId, mode });
    showToast(`Trigger → ${mode}`);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={v => { if (isRunning) return; setOpen(v); }}>
      <PopoverTrigger
        disabled={isRunning}
        className={cn(
          "flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors",
          isRunning
            ? "bg-white/5 text-on-surface-variant/30 cursor-not-allowed"
            : "bg-white/5 hover:bg-white/10 text-on-surface-variant/70 hover:text-on-surface cursor-pointer",
        )}
      >
        <Broadcast size={12} className="text-emerald-400" />
        {!compact && <span className="hidden sm:inline">{trigger}</span>}
        {!compact && <CaretDown size={10} className="opacity-50" />}
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-52 p-1">
        <div className="text-[10px] font-semibold text-on-surface-variant/50 uppercase px-2 pt-0.5 pb-1 mb-0.5 border-b border-outline-variant/20">Trigger Mode</div>
        {TRIGGER_MODES.map(t => (
          <button
            key={t.value}
            onClick={() => selectTrigger(t.value)}
            className={cn(
              'w-full text-left px-2 py-0.5 rounded text-[11px] transition-colors',
              t.value === trigger ? 'bg-primary/15 text-primary font-medium' : 'hover:bg-white/5 text-on-surface-variant',
            )}
          >
            <div>{t.label}</div>
            <div className="text-[9px] text-on-surface-variant/40 leading-tight">{t.desc}</div>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

// --- Input Area ---
export function InputArea({ overrideConversationId, compact }: { overrideConversationId?: string; compact?: boolean } = {}) {
  const isMobile = useIsMobile();
  const [input, setInputRaw] = useState('');
  const [cmdIndex, setCmdIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const storeConversationId = useChatStore(s => s.activeConversationId);
  const activeConversationId = overrideConversationId ?? storeConversationId;
  const setDraft = useChatStore(s => s.setDraft);
  const clearDraft = useChatStore(s => s.clearDraft);
  const prevConvIdRef = useRef(activeConversationId);

  // draft 저장 + 복원: 세션 전환 시
  useEffect(() => {
    const prevId = prevConvIdRef.current;
    if (prevId === activeConversationId) return;
    // 이전 세션 draft 저장
    if (prevId && input) setDraft(prevId, input);
    // 새 세션 draft 복원
    const draft = activeConversationId ? useChatStore.getState().drafts[activeConversationId] ?? '' : '';
    setInputRaw(draft);
    prevConvIdRef.current = activeConversationId;
  }, [activeConversationId]);  // eslint-disable-line react-hooks/exhaustive-deps

  const setInput = useCallback((text: string) => {
    setInputRaw(text);
  }, []);
  const activeProjectKey = useChatStore(s => s.activeProjectKey);
  const gitBranch = useContextStore(s => {
    const ctx = activeProjectKey ? (s.projectContextByKey[activeProjectKey] ?? s.projectContext) : s.projectContext;
    return ctx?.gitCurrentBranch;
  });
  const isMockMode = useChatStore(s => s.isMockMode);
  const pushMessage = useChatStore(s => s.pushMessage);
  const replyTo = useChatStore(s => s.replyTo);
  const clearReplyTo = useChatStore(s => s.clearReplyTo);
  const runStatus = useRunStore(s => {
    return activeConversationId ? (s.activeRuns[activeConversationId] ?? 'idle') : 'idle';
  });
  const requestCancel = useRunStore(s => s.requestCancel);
  const isRunning = runStatus === 'running' || runStatus === 'cancelling';

  const convSettings = useConvSettings(activeConversationId);
  const engineName = (() => {
    const e = (convSettings.engine || 'claude').toLowerCase();
    if (e.includes('claude')) return '클로드';
    if (e.includes('gemini')) return '제미나이';
    if (e.includes('codex')) return '코덱스';
    if (e.includes('gpt') || e.includes('openai')) return 'GPT';
    return convSettings.engine || '클로드';
  })();
  const placeholderText = `${engineName}에게 무엇이든 물어보세요!`;

  // Command palette: show when input starts with "!" and has no newlines
  const cmdMatch = input.match(/^!(\S*)$/);
  const showCmdPalette = !!cmdMatch;
  const cmdQuery = cmdMatch?.[1] ?? '';

  const filteredCmds = COMMANDS.filter(c => c.name.includes(cmdQuery.toLowerCase()));

  const handleCmdSelect = useCallback((cmd: CmdDef) => {
    setInput(cmd.insert);
    setCmdIndex(0);
    if (cmd.immediate) {
      // defer so input updates first
      setTimeout(() => {
        if (!activeConversationId) return;
        const msgId = crypto.randomUUID();
        const ts = Date.now();
        pushMessage(activeConversationId, {
          id: msgId, role: 'user', content: cmd.insert, timestamp: ts, status: 'done',
        });
        dbSync.syncMessage({ id: msgId, conversationId: activeConversationId, role: 'user', content: cmd.insert, timestamp: ts, status: 'done' });
        // Check local command handler first (e.g., !help, !status)
        if (!handleLocalCommand(cmd.insert, activeConversationId)) {
          tauriClient.sendRpc('chat.send', { conversation_id: activeConversationId, text: cmd.insert });
        }
        setInput('');
      }, 0);
    } else {
      setTimeout(() => textareaRef.current?.focus(), 10);
    }
  }, [activeConversationId, pushMessage]);

  /** Handle ! commands locally instead of sending to CLI agent */
  const handleLocalCommand = (text: string, convId: string): boolean => {
    const trimmed = text.trim();
    if (!trimmed.startsWith('!')) return false;

    const parts = trimmed.slice(1).split(/\s+/);
    const cmd = parts[0]?.toLowerCase();
    const arg = parts.slice(1).join(' ');
    const respond = (content: string) => {
      pushMessage(convId, {
        id: crypto.randomUUID(), role: 'assistant', content,
        timestamp: Date.now(), status: 'done',
      });
    };

    switch (cmd) {
      case 'help':
        respond(
          '**커맨드 목록**\n\n' +
          '`!help` — 이 도움말\n' +
          '`!project` — 현재 프로젝트 정보\n' +
          '`!new` — 새 대화\n' +
          '`!model <engine>/<model>` — 엔진/모델 변경\n' +
          '`!models` — 사용 가능한 모델 목록\n' +
          '`!persona <name>` — 페르소나 변경\n' +
          '`!trigger <always|mentions|off>` — 트리거 모드\n' +
          '`!status` — 현재 세션 상태\n' +
          '`!search <query>` — 코드 검색\n' +
          '`!map` — 프로젝트 구조\n' +
          '`!memory` — 프로젝트 메모리 목록\n' +
          '`!branch` — 브랜치 목록\n' +
          '`!context` — 프로젝트 컨텍스트\n' +
          '`!cancel` — 실행 취소'
        );
        return true;
      case 'project': {
        const subCmd = parts[1]?.toLowerCase();
        const chat = useChatStore.getState();

        if (subCmd === 'set') {
          // !project set <key> — switch active project
          const targetKey = parts[2];
          if (!targetKey) { respond('사용법: `!project set <key>`'); return true; }
          const target = chat.projects.find(p => p.key === targetKey || p.name.toLowerCase() === targetKey.toLowerCase());
          if (!target) {
            respond(`프로젝트 \`${targetKey}\` 를 찾을 수 없습니다.\n사용 가능: ${chat.projects.map(p => p.key).join(', ')}`);
          } else {
            chat.setActiveProject(target.key);
            respond(`활성 프로젝트 → **${target.name}** (\`${target.path || '경로 없음'}\`)`);
          }
          return true;
        }

        if (subCmd === 'scan') {
          // !project scan <path> — scan workspace root
          const scanPath = parts.slice(2).join(' ');
          if (!scanPath) { respond('사용법: `!project scan <워크스페이스 경로>`'); return true; }
          (async () => {
            try {
              const { invoke } = await import('@tauri-apps/api/core');
              const results = await invoke<Array<{
                key: string; name: string; path: string; type: string;
                defaultEngine: string; gitBranch: string | null;
              }>>('scan_workspace', { root: scanPath });

              if (results.length === 0) {
                respond(`\`${scanPath}\`에서 프로젝트를 찾지 못했습니다.`);
                return;
              }

              // Add discovered projects to store + DB
              const { syncProject } = await import('@/lib/dbSync');
              for (const r of results) {
                syncProject({
                  key: r.key, name: r.name, path: r.path,
                  defaultEngine: r.defaultEngine, source: r.type === 'discovered' ? 'discovered' : 'configured',
                  type: r.type,
                });
              }
              chat.setProjects([
                ...chat.projects.filter(p => !results.some(r => r.key === p.key)),
                ...results.map(r => ({
                  key: r.key, name: r.name, path: r.path,
                  defaultEngine: r.defaultEngine,
                  source: (r.type === 'discovered' ? 'discovered' : 'configured') as 'configured' | 'discovered',
                  type: r.type as 'project' | 'channel',
                })),
              ]);

              const lines = results.map(r =>
                `- **${r.name}** [${r.type}] \`${r.path}\`${r.gitBranch ? ` (${r.gitBranch})` : ''}`
              );
              respond(`**스캔 결과** (${results.length}개)\n\n${lines.join('\n')}`);
            } catch (err) {
              respond(`스캔 실패: ${err}`);
            }
          })();
          return true;
        }

        // Default: show project info
        const pk = chat.activeProjectKey;
        const project = chat.projects.find(p => p.key === pk);
        const conv = convId ? chat.conversations[convId] : null;
        const msgCount = convId ? (chat.messages[convId]?.length ?? 0) : 0;
        respond(
          `**프로젝트 정보**\n\n` +
          `- 프로젝트: **${project?.name || pk || '없음'}**\n` +
          `- 경로: \`${project?.path || '(미설정)'}\`\n` +
          `- 기본 엔진: ${project?.defaultEngine || 'claude'}\n` +
          `- 현재 대화: ${conv?.label || '없음'} (${msgCount}개 메시지)\n` +
          `- 대화 엔진: ${conv?.engine || project?.defaultEngine || 'default'}\n` +
          `- 대화 모델: ${conv?.model || 'default'}\n` +
          `- 페르소나: ${conv?.persona || 'default'}\n` +
          `- 트리거: ${conv?.triggerMode || 'always'}\n\n` +
          `서브커맨드: \`!project set <key>\` \`!project scan <path>\``
        );
        return true;
      }
      case 'new':
        useChatStore.getState().createConversation(
          useChatStore.getState().activeProjectKey || 'default', 'main'
        );
        return true;
      case 'model': {
        if (!arg) { respond('사용법: `!model <engine>/<model>` 또는 `!model <engine>`'); return true; }
        const [eng, mod] = arg.includes('/') ? arg.split('/', 2) : [arg, undefined];
        const settings: Record<string, string | undefined> = { engine: eng };
        if (mod) settings.model = mod;
        useChatStore.getState().updateConvSettings(convId, settings);
        tauriClient.sendRpc('model.set', { conversation_id: convId, engine: eng, ...(mod ? { model: mod } : {}) });
        respond(`엔진/모델 → **${eng}${mod ? '/' + mod : ''}**`);
        return true;
      }
      case 'models': {
        const engines = useContextStore.getState().engineList;
        const lines = Object.entries(engines).map(([eng, models]) =>
          `**${eng}**: ${(models as string[]).join(', ') || '(없음)'}`
        );
        respond(lines.length > 0 ? lines.join('\n') : '엔진 목록을 아직 받지 못했습니다.');
        return true;
      }
      case 'persona':
        if (!arg) { respond('사용법: `!persona <name>`'); return true; }
        useChatStore.getState().updateConvSettings(convId, { persona: arg });
        tauriClient.sendRpc('persona.set', { conversation_id: convId, persona: arg });
        respond(`페르소나 → **${arg}**`);
        return true;
      case 'trigger':
        if (!arg || !['always', 'mentions', 'off'].includes(arg)) {
          respond('사용법: `!trigger <always|mentions|off>`');
          return true;
        }
        useChatStore.getState().updateConvSettings(convId, { triggerMode: arg });
        tauriClient.sendRpc('trigger.set', { conversation_id: convId, mode: arg });
        respond(`트리거 모드 → **${arg}**`);
        return true;
      case 'status': {
        const conv = useChatStore.getState().conversations[convId];
        const run = useRunStore.getState().activeRuns[convId] ?? 'idle';
        respond(
          `**세션 상태**\n` +
          `- 대화: ${conv?.label || convId}\n` +
          `- 엔진: ${conv?.engine || 'default'}\n` +
          `- 모델: ${conv?.model || 'default'}\n` +
          `- 실행: ${run}`
        );
        return true;
      }
      case 'search':
        if (arg) tauriClient.searchCode(arg, useChatStore.getState().activeProjectKey || '');
        else respond('사용법: `!search <query>`');
        return true;
      case 'map':
        tauriClient.getCodeMap(useChatStore.getState().activeProjectKey || '');
        respond('코드 맵을 로드합니다...');
        return true;
      case 'cancel': {
        const runStatus = useRunStore.getState().activeRuns[convId];
        if (runStatus === 'running') {
          useRunStore.getState().requestCancel(convId);
          respond('취소 요청을 보냈습니다.');
        } else {
          respond('실행 중인 작업이 없습니다.');
        }
        return true;
      }
      case 'memory': {
        const ctxState = useContextStore.getState();
        const entries = ctxState.memoryEntries;
        if (entries.length === 0) {
          respond('저장된 메모리가 없습니다.');
        } else {
          const lines = entries.map(e =>
            `- **[${e.type}]** ${e.content.split('\n')[0].slice(0, 80)}${e.content.length > 80 ? '...' : ''}`
          );
          respond(`**프로젝트 메모리** (${entries.length}개)\n\n${lines.join('\n')}`);
        }
        return true;
      }
      case 'branch': {
        const ctxState = useContextStore.getState();
        const pk = useChatStore.getState().activeProjectKey;
        const branches = pk ? (ctxState.convBranchesByProject[pk] ?? []) : [];
        if (branches.length === 0) {
          respond('활성 브랜치가 없습니다.');
        } else {
          const lines = branches.map(b =>
            `- **${b.label}** (${b.status})${b.id === useChatStore.getState().activeBranchId ? ' ← 현재' : ''}`
          );
          respond(`**브랜치 목록** (${branches.length}개)\n\n${lines.join('\n')}`);
        }
        return true;
      }
      case 'context': {
        const ctxState = useContextStore.getState();
        const ctx = ctxState.projectContext;
        if (!ctx) {
          respond('프로젝트 컨텍스트가 로드되지 않았습니다.');
        } else {
          const engines = Object.entries(ctx.availableEngines)
            .map(([eng, models]) => `- **${eng}**: ${(models as string[]).join(', ') || '(없음)'}`)
            .join('\n');
          respond(
            `**프로젝트 컨텍스트**\n\n` +
            `- 프로젝트: ${ctx.project}\n` +
            `- 엔진: ${ctx.engine || 'default'}\n` +
            `- 모델: ${ctx.model || 'default'}\n` +
            `- 브랜치: ${ctx.convBranches.length}개\n` +
            `- 메모리: ${ctx.memoryEntries.length}개\n\n` +
            `**사용 가능한 엔진**\n${engines}`
          );
        }
        return true;
      }
      default:
        respond(`알 수 없는 커맨드: \`!${cmd}\`\n\`!help\`로 사용 가능한 커맨드를 확인하세요.`);
        return true;
    }
  };

  const handleSend = () => {
    if (!input.trim() || !activeConversationId) return;
    // reply 모드이면 인용 접두사 추가
    const finalText = replyTo
      ? `> ${replyTo.content.split('\n').join('\n> ')}\n\n${input}`
      : input;
    const userMsgId = crypto.randomUUID();
    const userTs = Date.now();
    pushMessage(activeConversationId, {
      id: userMsgId, role: 'user', content: finalText, timestamp: userTs, status: 'done',
    });
    dbSync.syncMessage({ id: userMsgId, conversationId: activeConversationId, role: 'user', content: finalText, timestamp: userTs, status: 'done' });

    // Try local command handling first
    if (handleLocalCommand(finalText, activeConversationId)) {
      setInput('');
      if (activeConversationId) clearDraft(activeConversationId);
      if (replyTo) clearReplyTo();
      setTimeout(() => textareaRef.current?.focus(), 10);
      return;
    }

    if (isMockMode) {
      setTimeout(() => {
        pushMessage(activeConversationId, {
          id: crypto.randomUUID(), role: 'assistant',
          content: `*Preview* — mock response to:\n\n> ${input}`,
          timestamp: Date.now(), status: 'done',
        });
      }, 400);
    } else {
      tauriClient.sendRpc('chat.send', { conversation_id: activeConversationId, text: finalText });
    }
    setInput('');
    if (activeConversationId) clearDraft(activeConversationId);
    if (replyTo) clearReplyTo();
    setTimeout(() => textareaRef.current?.focus(), 10);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showCmdPalette && filteredCmds.length > 0) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCmdIndex(i => (i - 1 + filteredCmds.length) % filteredCmds.length);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCmdIndex(i => (i + 1) % filteredCmds.length);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        handleCmdSelect(filteredCmds[cmdIndex % filteredCmds.length]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setInput('');
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 180) + 'px';
  }, [input]);

  if (!activeConversationId) return null;

  return (
    <div className="p-4 pb-8 flex-shrink-0">
{/* Reply banner */}
      {replyTo && (
        <div className="mb-1.5 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1a1a1a]/95 border border-violet-400/20">
          <ArrowBendUpLeft size={11} className="text-violet-400 shrink-0" />
          <span className="flex-1 text-[11px] text-on-surface-variant/60 truncate leading-tight">{replyTo.content}</span>
          <button onClick={clearReplyTo} className="p-1 rounded-full hover:bg-white/10 text-on-surface-variant/40 hover:text-on-surface-variant transition-colors shrink-0">
            <X size={12} weight="bold" />
          </button>
        </div>
      )}

      <div className="relative bg-[#161616]/95 backdrop-blur-xl rounded-xl border border-white/5 focus-within:border-primary/50 transition-colors shadow-2xl">
        {/* Command palette */}
        {showCmdPalette && (
          <CommandPalette query={cmdQuery} onSelect={handleCmdSelect} selectedIndex={cmdIndex} />
        )}
        {/* QuickChips / Mobile Summary Chip */}
        {activeConversationId && (
          isMobile ? (
            <button
              onClick={() => useSystemStore.getState().setMobileSettingsSheetOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-on-surface-variant/60"
            >
              <Lightning size={12} className="text-primary" />
              <span>{convSettings.engine}{convSettings.model ? `/${convSettings.model}` : ''}</span>
              <span className="text-on-surface-variant/30">&middot;</span>
              <span>{convSettings.persona || 'default'}</span>
              <span className="text-on-surface-variant/30">&middot;</span>
              <span>{convSettings.triggerMode}</span>
              <CaretDown size={10} className="opacity-40" />
            </button>
          ) : (
            <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-0">
              <QuickChipEngine convId={activeConversationId} compact={compact} />
              <QuickChipPersona convId={activeConversationId} compact={compact} />
              <QuickChipTrigger convId={activeConversationId} compact={compact} />
            </div>
          )
        )}

        {/* Git Branch + Merge Button (Top Right) — hidden in compact/mobile mode */}
        {!compact && !isMobile && (
          <div className="absolute top-2.5 right-3 flex items-center gap-1.5">
            {gitBranch && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono text-on-surface-variant/50 bg-white/5">
                <GitBranch size={12} className="text-emerald-400/60" />
                {gitBranch}
              </span>
            )}
            <button
              onClick={() => {
                if (!activeConversationId) return;
                const msgId = crypto.randomUUID();
                const ts = Date.now();
                const text = '커밋해줘';
                pushMessage(activeConversationId, { id: msgId, role: 'user', content: text, timestamp: ts, status: 'done' });
                dbSync.syncMessage({ id: msgId, conversationId: activeConversationId, role: 'user', content: text, timestamp: ts, status: 'done' });
                tauriClient.sendRpc('chat.send', { conversation_id: activeConversationId, text });
              }}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium bg-white/5 hover:bg-white/10 text-on-surface-variant/70 hover:text-on-surface transition-colors cursor-pointer"
            >
              <GitMerge size={14} weight="bold" className="text-emerald-400" />
              <span className="hidden sm:inline">Commit</span>
            </button>
          </div>
        )}


        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => { setInput(e.target.value); setCmdIndex(0); }}
          onKeyDown={handleKeyDown}
          placeholder={placeholderText}
          rows={1}
          className={cn(
            'w-full bg-transparent border-none focus:ring-0 text-[14px] px-4 pt-2 resize-none',
            'placeholder:text-on-surface-variant/15 placeholder:font-light text-on-surface',
            'focus-visible:outline-none focus:outline-none',
            'disabled:cursor-not-allowed disabled:opacity-50',
            isMobile
              ? 'pb-[44px] min-h-[44px] max-h-[120px]'
              : 'pb-[52px] min-h-[100px] max-h-[300px]',
          )}
        />
        <div className="absolute bottom-3 right-3 flex items-center gap-2">
          {isRunning && (
            <button onClick={() => activeConversationId && requestCancel(activeConversationId)} className="p-1.5 hover:bg-white/5 hover:text-error rounded-md text-amber-500 transition-colors" title="Stop">
              <Stop size={18} weight="fill" />
            </button>
          )}
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="bg-primary hover:bg-white text-on-surface-variant hover:text-black px-3 py-1.5 rounded-lg flex items-center gap-2 text-[12px] font-semibold transition-colors disabled:opacity-40 disabled:hover:bg-primary disabled:hover:text-on-surface-variant"
            title="Send"
          >
            <span>Send</span>
            <PaperPlaneRight size={14} weight="bold" />
          </button>
        </div>
      </div>
    </div>
  );
}
