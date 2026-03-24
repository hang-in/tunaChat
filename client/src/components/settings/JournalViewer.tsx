/**
 * JournalViewer — 대화 히스토리 타임라인 뷰어.
 *
 * SQLite에서 전체 대화 목록과 메시지 수를 조회하여 표시.
 * 설정 페이지의 탭 또는 독립 패널로 사용 가능.
 */

import { useState, useEffect } from 'react';
import { useChatStore, type Conversation } from '@/store/chatStore';
import { isTauriEnv } from '@/lib/db';
import { ClockCounterClockwise, ChatCircle, CaretRight } from '@phosphor-icons/react';

interface JournalEntry {
  conv: Conversation;
  messageCount: number;
  lastActivity: number;
}

export function JournalViewer() {
  const conversations = useChatStore(s => s.conversations);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [previewMessages, setPreviewMessages] = useState<Array<{ role: string; content: string; timestamp: number }>>([]);

  // Build journal entries from conversations + message counts
  useEffect(() => {
    const convList = Object.values(conversations);
    const result: JournalEntry[] = convList.map(conv => {
      const msgs = useChatStore.getState().messages[conv.id] || [];
      const lastMsg = msgs[msgs.length - 1];
      return {
        conv,
        messageCount: msgs.length,
        lastActivity: lastMsg?.timestamp || conv.createdAt,
      };
    });
    // Sort by last activity descending
    result.sort((a, b) => b.lastActivity - a.lastActivity);
    setEntries(result);
  }, [conversations]);

  // Load preview messages when selecting a conversation
  const handleSelect = async (convId: string) => {
    setSelectedConvId(convId);
    const msgs = useChatStore.getState().messages[convId] || [];
    if (msgs.length > 0) {
      setPreviewMessages(msgs.slice(-20).map(m => ({
        role: m.role, content: m.content, timestamp: m.timestamp,
      })));
      return;
    }
    // Try loading from SQLite
    if (isTauriEnv()) {
      try {
        const db = await import('@/lib/db');
        const d = await db.initDb();
        const rows = await d.select<Array<{ role: string; content: string; timestamp: number }>>(
          'SELECT role, content, timestamp FROM messages WHERE conversation_id = $1 ORDER BY timestamp DESC LIMIT 20',
          [convId],
        );
        setPreviewMessages(rows.reverse());
      } catch {
        setPreviewMessages([]);
      }
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <ClockCounterClockwise size={18} className="text-primary" />
        <h2 className="text-[14px] font-semibold text-on-surface">대화 저널</h2>
        <span className="text-[11px] text-on-surface-variant/40 ml-auto">
          {entries.length}개 대화
        </span>
      </div>

      <div className="flex gap-4">
        {/* Conversation list */}
        <div className="w-64 shrink-0 space-y-1 max-h-[60vh] overflow-y-auto">
          {entries.map(({ conv, messageCount, lastActivity }) => (
            <button
              key={conv.id}
              onClick={() => handleSelect(conv.id)}
              className={`w-full text-left px-3 py-2 rounded-md transition-colors ${
                selectedConvId === conv.id
                  ? 'bg-primary/10 text-primary'
                  : 'text-on-surface-variant/60 hover:bg-surface-container-high hover:text-on-surface'
              }`}
            >
              <div className="flex items-center gap-2">
                <ChatCircle size={14} className="shrink-0 opacity-50" />
                <span className="text-[13px] truncate flex-1">{conv.label}</span>
                <CaretRight size={10} className="opacity-30 shrink-0" />
              </div>
              <div className="flex items-center gap-2 mt-0.5 pl-[22px]">
                <span className="text-[10px] text-on-surface-variant/30">
                  {messageCount}개 메시지
                </span>
                <span className="text-[10px] text-on-surface-variant/20">
                  {formatRelativeTime(lastActivity)}
                </span>
              </div>
            </button>
          ))}
          {entries.length === 0 && (
            <p className="text-[12px] text-on-surface-variant/30 text-center py-4">
              대화 기록이 없습니다
            </p>
          )}
        </div>

        {/* Message preview */}
        <div className="flex-1 border-l border-outline-variant/20 pl-4 max-h-[60vh] overflow-y-auto">
          {selectedConvId && previewMessages.length > 0 ? (
            <div className="space-y-2">
              {previewMessages.map((msg, i) => (
                <div key={i} className="text-[12px]">
                  <span className={`font-medium ${
                    msg.role === 'user' ? 'text-blue-400' : 'text-emerald-400'
                  }`}>
                    {msg.role === 'user' ? 'User' : 'Assistant'}
                  </span>
                  <span className="text-on-surface-variant/20 text-[10px] ml-2">
                    {new Date(msg.timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <p className="text-on-surface-variant/60 mt-0.5 line-clamp-3 whitespace-pre-wrap">
                    {msg.content.slice(0, 300)}
                    {msg.content.length > 300 && '...'}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-on-surface-variant/30 text-center py-8">
              대화를 선택하면 최근 메시지를 미리봅니다
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}일 전`;
  return new Date(ts).toLocaleDateString('ko-KR');
}
