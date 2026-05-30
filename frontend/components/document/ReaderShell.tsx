'use client';

import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';

import { useMediaQuery } from '@/hooks/useMediaQuery';

const LS_KEY = 'reader:layout';

interface PersistedLayout {
  tocCollapsed?: boolean;
  assistantCollapsed?: boolean;
}

interface ReaderShellProps {
  header: ReactNode;
  /** Right-side column in RTL (TOC). */
  tocColumn: ReactNode;
  /** Left-side column in RTL (AI assistant). */
  assistantColumn: ReactNode;
  /** Center reading column content. */
  children: ReactNode;
}

/**
 * Three-column reading workspace with responsive drawers.
 *
 * Desktop (≥1200px): all three columns visible side-by-side; sides collapsible
 *   to 56px icon rails. Collapse state persists to localStorage.
 * Tablet  (768–1199px): both side columns become slide-over drawers triggered
 *   by header icons.
 * Mobile  (<768px): single column; side columns become bottom sheets.
 *
 * RTL: source order is [toc, reading, assistant]. In RTL the grid flips so
 * TOC sits on the right, assistant on the left.
 */
export default function ReaderShell({
  header,
  tocColumn,
  assistantColumn,
  children,
}: ReaderShellProps) {
  const isDesktop = useMediaQuery('(min-width: 1200px)', true);
  const isTablet = useMediaQuery('(min-width: 768px) and (max-width: 1199px)', false);

  const [tocCollapsed, setTocCollapsed] = useState(false);
  const [assistantCollapsed, setAssistantCollapsed] = useState(false);

  // Hydrate persisted collapse state once on mount (desktop only).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(LS_KEY);
      if (!raw) return;
      const parsed: PersistedLayout = JSON.parse(raw);
      if (typeof parsed.tocCollapsed === 'boolean') setTocCollapsed(parsed.tocCollapsed);
      if (typeof parsed.assistantCollapsed === 'boolean') {
        setAssistantCollapsed(parsed.assistantCollapsed);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Persist on change.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        LS_KEY,
        JSON.stringify({ tocCollapsed, assistantCollapsed } satisfies PersistedLayout),
      );
    } catch {
      /* ignore */
    }
  }, [tocCollapsed, assistantCollapsed]);

  const toggleToc = useCallback(() => setTocCollapsed((v) => !v), []);
  const toggleAssistant = useCallback(() => setAssistantCollapsed((v) => !v), []);

  // On non-desktop, the columns render as drawers driven by the same collapse
  // flags (collapsed === closed). Default to closed on first paint there.
  useEffect(() => {
    if (!isDesktop) {
      setTocCollapsed(true);
      setAssistantCollapsed(true);
    }
  }, [isDesktop]);

  return (
    <ReaderShellContext.Provider
      value={{
        tocCollapsed,
        assistantCollapsed,
        toggleToc,
        toggleAssistant,
      }}
    >
      <div className="reader-shell relative flex h-full min-h-0 flex-col overflow-hidden">
        {header}

        <div className="relative flex-1 min-h-0 overflow-hidden">
          {isDesktop ? (
            <DesktopGrid
              tocColumn={tocColumn}
              assistantColumn={assistantColumn}
              tocCollapsed={tocCollapsed}
              assistantCollapsed={assistantCollapsed}
            >
              {children}
            </DesktopGrid>
          ) : (
            <DrawerLayout
              tocColumn={tocColumn}
              assistantColumn={assistantColumn}
              tocCollapsed={tocCollapsed}
              assistantCollapsed={assistantCollapsed}
              onCloseToc={() => setTocCollapsed(true)}
              onCloseAssistant={() => setAssistantCollapsed(true)}
              isTablet={isTablet}
            >
              {children}
            </DrawerLayout>
          )}
        </div>
      </div>
    </ReaderShellContext.Provider>
  );
}

