import { useEffect, useRef } from 'react';

import { trackReadingSession } from '@/lib/api/tracking';

// Flush at most this often while actively reading, so a long uninterrupted
// session still produces periodic telemetry (not just one row at the end).
const CHECKPOINT_MS = 60_000;
// Ignore sub-second slivers so tab flicker doesn't spam the ingest endpoint.
const MIN_FLUSH_MS = 1_000;

/**
 * Measures *active* reading time for a document and flushes `reading_session`
 * telemetry on tab-hide, page-hide, unmount, document change, and periodic
 * checkpoints. "Active" excludes periods when the tab is hidden.
 *
 * Side-effect only — renders nothing and stores nothing locally. Call once at
 * the top level of the reader page so it runs for the whole reading lifetime
 * (not only while a particular panel is mounted).
 *
 * The time model is a delta accumulator: each flush sends just the active ms
 * since the previous flush. Durations sum server-side; pages/percent are
 * max-merged — so flushing often is safe and never double-counts.
 */
export function useReadingSession(
  documentId: number | null | undefined,
  currentPage: number,
  totalPages: number,
): void {
  const pendingMsRef = useRef(0);
  const activeStartRef = useRef<number | null>(null);
  const pagesRef = useRef<Set<number>>(new Set());
  const furthestRef = useRef(0);
  const totalRef = useRef(totalPages || 0);

  // Keep the total-pages ref current without tearing down the timer.
  useEffect(() => {
    totalRef.current = totalPages || 0;
  }, [totalPages]);

  // Track visited pages + furthest position for the active document.
  useEffect(() => {
    if (currentPage && currentPage > 0) {
      pagesRef.current.add(currentPage);
      if (currentPage > furthestRef.current) furthestRef.current = currentPage;
    }
  }, [currentPage]);

  useEffect(() => {
    if (!documentId) return;

    // Fresh accounting for this document.
    pendingMsRef.current = 0;
    pagesRef.current = new Set();
    furthestRef.current = 0;
    const startHidden = typeof document !== 'undefined' && document.hidden;
    activeStartRef.current = startHidden ? null : Date.now();

    const rollActive = () => {
      if (activeStartRef.current != null) {
        pendingMsRef.current += Date.now() - activeStartRef.current;
        activeStartRef.current = Date.now();
      }
    };

    const flush = () => {
      rollActive();
      const ms = pendingMsRef.current;
      if (ms < MIN_FLUSH_MS) return;
      pendingMsRef.current = 0;
      const total = totalRef.current;
      trackReadingSession({
        documentId,
        durationMs: ms,
        pagesRead: pagesRef.current.size,
        furthestPage: furthestRef.current || undefined,
        percentComplete:
          total > 0 ? Math.min(1, furthestRef.current / total) : undefined,
      });
    };

    const onVisibility = () => {
      if (document.hidden) {
        rollActive();
        activeStartRef.current = null; // pause: don't accrue while hidden
        flush();
      } else {
        activeStartRef.current = Date.now(); // resume
      }
    };
    const onPageHide = () => flush();

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    const interval = window.setInterval(flush, CHECKPOINT_MS);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      flush(); // final slice on unmount / document change
    };
  }, [documentId]);
}
