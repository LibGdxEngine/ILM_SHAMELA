'use client';

import { useEffect, useRef, useState } from 'react';

import { useI18n } from '@/components/i18n/I18nProvider';
import type { ApiChatSession } from '@/lib/api/reader';

import PanelIconButton from './PanelIconButton';

interface AssistantSessionMenuProps {
  sessions: ApiChatSession[];
  activeSessionId: number | null;
  onSwitch: (id: number) => void;
  onNew: () => void;
  onRename: (id: number, title: string) => void;
  onDelete: (id: number) => void;
  disabled?: boolean;
}

/**
 * Conversation switcher dropdown for the assistant header. Lists every session
 * for the current document with inline rename (pencil → controlled input) and a
 * two-tap delete confirm. Open/outside-click/Escape handling mirrors
 * `AppHeaderAvatarMenu`.
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

  // Reset transient row state whenever the menu closes.
  useEffect(() => {
    if (!open) {
      activeEditRef.current = null;
      setEditingId(null);
      setEditValue('');
      setConfirmingDeleteId(null);
    }
  }, [open]);

  const startEditing = (session: ApiChatSession) => {
    if (disabled) return;
    setConfirmingDeleteId(null);
    activeEditRef.current = session.id;
    setEditingId(session.id);
    setEditValue(session.title ?? '');
  };

  const commitEditing = (id: number) => {
    // A stale onBlur (fired after Enter/Escape unmounted the input) is a no-op.
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
      <PanelIconButton
        onClick={() => setOpen((prev) => !prev)}
        label={t('assistant.history', 'Conversations')}
        icon="history"
      />

      {open && (
        <div
          role="menu"
          className="absolute top-full mt-2 z-50 min-w-[260px] max-w-[320px] rounded-[14px] border border-border-strong bg-card-2/95 backdrop-blur-md p-1.5 shadow-[0_18px_42px_-10px_rgba(0,0,0,0.18)]"
          style={{ insetInlineEnd: 0 }}
        >
          <button
            type="button"
            role="menuitem"
            disabled={disabled}
            onClick={() => {
              onNew();
              setOpen(false);
            }}
            className="flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-[13px] text-text-2 transition-colors hover:bg-accent-soft hover:text-accent-2 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg className="h-4 w-4 text-text-3" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden>
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {t('assistant.action.newConversation', 'New conversation')}
          </button>

          <div className="my-1 border-t border-border" />

          <ul role="none" className="max-h-[320px] overflow-y-auto">
            {sessions.map((session) => {
              const isActive = activeSessionId === session.id;
              const isEditing = editingId === session.id;
              const isConfirming = confirmingDeleteId === session.id;
              const label = session.title || t('assistant.session.untitled', 'New conversation');
              return (
                <li key={session.id} role="none" className="group">
                  <div
                    className={`flex items-center gap-1 rounded-[10px] px-1.5 py-1 transition-colors ${
                      isActive ? 'bg-accent-soft text-accent' : 'text-text-2 hover:bg-accent-soft/60'
                    }`}
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
                        className="min-w-0 flex-1 rounded-[8px] border border-border bg-card px-2 py-1 text-[13px] text-text focus:outline-none focus:ring-1 focus:ring-accent/40"
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
                      >
                        <span className="w-full truncate text-[13px] font-medium leading-tight">{label}</span>
                        <span className={`text-[10.5px] ${isActive ? 'text-accent/70' : 'text-text-3'}`}>
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
                            className="rounded-[8px] px-2 py-1 text-[11px] font-medium text-red-600 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {t('assistant.session.confirmDelete', 'Delete this conversation?')}
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              disabled={disabled}
                              onClick={() => startEditing(session)}
                              aria-label={t('assistant.session.rename', 'Rename')}
                              title={t('assistant.session.rename', 'Rename')}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-3 transition-colors hover:bg-white/40 hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                <path d="M12 20h9" />
                                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                              </svg>
                            </button>
                            <PanelIconButton
                              onClick={() => {
                                setConfirmingDeleteId(session.id);
                                setEditingId(null);
                              }}
                              disabled={disabled}
                              label={t('assistant.session.delete', 'Delete')}
                              icon="trash"
                            />
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
