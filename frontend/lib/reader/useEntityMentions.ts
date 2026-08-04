/**
 * Hook: fetch and cache entity mentions for the currently visible pages.
 *
 * Uses a manual Map cache keyed on page number (within this document); the
 * cache lives for the lifetime of the reader session. Fetching is gated on
 * `enabled` so no network requests are made when the overlay is off.
 *
 * Stale-mention validation: the backend embeds a `content_hash` at the
 * response level (current sha256 of the page content) and on each mention
 * (hash at extraction time). Mentions whose hash differs are dropped here.
 */

import { useEffect, useRef, useState } from 'react';
import type { DocumentPage } from '@/lib/api';
import { getPageMentions, type PageMention } from '@/lib/api/extractionMentions';

type MentionCache = Map<number, PageMention[]>;

/**
 * Returns a stable Map<pageNumber, PageMention[]> that is filled incrementally
 * as pages are fetched. The map reference changes on every successful fetch so
 * consumers re-render with new data.
 */
export function useEntityMentions(
  docId: number,
  visiblePages: DocumentPage[],
  enabled: boolean,
): MentionCache {
  // Separate cache per docId (reset when the document changes).
  const cacheRef = useRef<{ docId: number; map: MentionCache }>({
    docId,
    map: new Map(),
  });

  if (cacheRef.current.docId !== docId) {
    cacheRef.current = { docId, map: new Map() };
  }

  // Expose the map to state so consumers re-render when it updates.
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    if (!enabled || visiblePages.length === 0) return;

    const cache = cacheRef.current.map;
    const abortControllers: AbortController[] = [];

    for (const page of visiblePages) {
      const pageNum = page.page_number;
      if (cache.has(pageNum)) continue; // already fetched

      const ctrl = new AbortController();
      abortControllers.push(ctrl);

      getPageMentions(docId, pageNum, { signal: ctrl.signal })
        .then((res) => {
          // Drop mentions that were extracted from an older version of the page.
          const valid = res.mentions.filter(
            (m) => m.content_hash === res.content_hash,
          );
          cacheRef.current.map = new Map(cacheRef.current.map).set(pageNum, valid);
          forceUpdate((n) => n + 1);
        })
        .catch(() => {
          // Silently ignore fetch errors (network hiccup, 404 if not extracted).
          // Mark the page as "fetched but empty" so we don't retry in this session.
          cacheRef.current.map = new Map(cacheRef.current.map).set(pageNum, []);
          forceUpdate((n) => n + 1);
        });
    }

    return () => {
      abortControllers.forEach((c) => c.abort());
    };
    // visiblePages is an array — use its stringified page numbers as the dep key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, docId, visiblePages.map((p) => p.page_number).join(',')]);

  return cacheRef.current.map;
}
