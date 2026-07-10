'use client';

import {
  ChangeEvent,
  KeyboardEvent,
  MouseEvent,
  RefObject,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useCopilotAction, useCopilotChatInternal, useCopilotReadable } from '@copilotkit/react-core';
import { Markdown } from '@copilotkit/react-ui';

import { useI18n } from '@/components/i18n/I18nProvider';
import {
  ApiChatSession,
  ChatContextScope,
  ChatPin,
  listChatMessages,
  storeChatMessage,
} from '@/lib/api/reader';

import AssistantContextBar from './AssistantContextBar';
import AssistantSessionMenu from './AssistantSessionMenu';

/**
 * The reader's in-book AI assistant, on the CopilotKit stack — a floating FAB +
 * slide-in drawer (mirroring the library's `LibraryAssistant`) wired to the
 * book-scoped `readerAgent`. Rendered INSIDE a nested `<CopilotKit
 * agent="readerAgent" threadId=…>` provider (see the reader page), so its
 * `useCopilotChatInternal` / `useCopilotReadable` / `useCopilotAction` bind to
 * that provider and stay isolated from the library assistant.
 *
 * Responsibilities beyond the drawer chrome:
 *  - expose the current book + live page + scope + pins to the agent (readable);
 *  - a `goToPage` action + `[..](#p-N)` citation-link interception for page jumps;
 *  - hydrate the active session's transcript from Django on mount (`setMessages`)
 *    and persist each completed turn back (store-only endpoint), since CopilotKit
 *    chat is otherwise ephemeral;
 *  - an imperative handle so the reader's selection actions can open + drive it.
 *
 * Uses the app's semantic theme tokens (matching the reused AssistantContextBar
 * / AssistantSessionMenu) rather than the library assistant's hardcoded parchment
 * hexes, so the whole surface stays visually consistent.
 */

export interface ReaderAssistantHandle {
  /** Open the drawer and prefill the composer (no send). */
  setDraft: (text: string) => void;
  /** Open the drawer and send the text immediately. */
  ask: (text: string) => void;
  /** Open the drawer and pin a snippet as authoritative context. */
  addPin: (text: string, page: number) => void;
  /** Just open the drawer. */
  open: () => void;
}

interface ReaderAssistantProps {
  documentId: number;
  documentTitle: string;
  /** Active chat session id (drives persistence + hydration). */
  sessionId: number;
  /** Live current page from the reader (sent to the agent + as context_page). */
  currentPage: number;
  /** Controlled open state (lifted to the page so a session-switch remount keeps it). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Scroll the reader to a page (citation click / goToPage action). */
  onCitationClick: (page: number) => void;
  // Session list + CRUD (owned by the page-level useReaderCopilotSessions hook).
  sessions: ApiChatSession[];
  onSwitchSession: (id: number) => void;
  onNewSession: () => void;
  onRenameSession: (id: number, title: string) => void;
  onDeleteSession: (id: number) => void;
  // Per-session context controls.
  contextScope: ChatContextScope;
  onContextScopeChange: (scope: ChatContextScope) => void;
  pins: ChatPin[];
  onAddPin: (text: string, page: number) => void;
  onRemovePin: (index: number) => void;
  onClearPins: () => void;
  /** Called after a turn is persisted so the page can refresh the auto-derived title. */
  onTurnPersisted: () => void;
}

const EASE = [0.2, 0.8, 0.2, 1] as const;

const SUGGESTION_KEYS: Array<{ key: string; fallback: string }> = [
  { key: 'assistant.suggested.summarize', fallback: 'Summarize this page' },
  { key: 'assistant.suggested.find', fallback: 'Find where this book discusses…' },
  { key: 'assistant.suggested.glossary', fallback: 'Define the key terms here' },
];

/** AG-UI message shape returned by `useCopilotChatInternal()` in this build. */
interface ChatMessage {
  id: string;
  role: string;
  content?: unknown;
}

