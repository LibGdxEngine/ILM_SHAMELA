'use client';

// Recents + pinned terms for the Reader & Search v2 panel.
// Recents are ephemeral, per-browser (localStorage, MRU, cap 5).
// Pins are deliberate user data → persisted per-user in ReaderPreference.extra
// (`extra.search_pins[docId]`) so they survive across devices. The extra
// JSONField is replaced wholesale on PATCH, so writes always spread the
// last-fetched `extra` and only touch the `search_pins` key.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { UseReaderPreferencesResult } from './useReaderPreferences';

const RECENTS_CAP = 5;
const PINS_CAP = 6;
const PINS_KEY = 'search_pins';

function recentsStorageKey(documentId: number): string {
  return `reader:search:recents:${documentId}`;
}

function readRecents(documentId: number): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(recentsStorageKey(documentId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

function pinsFromExtra(extra: Record<string, unknown> | undefined, documentId: number): string[] {
  const pins = extra?.[PINS_KEY];
  if (!pins || typeof pins !== 'object') return [];
  const forDoc = (pins as Record<string, unknown>)[String(documentId)];
  return Array.isArray(forDoc) ? forDoc.filter((t): t is string => typeof t === 'string') : [];
}

export interface UseSearchTermStoreResult {
  recents: string[];
  pinned: string[];
  addRecent: (term: string) => void;
  pinTerm: (term: string) => void;
  unpinTerm: (term: string) => void;
}

export function useSearchTermStore(
  documentId: number,
  prefs: UseReaderPreferencesResult
): UseSearchTermStoreResult {
  const [recents, setRecents] = useState<string[]>([]);

  useEffect(() => {
    setRecents(readRecents(documentId));
  }, [documentId]);

  const addRecent = useCallback(
    (term: string) => {
      const trimmed = term.trim();
      if (!trimmed) return;
      setRecents((prev) => {
        const next = [trimmed, ...prev.filter((t) => t !== trimmed)].slice(0, RECENTS_CAP);
        try {
          window.localStorage.setItem(recentsStorageKey(documentId), JSON.stringify(next));
        } catch {
          // Private mode / quota: recents just stop persisting.
        }
        return next;
      });
    },
    [documentId]
  );

  const pinned = useMemo(
    () => pinsFromExtra(prefs.data?.extra, documentId),
    [prefs.data?.extra, documentId]
  );

  const writePins = useCallback(
    (next: string[]) => {
      const extra = { ...(prefs.data?.extra ?? {}) };
      const allPins = { ...((extra[PINS_KEY] as Record<string, string[]>) ?? {}) };
      if (next.length > 0) {
        allPins[String(documentId)] = next;
      } else {
        delete allPins[String(documentId)];
      }
      extra[PINS_KEY] = allPins;
      void prefs.update({ extra });
    },
    [prefs, documentId]
  );

  const pinTerm = useCallback(
    (term: string) => {
      const trimmed = term.trim();
      if (!trimmed) return;
      writePins([trimmed, ...pinned.filter((t) => t !== trimmed)].slice(0, PINS_CAP));
    },
    [pinned, writePins]
  );

  const unpinTerm = useCallback(
    (term: string) => {
      writePins(pinned.filter((t) => t !== term));
    },
    [pinned, writePins]
  );

  return { recents, pinned, addRecent, pinTerm, unpinTerm };
}