function DesktopGrid({
  children,
  tocColumn,
  assistantColumn,
  tocCollapsed,
  assistantCollapsed,
}: {
  children: ReactNode;
  tocColumn: ReactNode;
  assistantColumn: ReactNode;
  tocCollapsed: boolean;
  assistantCollapsed: boolean;
}) {
  const tocWidth = tocCollapsed ? 56 : 240;
  const assistantWidth = assistantCollapsed ? 56 : 360;
  return (
    <div
      className="grid h-full w-full"
      style={{
        gridTemplateColumns: `${tocWidth}px minmax(0, 1fr) ${assistantWidth}px`,
        transition: 'grid-template-columns 220ms ease',
      }}
    >
      <aside
        className="border-l border-border bg-card-2 overflow-hidden"
        data-collapsed={tocCollapsed}
        aria-label="Table of contents"
      >
        {tocColumn}
      </aside>
      <main className="overflow-y-auto" id="document-scroll-container">
        {children}
      </main>
      <aside
        className="border-r border-border bg-card overflow-hidden"
        data-collapsed={assistantCollapsed}
        aria-label="AI assistant"
      >
        {assistantColumn}
      </aside>
    </div>
  );
}

function DrawerLayout({
  children,
  tocColumn,
  assistantColumn,
  tocCollapsed,
  assistantCollapsed,
  onCloseToc,
  onCloseAssistant,
  isTablet,
}: {
  children: ReactNode;
  tocColumn: ReactNode;
  assistantColumn: ReactNode;
  tocCollapsed: boolean;
  assistantCollapsed: boolean;
  onCloseToc: () => void;
  onCloseAssistant: () => void;
  isTablet: boolean;
}) {
  const tocOpen = !tocCollapsed;
  const assistantOpen = !assistantCollapsed;
  const showOverlay = tocOpen || assistantOpen;

  // Tablet drawers slide from the side; mobile drawers slide from the bottom.
  const tocStyle = isTablet
    ? { transform: tocOpen ? 'translateX(0)' : 'translateX(100%)' }
    : { transform: tocOpen ? 'translateY(0)' : 'translateY(100%)' };
  const assistantStyle = isTablet
    ? { transform: assistantOpen ? 'translateX(0)' : 'translateX(-100%)' }
    : { transform: assistantOpen ? 'translateY(0)' : 'translateY(100%)' };

  return (
    <div className="relative h-full w-full">
      <main className="h-full overflow-y-auto" id="document-scroll-container">
        {children}
      </main>

      {showOverlay && (
        <button
          type="button"
          aria-label="Close panels"
          className="absolute inset-0 z-30 bg-black/35 transition-opacity"
          onClick={() => {
            if (tocOpen) onCloseToc();
            if (assistantOpen) onCloseAssistant();
          }}
        />
      )}

      <aside
        aria-label="Table of contents"
        className={
          isTablet
            ? 'absolute inset-y-0 end-0 z-40 w-[300px] border-s border-border bg-card-2 shadow-2xl transition-transform'
            : 'absolute inset-x-0 bottom-0 z-40 h-[80%] rounded-t-2xl border-t border-border bg-card-2 shadow-2xl transition-transform'
        }
        style={{ ...tocStyle, transitionDuration: '220ms' }}
      >
        {tocColumn}
      </aside>

      <aside
        aria-label="AI assistant"
        className={
          isTablet
            ? 'absolute inset-y-0 start-0 z-40 w-[380px] border-e border-border bg-card shadow-2xl transition-transform'
            : 'absolute inset-x-0 bottom-0 z-40 h-[80%] rounded-t-2xl border-t border-border bg-card shadow-2xl transition-transform'
        }
        style={{ ...assistantStyle, transitionDuration: '220ms' }}
      >
        {assistantColumn}
      </aside>
    </div>
  );
}

interface ReaderShellContextValue {
  tocCollapsed: boolean;
  assistantCollapsed: boolean;
  toggleToc: () => void;
  toggleAssistant: () => void;
}

const ReaderShellContext = createContext<ReaderShellContextValue | null>(null);

export function useReaderShell(): ReaderShellContextValue {
  const ctx = useContext(ReaderShellContext);
  if (!ctx) {
    throw new Error('useReaderShell must be used inside <ReaderShell>');
  }
  return ctx;
}