function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p) =>
        p && typeof p === 'object' && 'text' in p
          ? String((p as { text?: unknown }).text ?? '')
          : '',
      )
      .join('');
  }
  return '';
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `msg-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }
}

const ReaderAssistant = forwardRef<ReaderAssistantHandle, ReaderAssistantProps>(
  function ReaderAssistant(
    {
      documentId,
      documentTitle,
      sessionId,
      currentPage,
      open,
      onOpenChange,
      onCitationClick,
      sessions,
      onSwitchSession,
      onNewSession,
      onRenameSession,
      onDeleteSession,
      contextScope,
      onContextScopeChange,
      pins,
      onAddPin,
      onRemovePin,
      onClearPins,
      onTurnPersisted,
    },
    ref,
  ) {
    const { t, direction } = useI18n();
    const isRtl = direction === 'rtl';

    // Internal hook (not the public useCopilotChat, which is broken in 1.61.2 —
    // see LibraryAssistant). Exposes the AG-UI messages + setMessages for
    // hydration, sendMessage, isLoading, stopGeneration.
    const { messages, sendMessage, isLoading, stopGeneration, setMessages } =
      useCopilotChatInternal();

    const [draft, setDraft] = useState('');
    // Gate sends until the session transcript is hydrated, so a fast send can't
    // be clobbered by the hydration setMessages() replace.
    const [hydrated, setHydrated] = useState(false);

    const scrollRef = useRef<HTMLDivElement>(null);
    const taRef = useRef<HTMLTextAreaElement>(null);
    const launcherRef = useRef<HTMLButtonElement>(null);
    // CopilotKit message ids already written to Django (hydrated + persisted).
    const persistedRef = useRef<Set<string>>(new Set());
    // Refresh the session list only once per mount (to pick up the server's
    // first-message auto-title); avoids a full list GET after every turn.
    const titleSyncedRef = useRef(false);

    // ── Expose the current book + live reading state to the agent ──
    useCopilotReadable(
      {
        description:
          'The book the user is currently reading in the reader. Use documentId ' +
          'for every search_within_book / get_book_pages call and answer within ' +
          'THIS book. currentPage is the page on screen; contextScope is how wide ' +
          'to look; pins are passages the user marked as authoritative.',
        value: {
          documentId,
          title: documentTitle,
          currentPage,
          contextScope,
          pins: pins.map((p) => ({ page: p.page, label: p.label, text: p.text })),
        },
      },
      [documentId, documentTitle, currentPage, contextScope, pins],
    );

    // ── A redundant tool path for page jumps (belt-and-suspenders vs links) ──
    useCopilotAction(
      {
        name: 'goToPage',
        description: 'Scroll the reader to a specific page of the current book.',
        parameters: [
          { name: 'page', type: 'number', required: true, description: 'The page number to open.' },
        ],
        handler: async ({ page }: { page: number }) => {
          if (typeof page === 'number' && page > 0) {
            onCitationClick(page);
            return `Opened page ${page}.`;
          }
          return 'Invalid page number.';
        },
      },
      [onCitationClick],
    );

    // ── Hydrate this session's transcript from Django on mount ──
    // The provider remounts per session (keyed on thread id), so a fresh mount
    // == a session load. Seed CopilotKit's message list with the stored history
    // and mark those ids persisted so the persistence effect below skips them.
    useEffect(() => {
      let cancelled = false;
      setHydrated(false);
      (async () => {
        try {
          const history = await listChatMessages(documentId, sessionId);
          if (cancelled) return;
          const mapped = history.map((m) => ({
            id: `db-${m.id}`,
            role: m.role,
            content: m.content,
          }));
          persistedRef.current = new Set(mapped.map((m) => m.id));
          setMessages(mapped as Parameters<typeof setMessages>[0]);
        } catch {
          // Non-fatal: start from an empty transcript.
          persistedRef.current = new Set();
        } finally {
          if (!cancelled) setHydrated(true);
        }
      })();
      return () => {
        cancelled = true;
      };
      // documentId/sessionId are fixed for this mount; setMessages is stable.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [documentId, sessionId]);

    // AG-UI messages are plain { id, role, content }. Keep only user/assistant.
    const allMessages = (messages ?? []) as unknown as ChatMessage[];
    const chatMessages = allMessages.filter(
      (m) => m.role === 'user' || m.role === 'assistant',
    );

    const isEmpty = chatMessages.length === 0;
    const lastAll = allMessages[allMessages.length - 1];
    const awaitingReply =
      isLoading && (!lastAll || lastAll.role === 'user' || lastAll.role === 'tool');

    // ── Persist completed turns back to Django ──
    useEffect(() => {
      if (!hydrated) return;
      for (let i = 0; i < chatMessages.length; i++) {
        const m = chatMessages[i];
        if (persistedRef.current.has(m.id)) continue;
        const text = messageText(m.content);
        if (m.role === 'user') {
          if (!text.trim()) continue;
          persistedRef.current.add(m.id);
          void (async () => {
            try {
              await storeChatMessage(documentId, sessionId, {
                role: 'user',
                content: text,
                context_page: currentPage,
              });
              // First user turn auto-derives the session title server-side —
              // refresh the list once to surface it in the session menu.
              if (!titleSyncedRef.current) {
                titleSyncedRef.current = true;
                onTurnPersisted();
              }
            } catch {
              /* Non-fatal: transcript still shows the message this session. */
            }
          })();
        } else {
          // Assistant: only persist once the turn is finalized (not mid-stream).
          const isLast = i === chatMessages.length - 1;
          if (isLast && isLoading) continue;
          if (!text.trim()) continue;
          persistedRef.current.add(m.id);
          void storeChatMessage(documentId, sessionId, {
            role: 'assistant',
            content: text,
          }).catch(() => {
            /* Non-fatal. */
          });
        }
      }
      // currentPage intentionally read at fire time; chatMessages/isLoading drive it.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chatMessages, isLoading, hydrated, documentId, sessionId]);

    const send = useCallback(
      (raw: string) => {
        const content = raw.trim();
        if (!content || isLoading || !hydrated) return;
        const payload = { id: newId(), role: 'user', content } as Parameters<
          typeof sendMessage
        >[0];
        void sendMessage(payload);
        setDraft('');
      },
      [sendMessage, isLoading, hydrated],
    );

    // ── Intercept the agent's page-citation links [..](#p-N) → scroll ──
    const handleAssistantClick = useCallback(
      (e: MouseEvent<HTMLDivElement>) => {
        const anchor = (e.target as HTMLElement).closest('a');
        const href = anchor?.getAttribute('href') ?? '';
        const match = /^#p-(\d+)$/.exec(href);
        if (match) {
          e.preventDefault();
          onCitationClick(parseInt(match[1], 10));
        }
      },
      [onCitationClick],
    );

    const openDrawer = useCallback(() => onOpenChange(true), [onOpenChange]);
    const closeDrawer = useCallback(() => {
      onOpenChange(false);
      window.setTimeout(() => launcherRef.current?.focus(), 0);
    }, [onOpenChange]);

    // ── Imperative handle for the reader's selection actions ──
    useImperativeHandle(
      ref,
      () => ({
        open: () => onOpenChange(true),
        setDraft: (text: string) => {
          onOpenChange(true);
          setDraft(text);
          window.setTimeout(() => taRef.current?.focus(), 80);
        },
        ask: (text: string) => {
          onOpenChange(true);
          send(text);
        },
        addPin: (text: string, page: number) => {
          onOpenChange(true);
          onAddPin(text, page);
        },
      }),
      [onOpenChange, send, onAddPin],
    );

    // Auto-scroll to the newest content (identity of messages changes per token).
    useEffect(() => {
      if (!open) return;
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }, [open, messages, isLoading]);

    // Focus the composer when the drawer opens.
    useEffect(() => {
      if (!open) return;
      const id = window.setTimeout(() => taRef.current?.focus(), 80);
      return () => window.clearTimeout(id);
    }, [open]);

    // Autogrow the textarea (cap ~5 lines).
    useLayoutEffect(() => {
      const ta = taRef.current;
      if (!ta) return;
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, 5 * 24)}px`;
    }, [draft]);

    const onComposerKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        send(draft);
      }
    };

    const offX = isRtl ? '-100%' : '100%';
    const streamingDisabled = isLoading || !hydrated;

    return (
      <>
        {/* ─── Launcher FAB ─── */}
        <AnimatePresence>
          {!open && (
            <motion.button
              ref={launcherRef}
              type="button"
              onClick={openDrawer}
              aria-label={t('docs.rr.assistant.open', 'Ask the assistant')}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.94 }}
              transition={{ duration: 0.28, ease: EASE }}
              className="group fixed bottom-6 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-b from-accent-2 to-accent text-white shadow-[0_10px_28px_-8px_rgba(0,0,0,0.45)]"
              style={{ insetInlineEnd: '1.5rem' }}
            >
              <SparkIcon size={26} />
              <span
                aria-hidden
                className="absolute h-2.5 w-2.5 animate-live-dot rounded-full bg-green-600 ring-2 ring-card"
                style={{ top: '0.35rem', insetInlineEnd: '0.35rem' }}
              />
            </motion.button>
          )}
        </AnimatePresence>

        {/* ─── Drawer (sticky, non-modal — the reader stays interactive) ─── */}
        <AnimatePresence>
          {open && (
            <motion.aside
              key="reader-drawer"
              aria-label={t('docs.rr.assistant.title', 'AI Assistant')}
              initial={{ x: offX }}
              animate={{ x: 0 }}
              exit={{ x: offX }}
              transition={{ duration: 0.42, ease: EASE }}
              className="fixed z-50 flex w-[min(400px,100vw)] flex-col border-border bg-card shadow-[0_24px_60px_rgba(0,0,0,0.28)]"
              style={{
                insetBlockStart: 0,
                insetBlockEnd: 0,
                insetInlineEnd: 0,
                borderInlineStartWidth: 1,
              }}
            >
              {/* Header */}
              <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-accent text-white">
                  <SparkIcon size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14.5px] font-semibold leading-tight text-text">
                    {t('docs.rr.assistant.title', 'AI Assistant')}
                  </div>
                  <div className="mt-0.5 truncate text-[11.5px] text-text-3">
                    {isLoading
                      ? t('assistant.streaming.thinking', 'Thinking…')
                      : t('docs.rr.assistant.subtitle', 'Reads with you and cites the page')}
                  </div>
                </div>
                <AssistantSessionMenu
                  sessions={sessions}
                  activeSessionId={sessionId}
                  onSwitch={onSwitchSession}
                  onNew={onNewSession}
                  onRename={onRenameSession}
                  onDelete={onDeleteSession}
                  disabled={isLoading}
                />
                <button
                  type="button"
                  onClick={closeDrawer}
                  aria-label={t('docs.rr.assistant.close', 'Close')}
                  className="ms-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-text-3 transition-colors hover:bg-accent-soft hover:text-text"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>

              {/* Messages */}
              <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-5">
                {isEmpty ? (
                  <EmptyState
                    heading={t('assistant.empty.heading', 'Ask anything about this book')}
                    suggestions={SUGGESTION_KEYS.map((s) => t(s.key, s.fallback))}
                    onPick={send}
                  />
                ) : (
                  chatMessages.map((m, i) => (
                    <Bubble
                      key={m.id}
                      role={m.role}
                      content={messageText(m.content)}
                      onLinkClick={handleAssistantClick}
                      streaming={isLoading && i === chatMessages.length - 1 && m.role === 'assistant'}
                    />
                  ))
                )}
                {awaitingReply && (
                  <ThinkingBubble label={t('assistant.streaming.thinking', 'Thinking…')} />
                )}
              </div>

              {/* Context controls (scope + pins) */}
              <AssistantContextBar
                scope={contextScope}
                onScopeChange={onContextScopeChange}
                pins={pins}
                onRemovePin={onRemovePin}
                onClearPins={onClearPins}
                currentPage={currentPage}
                disabled={isLoading}
              />

              {/* Composer */}
              <Composer
                value={draft}
                isLoading={isLoading}
                disabled={streamingDisabled}
                isRtl={isRtl}
                taRef={taRef}
                placeholder={t('assistant.input.placeholder', 'Ask anything about this book…')}
                sendLabel={t('docs.rr.assistant.send', 'Send')}
                stopLabel={t('docs.rr.assistant.stop', 'Stop')}
                hint={t('docs.rr.assistant.sendHint', '⌘+Enter to send')}
                onChange={setDraft}
                onKeyDown={onComposerKey}
                onSend={() => send(draft)}
                onStop={stopGeneration}
              />
            </motion.aside>
          )}
        </AnimatePresence>
      </>
    );
  },
);

