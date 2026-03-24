/**
 * SettingsPage — tunaChat 설정 관리.
 *
 * 엔진별 설정, 모델 선택, 기본값 관리.
 * systemStore.settingsOpen으로 토글.
 */

import { useState, useEffect } from 'react';
import { useChatStore } from '@/store/chatStore';
import { useSystemStore } from '@/store/systemStore';
import { invoke } from '@tauri-apps/api/core';
import { isTauriEnv } from '@/lib/db';
import { X, Gear, Robot, Lightning, ArrowClockwise, ClockCounterClockwise } from '@phosphor-icons/react';
import { JournalViewer } from './JournalViewer';

type SettingsTab = 'general' | 'engines' | 'journal' | 'advanced';

const ENGINE_INFO = [
  { id: 'claude', label: 'Claude', desc: 'Anthropic Claude Code CLI', cmd: 'claude' },
  { id: 'gemini', label: 'Gemini', desc: 'Google Gemini CLI', cmd: 'gemini' },
  { id: 'codex', label: 'Codex', desc: 'OpenAI Codex CLI', cmd: 'codex' },
  { id: 'opencode', label: 'OpenCode', desc: 'SST OpenCode CLI', cmd: 'opencode' },
] as const;

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const close = () => useSystemStore.getState().setSettingsOpen(false);

  return (
    <div className="flex h-full bg-surface-container-lowest">
      {/* Left nav */}
      <nav className="w-48 shrink-0 border-r border-outline-variant/30 py-4 px-2 flex flex-col gap-0.5">
        <TabButton active={activeTab === 'general'} onClick={() => setActiveTab('general')} icon={<Gear size={16} />} label="일반" />
        <TabButton active={activeTab === 'engines'} onClick={() => setActiveTab('engines')} icon={<Robot size={16} />} label="엔진" />
        <TabButton active={activeTab === 'journal'} onClick={() => setActiveTab('journal')} icon={<ClockCounterClockwise size={16} />} label="저널" />
        <TabButton active={activeTab === 'advanced'} onClick={() => setActiveTab('advanced')} icon={<Lightning size={16} />} label="고급" />
      </nav>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/30">
          <h1 className="text-[15px] font-semibold text-on-surface">설정</h1>
          <button onClick={close} className="size-8 flex items-center justify-center rounded-md text-on-surface-variant/60 hover:text-on-surface hover:bg-surface-container-high transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-5 max-w-xl">
          {activeTab === 'general' && <GeneralTab />}
          {activeTab === 'engines' && <EnginesTab />}
          {activeTab === 'journal' && <JournalViewer />}
          {activeTab === 'advanced' && <AdvancedTab />}
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 rounded-md text-[13px] transition-colors ${
        active ? 'bg-primary/10 text-primary font-medium' : 'text-on-surface-variant/60 hover:text-on-surface hover:bg-surface-container-high'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function GeneralTab() {
  const activeProjectKey = useChatStore(s => s.activeProjectKey);
  const projects = useChatStore(s => s.projects);
  const activeProject = projects.find(p => p.key === activeProjectKey);
  const [workspaceRoot, setWorkspaceRoot] = useState(() => {
    try { return localStorage.getItem('tunachat:workspaceRoot') || ''; } catch { return ''; }
  });
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState('');

  const handleSelectFolder = async () => {
    if (!isTauriEnv()) return;
    // Tauri dialog plugin may not be installed — prompt for manual input
    const input = window.prompt('워크스페이스 루트 폴더 경로를 입력하세요:', workspaceRoot || 'D:\\projects');
    if (input) {
      setWorkspaceRoot(input);
      localStorage.setItem('tunachat:workspaceRoot', input);
      handleScan(input);
    }
  };

  const handleScan = async (root?: string) => {
    const scanPath = root || workspaceRoot;
    if (!scanPath || !isTauriEnv()) return;
    setScanning(true);
    setScanResult('');
    try {
      const results = await invoke<Array<{
        key: string; name: string; path: string; type: string;
        defaultEngine: string; gitBranch: string | null;
      }>>('scan_workspace', { root: scanPath });

      if (results.length === 0) {
        setScanResult('프로젝트를 찾지 못했습니다.');
        setScanning(false);
        return;
      }

      // Merge with existing projects (keep existing sessions, add new ones)
      const chat = useChatStore.getState();
      const existingKeys = new Set(chat.projects.map(p => p.key));
      const merged = [
        ...chat.projects,
        ...results
          .filter(r => !existingKeys.has(r.key))
          .map(r => ({
            key: r.key, name: r.name, path: r.path,
            defaultEngine: r.defaultEngine,
            source: 'configured' as const,
            type: r.type as 'project' | 'channel',
          })),
      ];
      // Update path, type, and source for existing projects
      const updated = merged.map(p => {
        const scanned = results.find(r => r.key === p.key);
        if (!scanned) return p;
        return {
          ...p,
          path: scanned.path || p.path,
          type: (scanned.type as 'project' | 'channel') || p.type,
          source: 'configured' as const,
        };
      });
      chat.setProjects(updated);

      // Persist to DB
      const { syncProject } = await import('@/lib/dbSync');
      for (const r of results) {
        syncProject({
          key: r.key, name: r.name, path: r.path,
          defaultEngine: r.defaultEngine,
          source: 'configured',
          type: r.type,
        });
      }

      const projectCount = results.filter(r => r.type === 'project').length;
      const chatCount = results.filter(r => r.type === 'chat').length;
      setScanResult(`${results.length}개 발견 (${projectCount} project${chatCount > 0 ? `, ${chatCount} chat` : ''})`);
    } catch (err) {
      setScanResult(`스캔 실패: ${err}`);
    }
    setScanning(false);
  };

  return (
    <div className="space-y-6">
      <Section title="워크스페이스">
        <div className="flex items-center gap-2 mb-2">
          <input
            type="text"
            value={workspaceRoot}
            onChange={e => {
              setWorkspaceRoot(e.target.value);
              localStorage.setItem('tunachat:workspaceRoot', e.target.value);
            }}
            placeholder="D:\projects"
            className="flex-1 bg-surface-container-high border border-outline-variant/40 rounded-md px-3 py-1.5 text-[13px] text-on-surface font-mono outline-none focus:border-primary"
          />
          <button
            onClick={handleSelectFolder}
            className="px-3 py-1.5 text-[12px] bg-surface-container-high border border-outline-variant/40 rounded-md text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest transition-colors"
          >
            폴더 선택
          </button>
          <button
            onClick={() => handleScan()}
            disabled={scanning || !workspaceRoot}
            className="px-3 py-1.5 text-[12px] bg-primary/10 text-primary rounded-md hover:bg-primary/20 transition-colors disabled:opacity-40"
          >
            {scanning ? '스캔 중...' : '스캔'}
          </button>
        </div>
        {scanResult && (
          <p className="text-[11px] text-on-surface-variant/50">{scanResult}</p>
        )}
      </Section>

      <Section title="활성 프로젝트">
        <div className="text-[13px] text-on-surface/80">
          {activeProject?.name || '없음'}
          {activeProject?.path && (
            <span className="ml-2 text-on-surface-variant/40 font-mono text-[11px]">{activeProject.path}</span>
          )}
        </div>
        {projects.length > 1 && (
          <select
            className="mt-2 bg-surface-container-high border border-outline-variant/40 rounded-md px-3 py-1.5 text-[13px] text-on-surface outline-none focus:border-primary w-full"
            value={activeProjectKey || ''}
            onChange={e => useChatStore.getState().setActiveProject(e.target.value)}
          >
            {projects.map(p => (
              <option key={p.key} value={p.key}>{p.name} [{p.source}] {p.path ? `(${p.path})` : ''}</option>
            ))}
          </select>
        )}
      </Section>
      <Section title="기본 엔진">
        <select
          className="bg-surface-container-high border border-outline-variant/40 rounded-md px-3 py-1.5 text-[13px] text-on-surface outline-none focus:border-primary"
          value={activeProject?.defaultEngine || 'claude'}
          onChange={(e) => {
            if (activeProject) {
              useChatStore.getState().setProjects(
                projects.map(p => p.key === activeProjectKey ? { ...p, defaultEngine: e.target.value } : p)
              );
            }
          }}
        >
          {ENGINE_INFO.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
        </select>
      </Section>
    </div>
  );
}

function EnginesTab() {
  const [models, setModels] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(false);

  const fetchModels = async () => {
    if (!isTauriEnv()) return;
    setLoading(true);
    try {
      for (const engine of ENGINE_INFO) {
        await invoke<number>('list_models', { engine: engine.id });
      }
    } catch { /* ignore */ }
    // Fallback models
    setModels({
      claude: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
      gemini: ['gemini-2.5-pro', 'gemini-2.5-flash'],
      codex: ['o3', 'o4-mini'],
      opencode: [],
    });
    setLoading(false);
  };

  useEffect(() => { fetchModels(); }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[12px] font-medium text-on-surface-variant/60 uppercase tracking-wider">엔진 및 모델</h2>
        <button
          onClick={fetchModels}
          disabled={loading}
          className="text-[11px] text-primary/60 hover:text-primary flex items-center gap-1 disabled:opacity-40"
        >
          <ArrowClockwise size={12} className={loading ? 'animate-spin' : ''} />
          새로고침
        </button>
      </div>

      {ENGINE_INFO.map(engine => (
        <div key={engine.id} className="p-4 rounded-lg border border-outline-variant/30 bg-surface-container-low">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-[14px] font-medium text-on-surface">{engine.label}</h3>
              <p className="text-[12px] text-on-surface-variant/50">{engine.desc}</p>
            </div>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
              CLI: {engine.cmd}
            </span>
          </div>

          {/* Model list */}
          {models[engine.id] && models[engine.id].length > 0 && (
            <div className="mt-2">
              <div className="text-[11px] text-on-surface-variant/50 mb-1.5">사용 가능한 모델</div>
              <div className="flex flex-wrap gap-1.5">
                {models[engine.id].map(m => (
                  <span key={m} className="text-[11px] px-2 py-0.5 rounded bg-surface-container-high text-on-surface-variant/70 font-mono">
                    {m}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function AdvancedTab() {
  return (
    <div className="space-y-6">
      <Section title="데이터">
        <p className="text-[12px] text-on-surface-variant/50 mb-2">
          모든 데이터는 로컬 SQLite에 저장됩니다 (tunachat.db).
        </p>
      </Section>
      <Section title="sidecar">
        <p className="text-[12px] text-on-surface-variant/50">
          Python sidecar가 CLI 에이전트를 관리합니다.
          앱 시작 시 자동으로 시작됩니다.
        </p>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-[12px] font-medium text-on-surface-variant/60 uppercase tracking-wider mb-2">{title}</h2>
      {children}
    </div>
  );
}
