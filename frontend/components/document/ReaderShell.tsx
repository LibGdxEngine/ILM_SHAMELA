'use client';

import {
  CSSProperties,
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';

import { useIsDesktop } from '@/hooks/useIsDesktop';

const LS_KEY = 'reader:layout';

interface PersistedLayout {
  tocCollapsed?: boolean;
}

export interface PanelState {
  /** Whether the panel is shown at all. */
  open: boolean;
  /** Pinned = docked column (reserves layout space). Unpinned = floating overlay. */
  pinned: boolean;
}

interface ReaderShellProps {
  header: ReactNode;
  /** Right-side column in RTL (table of contents). Pass null to omit the region entirely (PDF-overlay books). */
  tocColumn?: ReactNode;
  /** Left-side panel in RTL (advanced in-document search). */
  searchColumn: ReactNode;
  search: PanelState;
  onCloseSearch: () => void;
  /** Full-screen reading mode: hide the TOC + side panels entirely. */
  fullscreen?: boolean;
  children: ReactNode;
}

/**
 * Three-region reading workspace.
 *
 * - TOC: docked collapsible column on the inline-end (right in RTL).
 * - Search + Assistant: each open/closable and pinnable. Pinned → docked column
 *   on the inline-start; unpinned → floating overlay drawer. Toggling pin/float
 *   only changes styles (never re-parents the panel node) so stateful panels —
 *   the assistant's chat — never remount.
 * - Full-screen mode hides the TOC and both panels for distraction-free reading.
 *
 * Below 1200px the side regions always behave as floating overlays.
 */
export default function ReaderShell({
  header,
  tocColumn,
  searchColumn,
  search,
  onCloseSearch,
  fullscreen = false,
  children,
}: ReaderShellProps) {
  const isDesktop = useIsDesktop();

  const [tocCollapsed, setTocCollapsed] = useState(false);

  // Hydrate persisted TOC collapse state once on mount (desktop only).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(LS_KEY);
      if (!raw) return;
      const parsed: PersistedLayout = JSON.parse(raw);
      if (typeof parsed.tocCollapsed === 'boolean') setTocCollapsed(parsed.tocCollapsed);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(LS_KEY, JSON.stringify({ tocCollapsed } satisfies PersistedLayout));
    } catch {
      /* ignore */
    }
  }, [tocCollapsed]);

  const toggleToc = useCallback(() => setTocCollapsed((v) => !v), []);

  // On non-desktop the TOC defaults to closed (a drawer).
  useEffect(() => {
    if (!isDesktop) setTocCollapsed(true);
  }, [isDesktop]);

  // Pinning only docks on desktop; on smaller screens panels always float.
  const tocDocked = isDesktop && !fullscreen;
  const searchPinned = isDesktop && search.pinned;

  return (
    <ReaderShellContext.Provider value={{ tocCollapsed, toggleToc }}>
      <div className="reader-room relative flex h-full min-h-0 flex-col overflow-hidden">
        {header}

        <div className="relative flex min-h-0 flex-1">
          {/* TOC — docked column on desktop, floating drawer otherwise */}
          {!fullscreen && tocColumn &&
            (tocDocked ? (
              <aside
                className="shrink-0 overflow-hidden border-l"
                style={{
                  width: tocCollapsed ? 56 : 236,
                  background: 'var(--rr-rail)',
                  borderColor: 'var(--rr-line-2)',
                  transition: 'width 200ms ease',
                }}
                aria-label="Table of contents"
              >
                {tocColumn}
              </aside>
            ) : (
              <PanelHost
                state={{ open: !tocCollapsed, pinned: false }}
                docked={false}
                side="end"
                width={300}
                onClose={() => setTocCollapsed(true)}
                background="var(--rr-rail)"
              >
                {tocColumn}
              </PanelHost>
            ))}

          <main className="relative min-w-0 flex-1 overflow-y-auto" id="document-scroll-container">
            {children}
          </main>

          {/* Search panel — docked when pinned, floating overlay otherwise.
              The AI assistant is no longer a shell panel: it renders as a
              self-positioned floating drawer (see ReaderAssistant). */}
          {!fullscreen && (
            <PanelHost
              state={search}
              docked={searchPinned}
              side="start"
              width={374}
              onClose={onCloseSearch}
              background="var(--rr-rail-2)"
            >
              {searchColumn}
            </PanelHost>
          )}
        </div>
      </div>
    </ReaderShellContext.Provider>
  );
}

/**
 * Hosts a side panel. The panel node is rendered in a single, stable position;
 * only its style toggles between hidden / docked (in-flow flex child) / floating
 * (fixed overlay), so children never unmount on pin/close.
 */
function PanelHost({
  state,
  docked,
  side,
  width,
  onClose,
  background,
  children,
}: {
  state: PanelState;
  docked: boolean;
  side: 'start' | 'end';
  width: number;
  onClose: () => void;
  background: string;
  children: ReactNode;
}) {
  const floating = state.open && !docked;

  let style: CSSProperties;
  if (!state.open) {
    style = { display: 'none' };
  } else if (docked) {
    style = {
      width,
      flexShrink: 0,
      background,
      borderInlineStart: '1px solid var(--rr-line-2)',
      overflow: 'hidden',
    };
  } else {
    style = {
      position: 'fixed',
      insetBlock: 0,
      insetInlineStart: side === 'start' ? 0 : 'auto',
      insetInlineEnd: side === 'end' ? 0 : 'auto',
      width: `min(${width}px, 92vw)`,
      zIndex: 60,
      background,
      boxShadow: '0 0 40px -8px rgba(44,38,32,0.45)',
      overflow: 'hidden',
    };
  }

  return (
    <>
      <button
        type="button"
        aria-label="Close panel"
        onClick={onClose}
        className="fixed inset-0 z-[55] bg-black/35 transition-opacity"
        style={{ display: floating ? 'block' : 'none' }}
      />
      <aside style={style}>{children}</aside>
    </>
  );
}

interface ReaderShellContextValue {
  tocCollapsed: boolean;
  toggleToc: () => void;
}

const ReaderShellContext = createContext<ReaderShellContextValue | null>(null);

export function useReaderShell(): ReaderShellContextValue {
  const ctx = useContext(ReaderShellContext);
  if (!ctx) {
    throw new Error('useReaderShell must be used inside <ReaderShell>');
  }
  return ctx;
}
