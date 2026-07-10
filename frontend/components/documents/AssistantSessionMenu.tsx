'use client';

import { useEffect, useRef, useState } from 'react';

import { useI18n } from '@/components/i18n/I18nProvider';
import type { ApiLibrarySession } from '@/lib/api/library-chat';

// Parchment palette — kept in sync with LibraryAssistant so the dropdown reads
// as part of the same on-brand drawer rather than the reader's dark chrome.
const GOLD = '#b07d2b';
const PAPER_CARD = '#fcf8ee';
const PAPER_SOFT = '#f7efdc';
const LINE = '#e7dbc1';
const INK_DEEP = '#2c2620';
const INK_WARM = '#6e6354';
const ACCENT_SOFT = 'rgba(176,125,43,0.12)';

interface AssistantSessionMenuProps {
  sessions: ApiLibrarySession[];
  activeSessionId: number | null;
  onSwitch: (id: number) => void;
  onNew: () => void;
  onRename: (id: number, title: string) => void;
  onDelete: (id: number) => void;
  disabled?: boolean;
}

/**
 * Conversation switcher for the library-assistant header. Lists every session
 * for the current user with inline rename (pencil → controlled input) and a
 * two-tap delete confirm. Behaviour mirrors the reader's AssistantSessionMenu;
 * only the presentation is re-skinned to the parchment palette.
 */
export default function AssistantSessionMenu({
  sessions,
  activeSessionId,
  onSwitch,
  onNew,
  onRename,
  onDelete,
  disabled,
}: AssistantSessionMenuProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  // Which row is genuinely mid-edit. Guards the input's onBlur so unmounting it
  // (via Enter/Escape) doesn't re-run the commit against a stale closure.
  const activeEditRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      activeEditRef.current = null;
      setEditingId(null);
      setEditValue('');
      setConfirmingDeleteId(null);
    }
  }, [open]);

  const startEditing = (session: ApiLibrarySession) => {
    if (disabled) return;
    setConfirmingDeleteId(null);
    activeEditRef.current = session.id;
    setEditingId(session.id);
    setEditValue(session.title ?? '');
  };

  const commitEditing = (id: number) => {
    if (activeEditRef.current !== id) return;
    activeEditRef.current = null;
    const next = editValue.trim();
    if (next) onRename(id, next);
    setEditingId(null);
    setEditValue('');
  };

  const cancelEditing = () => {
    activeEditRef.current = null;
    setEditingId(null);
    setEditValue('');
  };

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={t('docs.rr.assistant.history', 'Conversations')}
        title={t('docs.rr.assistant.history', 'Conversations')}
        className="inline-flex h-8 w-8 items-center justify-center rounded-[9px] transition-colors"
        style={{ color: INK_WARM }}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
          <path d="M3 3v5h5" />
          <path d="M12 7v5l3 2" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-full z-[60] mt-2 min-w-[248px] max-w-[300px] rounded-[14px] p-1.5"
          style={{
            insetInlineEnd: 0,
            background: PAPER_CARD,
            border: `1px solid ${LINE}`,
            boxShadow: '0 18px 42px -10px rgba(44,38,32,0.28)',
          }}
        >
          <button
            type="button"
            role="menuitem"
            disabled={disabled}
            onClick={() => {
              onNew();
              setOpen(false);
            }}
            className="flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-[13px] transition-colors hover:bg-[rgba(176,125,43,0.1)] disabled:cursor-not-allowed disabled:opacity-40"
            style={{ color: INK_DEEP }}
          >
            <svg className="h-4 w-4" style={{ color: GOLD }} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden>
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {t('docs.rr.assistant.newConversation', 'New conversation')}
          </button>

          <div className="my-1 border-t" style={{ borderColor: LINE }} />

          {sessions.length === 0 ? (
            <div className="px-3 py-3 text-[12px]" style={{ color: INK_WARM }}>
              {t('docs.rr.assistant.emptyConversations', 'No conversations yet')}
            </div>
          ) : (
            <ul role="none" className="max-h-[320px] overflow-y-auto">
              {sessions.map((session) => {
                const isActive = activeSessionId === session.id;
                const isEditing = editingId === session.id;
                const isConfirming = confirmingDeleteId === session.id;
                const label =
                  session.title || t('docs.rr.assistant.untitled', 'New conversation');
                return (
                  <li key={session.id} role="none">
                    <div
                      className="flex items-center gap-1 rounded-[10px] px-1.5 py-1 transition-colors"
                      style={isActive ? { background: ACCENT_SOFT } : undefined}
                    >
                      {isEditing ? (
                        <input
                          autoFocus
                          value={editValue}
                          onChange={(event) => setEditValue(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              commitEditing(session.id);
                            } else if (event.key === 'Escape') {
                              event.preventDefault();
                              event.stopPropagation();
                              cancelEditing();
                            }
                          }}
                          onBlur={() => commitEditing(session.id)}
                          className="min-w-0 flex-1 rounded-[8px] px-2 py-1 text-[13px] focus:outline-none"
                          style={{
                            background: PAPER_SOFT,
                            border: `1px solid ${GOLD}55`,
                            color: INK_DEEP,
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          role="menuitem"
                          disabled={disabled}
                          onClick={() => {
                            if (!isActive) onSwitch(session.id);
                            setOpen(false);
                          }}
                          className="flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-[8px] px-2 py-1 text-start disabled:cursor-not-allowed disabled:opacity-60"
                          style={{ color: isActive ? GOLD : INK_DEEP }}
                        >
                          <span className="w-full truncate text-[13px] font-medium leading-tight">
                            {label}
                          </span>
                          <span className="text-[10.5px]" style={{ color: INK_WARM }}>
                            {new Date(session.updated_at).toLocaleDateString()}
                          </span>
                        </button>
                      )}

                      {!isEditing && (
                        <div className="flex shrink-0 items-center gap-0.5">
                          {isConfirming ? (
                            <button
                              type="button"
                              disabled={disabled}
                              onClick={() => {
                                onDelete(session.id);
                                setConfirmingDeleteId(null);
                              }}
                              className="rounded-[8px] px-2 py-1 text-[11px] font-medium text-red-700 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {t('docs.rr.assistant.confirmDelete', 'Delete this conversation?')}
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                disabled={disabled}
                                onClick={() => startEditing(session)}
                                aria-label={t('docs.rr.assistant.rename', 'Rename')}
                                title={t('docs.rr.assistant.rename', 'Rename')}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[rgba(176,125,43,0.14)] disabled:cursor-not-allowed disabled:opacity-40"
                                style={{ color: INK_WARM }}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                  <path d="M12 20h9" />
                                  <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                disabled={disabled}
                                onClick={() => {
                                  setConfirmingDeleteId(session.id);
                                  setEditingId(null);
                                }}
                                aria-label={t('docs.rr.assistant.delete', 'Delete')}
                                title={t('docs.rr.assistant.delete', 'Delete')}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-red-500/10 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                                style={{ color: INK_WARM }}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                  <path d="M3 6h18" />
                                  <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
                                  <path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6" />
                                </svg>
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