export default ReaderAssistant;

/* ───────────────────────── sub-components ───────────────────────── */

function SparkIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2l1.7 7L21 11l-7.3 2L12 22l-1.7-9L3 11l7.3-2z" />
    </svg>
  );
}

function EmptyState({
  heading,
  suggestions,
  onPick,
}: {
  heading: string;
  suggestions: string[];
  onPick: (text: string) => void;
}) {
  return (
    <div className="flex flex-col items-center px-2 pt-8 text-center">
      <span className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft text-accent">
        <SparkIcon size={28} />
      </span>
      <p className="text-[15px] font-semibold text-text">{heading}</p>
      <div className="mt-5 flex w-full flex-col gap-2">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            dir="auto"
            onClick={() => onPick(s)}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card-2 px-4 py-2.5 text-[13px] text-text-2 transition-all hover:-translate-y-[1px] hover:border-border-strong"
          >
            <span className="shrink-0 text-accent">
              <SparkIcon size={13} />
            </span>
            <span dir="auto">{s}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Bubble({
  role,
  content,
  streaming,
  onLinkClick,
}: {
  role: string;
  content: string;
  streaming: boolean;
  onLinkClick?: (e: MouseEvent<HTMLDivElement>) => void;
}) {
  const isUser = role === 'user';
  if (isUser) {
    return (
      <div className="flex justify-end">
        <div
          dir="auto"
          className="max-w-[85%] rounded-2xl rounded-se-[6px] bg-accent px-3.5 py-2.5 text-[13.5px] leading-[1.7] text-white"
        >
          {content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div
        dir="auto"
        onClick={onLinkClick}
        className="reader-assistant-md max-w-[92%] rounded-2xl rounded-ss-[6px] border border-border bg-card-2 px-4 py-3 text-[13.5px] leading-[1.75] text-text-2"
      >
        {content ? <Markdown content={content} /> : null}
        {streaming && (
          <span className="ms-1 inline-block h-3.5 w-[2px] animate-cursor-blink bg-accent align-middle" />
        )}
      </div>
    </div>
  );
}

function ThinkingBubble({ label }: { label: string }) {
  return (
    <div className="flex justify-start">
      <div className="inline-flex items-center gap-2 rounded-2xl rounded-ss-[6px] border border-border bg-card-2 px-4 py-3">
        <span className="h-1.5 w-1.5 animate-live-dot rounded-full bg-accent" />
        <span className="text-[12.5px] text-text-3">{label}</span>
      </div>
    </div>
  );
}

function Composer({
  value,
  isLoading,
  disabled,
  isRtl,
  taRef,
  placeholder,
  sendLabel,
  stopLabel,
  hint,
  onChange,
  onKeyDown,
  onSend,
  onStop,
}: {
  value: string;
  isLoading: boolean;
  disabled: boolean;
  isRtl: boolean;
  taRef: RefObject<HTMLTextAreaElement>;
  placeholder: string;
  sendLabel: string;
  stopLabel: string;
  hint: string;
  onChange: (v: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  onStop: () => void;
}) {
  return (
    <div className="shrink-0 border-t border-border px-4 pb-4 pt-2">
      <div className="mb-1.5 flex justify-end text-[11px] text-text-3">{hint}</div>
      <div className="flex items-end gap-2 rounded-[18px] border border-border bg-card-2 px-3 py-2.5 transition-shadow focus-within:shadow-[0_0_0_4px_var(--tw-ring-color,rgba(0,0,0,0.06))]">
        <textarea
          ref={taRef}
          value={value}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          dir="auto"
          placeholder={placeholder}
          className="min-h-[24px] flex-1 resize-none bg-transparent text-[14px] leading-6 text-text placeholder:text-text-3 focus:outline-none"
        />
        {isLoading ? (
          <button
            type="button"
            onClick={onStop}
            aria-label={stopLabel}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            onClick={onSend}
            disabled={disabled || !value.trim()}
            aria-label={sendLabel}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-white transition-colors hover:bg-accent-2 disabled:opacity-40"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ transform: isRtl ? 'scaleX(-1)' : undefined }}
              aria-hidden
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
