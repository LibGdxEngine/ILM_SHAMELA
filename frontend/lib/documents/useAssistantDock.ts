'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Layout state for the library assistant drawer, persisted per browser.
 *
 * - `open`    — drawer visible (sticky across reloads, like the old OPEN_KEY).
 * - `pinned`  — docked: the page reflows to reserve space beside the panel.
 *               Unpinned = floating overlay on top of the page.
 * - `edge`    — which physical edge the panel snaps to.
 *
 * Mirrors the reader's `'reader:panels'` localStorage idiom
 * (`app/documents/[id]/page.tsx`): hydrate once after mount (never lazy state,
 * to avoid an SSR hydration mismatch) and write back on change.
 */
export type AssistantEdge = 'left' | 'right' | 'bottom';

export interface AssistantDock {
  open: boolean;
  pinned: boolean;
  edge: AssistantEdge;
  setOpen: (open: boolean) => void;
  setPinned: (pinned: boolean) => void;
  setEdge: (edge: AssistantEdge) => void;
}

const DOCK_KEY = 'ilm.docs.assistantDock';

type Persisted = { open?: boolean; pinned?: boolean; edge?: AssistantEdge };

const EDGES: AssistantEdge[] = ['left', 'right', 'bottom'];

export function useAssistantDock(): AssistantDock {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [edge, setEdge] = useState<AssistantEdge>('right');

  const hasHydratedRef = useRef(false);
  useEffect(() => {
    if (hasHydratedRef.current || typeof window === 'undefined') return;
    hasHydratedRef.current = true;
    try {
      const raw = window.localStorage.getItem(DOCK_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Persisted;
      if (typeof parsed.open === 'boolean') setOpen(parsed.open);
      if (typeof parsed.pinned === 'boolean') setPinned(parsed.pinned);
      if (parsed.edge && EDGES.includes(parsed.edge)) setEdge(parsed.edge);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!hasHydratedRef.current || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(DOCK_KEY, JSON.stringify({ open, pinned, edge }));
    } catch {
      /* ignore */
    }
  }, [open, pinned, edge]);

  const setEdgeSafe = useCallback((next: AssistantEdge) => {
    if (EDGES.includes(next)) setEdge(next);
  }, []);

  return { open, pinned, edge, setOpen, setPinned, setEdge: setEdgeSafe };
}

export default useAssistantDock;
