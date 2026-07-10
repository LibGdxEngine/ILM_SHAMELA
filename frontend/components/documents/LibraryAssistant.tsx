'use client';

import {
  ChangeEvent,
  CSSProperties,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
  RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { Markdown } from '@copilotkit/react-ui';

import StarMark from '@/components/landing/StarMark';
import { useI18n } from '@/components/i18n/I18nProvider';
import { useLocalizedPath } from '@/lib/i18n/navigation';
import type { AssistantDock, AssistantEdge } from '@/lib/documents/useAssistantDock';
import { messageText, useLibraryChat } from '@/lib/documents/useLibraryChat';
import AssistantSessionMenu from './AssistantSessionMenu';

/**
 * The Reading Room's AI library assistant — a bespoke, on-brand replacement for
 * CopilotKit's default popup. It drives the *same* backend: this component only
 * swaps the presentation, using the headless `useCopilotChat()` hook so the
 * `<CopilotKit agent="libraryAgent">` provider, the /api/copilotkit route, and
 * the page's `useCopilotAction` handlers (which move results/filters) keep
 * working untouched.
 *
 * Shape: a gold khatim-star launcher pinned to the inline-end/bottom corner
 * opens a full-height edge drawer themed to the landing page (parchment + gold,
 * Reem Kufi, framer-motion). Fully RTL-aware — direction drives the slide and
 * the send-icon flip (Tailwind `rtl:` variants are not registered in this app).
 */

// Parchment palette — kept as explicit hexes (matching the landing page + the
// prior LibraryAssistantPanel) so the fixed-position drawer renders identically
// regardless of which shell wraps its DOM ancestor.
const GOLD = '#b07d2b';
const GOLD_2 = '#c99a4e';
const GOLD_HOVER = '#9c6c24';
const ON_GOLD = '#fbf6ea';
const PAPER_CARD = '#fcf8ee';
const PAPER_SOFT = '#f7efdc';
const LINE = '#e7dbc1';
const INK_DEEP = '#2c2620';
const INK_WARM = '#6e6354';
const GREEN = '#2e5347';

const EASE = [0.2, 0.8, 0.2, 1] as const;

const SUGGESTION_KEYS: Array<{ key: string; fallback: string }> = [
  { key: 'docs.rr.assistant.suggest1', fallback: 'Al-Ghazali on Sufism' },
  { key: 'docs.rr.assistant.suggest2', fallback: 'The major hadith collections' },
  { key: 'docs.rr.assistant.suggest3', fallback: "Ibn Sina's works on medicine" },
];

export default function LibraryAssistant({ dock }: { dock: AssistantDock }) {
  const { t, direction } = useI18n();
  const isRtl = direction === 'rtl';
  // All CopilotKit coupling + durable session/history management lives in this
  // hook: it owns `useCopilotChatInternal()`/`useThreads()`, restores the last
  // conversation on mount, and persists each turn to Django.
  const {
    messages,
    isLoading,
    send,
    stopGeneration,
    sessions,
    activeSessionId,
    switchSession,
    startNewSession,
    renameSession,
    deleteSession,
  } = useLibraryChat();

  const router = useRouter();
  const localizedPath = useLocalizedPath();

  // The agent renders cited books as Markdown links to `/documents/{id}`.
  // Intercept those clicks so they open the reader via client-side nav in the
  // current locale, instead of a full reload to a non-localized path.
  const handleAssistantClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const anchor = (e.target as HTMLElement).closest('a');
      const href = anchor?.getAttribute('href') ?? '';
      if (/^\/documents(\/|$|\?)/.test(href)) {
        e.preventDefault();
        router.push(localizedPath(href));
      }
    },
    [router, localizedPath],
  );

  const open = dock.open;
  const [draft, setDraft] = useState('');

  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);

  // AG-UI messages are plain `{ id, role, content }`. Show only user/assistant
  // turns (skip the agent's tool/result plumbing).
  const allMessages = messages;
  const chatMessages = allMessages.filter(
    (m) => m.role === 'user' || m.role === 'assistant',
  );

  const isEmpty = chatMessages.length === 0;
  const lastAll = allMessages[allMessages.length - 1];
  const awaitingReply =
    isLoading && (!lastAll || lastAll.role === 'user' || lastAll.role === 'tool');

  // Send the composer draft, then clear it (the hook guards empty / mid-run).
  const submit = useCallback(
    (raw: string) => {
      const content = raw.trim();
      if (!content || isLoading) return;
      send(content);
      setDraft('');
    },
    [send, isLoading],
  );

  const openDrawer = useCallback(() => dock.setOpen(true), [dock]);
  const closeDrawer = useCallback(() => {
    dock.setOpen(false);
    window.setTimeout(() => launcherRef.current?.focus(), 0);
  }, [dock]);

  // Auto-scroll to the newest content (identity of `messages` changes on every
  // streamed token, so this also tracks streaming growth).
  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, messages, isLoading]);

  // Focus the composer when the drawer opens. There is deliberately NO
  // Esc-to-close and NO outside-click/scrim close — the panel stays open until
  // the user explicitly closes it via the header button.
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => taRef.current?.focus(), 80);
    return () => window.clearTimeout(id);
  }, [open]);

  // Autogrow the textarea (cap at ~5 lines).
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 5 * 24)}px`;
  }, [draft]);

  const onComposerKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit(draft);
    }
  };

  // Edge-aware geometry (PHYSICAL left/right/bottom so the choice is unambiguous
  // under RTL). Left/right = full-height side column; bottom = full-width sheet.
  const edge = dock.edge;
  const isBottom = edge === 'bottom';
  const drawerOffscreen = isBottom
    ? { y: '100%' }
    : edge === 'left'
      ? { x: '-100%' }
      : { x: '100%' };
  const drawerOnscreen = isBottom ? { y: 0 } : { x: 0 };
  const drawerInset: CSSProperties = isBottom
    ? { left: 0, right: 0, bottom: 0, borderTop: `1px solid ${GOLD}33` }
    : edge === 'left'
      ? { top: 0, bottom: 0, left: 0, borderRight: `1px solid ${GOLD}33` }
      : { top: 0, bottom: 0, right: 0, borderLeft: `1px solid ${GOLD}33` };
  const drawerSizeClass = isBottom
    ? 'inset-x-0 h-[min(60vh,420px)]'
    : 'w-[min(400px,100vw)]';
  const fabInset: CSSProperties = edge === 'left' ? { left: '1.5rem' } : { right: '1.5rem' };

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
            className="group fixed bottom-6 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full"
            style={{
              ...fabInset,
              background: `linear-gradient(to bottom, ${GOLD_2}, ${GOLD})`,
              color: ON_GOLD,
              boxShadow:
                '0 10px 28px -8px rgba(176,125,43,0.6), inset 0 1px 0 rgba(255,255,255,0.25)',
            }}
          >
            <StarMark size={30} className="text-[#fbf6ea]" holeColor={GOLD} />
            <span
              aria-hidden
              className="absolute h-2.5 w-2.5 animate-live-dot rounded-full"
              style={{
                top: '0.35rem',
                insetInlineEnd: '0.35rem',
                background: GREEN,
                boxShadow: `0 0 0 2px ${PAPER_SOFT}`,
              }}
            />
          </motion.button>
        )}
      </AnimatePresence>

      {/* ─── Drawer (sticky, non-modal — the library page stays interactive) ─── */}
      <AnimatePresence>
        {open && (
            <motion.aside
              key="drawer"
              aria-label={t('docs.rr.assistant.title', 'AI Assistant')}
              initial={drawerOffscreen}
              animate={drawerOnscreen}
              exit={drawerOffscreen}
              transition={{ duration: 0.42, ease: EASE }}
              className={`fixed z-50 flex flex-col ${drawerSizeClass}`}
              style={{
                ...drawerInset,
                background: `linear-gradient(to bottom, ${PAPER_CARD}, ${PAPER_SOFT})`,
                boxShadow: '0 24px 60px rgba(44,38,32,0.28)',
              }}
            >
              <Header
                title={t('docs.rr.assistant.title', 'AI Assistant')}
                subtitle={t('docs.rr.assistant.subtitle', 'Reads with you and cites the source')}
                closeLabel={t('docs.rr.assistant.close', 'Close')}
                onClose={closeDrawer}
                controls={
                  <>
                    <AssistantSessionMenu
                      sessions={sessions}
                      activeSessionId={activeSessionId}
                      onSwitch={switchSession}
                      onNew={startNewSession}
                      onRename={renameSession}
                      onDelete={deleteSession}
                      disabled={isLoading}
                    />
                    <LayoutMenu
                      pinned={dock.pinned}
                      edge={dock.edge}
                      onTogglePin={() => dock.setPinned(!dock.pinned)}
                      onEdge={dock.setEdge}
                      pinLabel={t('docs.rr.assistant.pin', 'Dock panel')}
                      unpinLabel={t('docs.rr.assistant.unpin', 'Float panel')}
                      positionLabel={t('docs.rr.assistant.position', 'Position')}
                      leftLabel={t('docs.rr.assistant.dockLeft', 'Dock left')}
                      rightLabel={t('docs.rr.assistant.dockRight', 'Dock right')}
                      bottomLabel={t('docs.rr.assistant.dockBottom', 'Dock bottom')}
                    />
                  </>
                }
              />

              <div
                ref={scrollRef}
                className="flex-1 space-y-4 overflow-y-auto px-4 py-5"
              >
                {isEmpty ? (
                  <EmptyState
                    heading={t('docs.rr.assistant.welcome', 'Ask me about any book in the library.')}
                    suggestions={SUGGESTION_KEYS.map((s) => t(s.key, s.fallback))}
                    onPick={submit}
                  />
                ) : (
                  chatMessages.map((m, i) => (
                    <Bubble
                      key={m.id}
                      role={m.role}
                      content={messageText(m.content)}
                      onLinkClick={handleAssistantClick}
                      streaming={
                        isLoading && i === chatMessages.length - 1 && m.role === 'assistant'
                      }
                    />
                  ))
                )}

                {awaitingReply && (
                  <ThinkingBubble label={t('docs.rr.assistant.searching', 'Searching the library…')} />
                )}
              </div>

              <Composer
                value={draft}
                isLoading={isLoading}
                isRtl={isRtl}
                taRef={taRef}
                placeholder={t('docs.rr.assistant.inputPlaceholder', 'Ask about any book…')}
                sendLabel={t('docs.rr.assistant.send', 'Send')}
                stopLabel={t('docs.rr.assistant.stop', 'Stop')}
                hint={t('docs.rr.assistant.sendHint', '⌘+Enter to send')}
                onChange={setDraft}
                onKeyDown={onComposerKey}
                onSend={() => submit(draft)}
                onStop={stopGeneration}
              />
            </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}

/* ───────────────────────── sub-components ───────────────────────── */

function Header({
  title,
  subtitle,
  closeLabel,
  onClose,
  controls,
}: {
  title: string;
  subtitle: string;
  closeLabel: string;
  onClose: () => void;
  controls?: ReactNode;
}) {
  return (
    <div
      className="flex shrink-0 items-center gap-2 px-4 py-4"
      style={{ borderBottom: `1px solid ${LINE}` }}
    >
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px]"
        style={{ background: GOLD }}
      >
        <StarMark size={22} className="text-[#fbf6ea]" holeColor={GOLD} />
      </span>
      <div className="min-w-0 flex-1">
        <div
          className="font-reem-kufi text-[15.5px] font-semibold leading-tight"
          style={{ color: INK_DEEP }}
        >
          {title}
        </div>
        <div className="mt-0.5 truncate text-[11.5px]" style={{ color: INK_WARM }}>
          {subtitle}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {controls}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label={closeLabel}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[rgba(176,125,43,0.12)]"
        style={{ color: INK_WARM }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}

/**
 * Compact popover for the drawer's layout controls: a dock/float (pin) toggle
 * and a left/right/bottom edge picker. Keeps the header uncluttered at 400px.
 */
function LayoutMenu({
  pinned,
  edge,
  onTogglePin,
  onEdge,
  pinLabel,
  unpinLabel,
  positionLabel,
  leftLabel,
  rightLabel,
  bottomLabel,
}: {
  pinned: boolean;
  edge: AssistantEdge;
  onTogglePin: () => void;
  onEdge: (edge: AssistantEdge) => void;
  pinLabel: string;
  unpinLabel: string;
  positionLabel: string;
  leftLabel: string;
  rightLabel: string;
  bottomLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: globalThis.MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const edges: Array<{ value: AssistantEdge; label: string; icon: ReactNode }> = [
    {
      value: 'left',
      label: leftLabel,
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <rect x="3" y="4" width="7" height="16" rx="1" fill="currentColor" opacity="0.35" />
        </svg>
      ),
    },
    {
      value: 'right',
      label: rightLabel,
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <rect x="14" y="4" width="7" height="16" rx="1" fill="currentColor" opacity="0.35" />
        </svg>
      ),
    },
    {
      value: 'bottom',
      label: bottomLabel,
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <rect x="3" y="13" width="18" height="7" rx="1" fill="currentColor" opacity="0.35" />
        </svg>
      ),
    },
  ];

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={positionLabel}
        title={positionLabel}
        className="inline-flex h-8 w-8 items-center justify-center rounded-[9px] transition-colors hover:bg-[rgba(176,125,43,0.12)]"
        style={{ color: pinned ? GOLD : INK_WARM }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 17v5" />
          <path d="M9 10.76V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v6.76a2 2 0 0 0 .58 1.41L18 14H6l1.42-1.83A2 2 0 0 0 9 10.76Z" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-full z-[60] mt-2 w-[220px] rounded-[14px] p-2"
          style={{
            insetInlineEnd: 0,
            background: PAPER_CARD,
            border: `1px solid ${LINE}`,
            boxShadow: '0 18px 42px -10px rgba(44,38,32,0.28)',
          }}
        >
          <button
            type="button"
            onClick={onTogglePin}
            className="flex w-full items-center justify-between gap-2 rounded-[10px] px-3 py-2 text-[13px] transition-colors hover:bg-[rgba(176,125,43,0.1)]"
            style={{ color: INK_DEEP }}
          >
            <span className="flex items-center gap-2">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{ color: pinned ? GOLD : INK_WARM }} aria-hidden>
                <path d="M12 17v5" />
                <path d="M9 10.76V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v6.76a2 2 0 0 0 .58 1.41L18 14H6l1.42-1.83A2 2 0 0 0 9 10.76Z" />
              </svg>
              {pinned ? unpinLabel : pinLabel}
            </span>
            <span
              className="inline-flex h-[18px] w-[30px] items-center rounded-full px-[2px] transition-colors"
              style={{ background: pinned ? GOLD : LINE }}
            >
              <span
                className="h-[14px] w-[14px] rounded-full bg-white transition-transform"
                style={{ transform: pinned ? 'translateX(12px)' : 'translateX(0)' }}
              />
            </span>
          </button>

          <div className="my-1.5 border-t" style={{ borderColor: LINE }} />

          <div className="px-1 pb-1 text-[10.5px] uppercase tracking-wide" style={{ color: INK_WARM }}>
            {positionLabel}
          </div>
          <div className="flex gap-1.5">
            {edges.map((e) => {
              const isActive = edge === e.value;
              return (
                <button
                  key={e.value}
                  type="button"
                  onClick={() => onEdge(e.value)}
                  aria-label={e.label}
                  title={e.label}
                  aria-pressed={isActive}
                  className="inline-flex flex-1 items-center justify-center rounded-[9px] py-2 transition-colors"
                  style={{
                    color: isActive ? GOLD : INK_WARM,
                    background: isActive ? 'rgba(176,125,43,0.12)' : PAPER_SOFT,
                    border: `1px solid ${isActive ? `${GOLD}55` : LINE}`,
                  }}
                >
                  {e.icon}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
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
      <span
        className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-full"
        style={{ background: '#f4e7cc', color: GOLD }}
      >
        <StarMark size={30} className="text-[#b07d2b]" holeColor="#f4e7cc" />
      </span>
      <p className="font-reem-kufi text-[15px] font-semibold" style={{ color: INK_DEEP }}>
        {heading}
      </p>
      <div className="mt-5 flex w-full flex-col gap-2">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            dir="auto"
            onClick={() => onPick(s)}
            className="inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-[13px] transition-all hover:-translate-y-[1px]"
            style={{ background: PAPER_CARD, border: `1px solid ${LINE}`, color: INK_WARM }}
          >
            <StarMark size={13} className="text-[#b07d2b] shrink-0" holeColor={PAPER_CARD} />
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
          className="max-w-[85%] rounded-2xl rounded-se-[6px] px-3.5 py-2.5 text-[13.5px] leading-[1.7]"
          style={{ background: GOLD, color: ON_GOLD }}
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
        className="lib-assistant-md max-w-[92%] rounded-2xl rounded-ss-[6px] px-4 py-3 text-[13.5px] leading-[1.75]"
        style={{ background: PAPER_CARD, border: `1px solid ${LINE}`, color: '#4a4236' }}
      >
        {content ? <Markdown content={content} /> : null}
        {streaming && (
          <span
            className="ms-1 inline-block h-3.5 w-[2px] animate-cursor-blink align-middle"
            style={{ background: GOLD }}
          />
        )}
      </div>
    </div>
  );
}

function ThinkingBubble({ label }: { label: string }) {
  return (
    <div className="flex justify-start">
      <div
        className="inline-flex items-center gap-2 rounded-2xl rounded-ss-[6px] px-4 py-3"
        style={{ background: PAPER_CARD, border: `1px solid ${LINE}` }}
      >
        <span className="h-1.5 w-1.5 animate-live-dot rounded-full" style={{ background: GOLD }} />
        <span className="text-[12.5px]" style={{ color: INK_WARM }}>
          {label}
        </span>
      </div>
    </div>
  );
}

function Composer({
  value,
  isLoading,
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
    <div className="shrink-0 px-4 pb-4 pt-2" style={{ borderTop: `1px solid ${LINE}` }}>
      <div className="mb-1.5 flex justify-end text-[11px]" style={{ color: INK_WARM }}>
        {hint}
      </div>
      <div
        className="flex items-end gap-2 rounded-[18px] px-3 py-2.5 transition-shadow focus-within:shadow-[0_0_0_4px_rgba(176,125,43,0.12)]"
        style={{ background: PAPER_CARD, border: `1px solid ${LINE}` }}
      >
        <textarea
          ref={taRef}
          value={value}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          dir="auto"
          placeholder={placeholder}
          className="min-h-[24px] flex-1 resize-none bg-transparent font-body-ar text-[14px] leading-6 focus:outline-none"
          style={{ color: INK_DEEP }}
        />
        {isLoading ? (
          <button
            type="button"
            onClick={onStop}
            aria-label={stopLabel}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors"
            style={{ background: '#f4e7cc', color: GOLD }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            onClick={onSend}
            disabled={!value.trim()}
            aria-label={sendLabel}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40"
            style={{ background: GOLD, color: ON_GOLD }}
            onMouseEnter={(e) => {
              if (value.trim()) e.currentTarget.style.background = GOLD_HOVER;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = GOLD;
            }}
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
