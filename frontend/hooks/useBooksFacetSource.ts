'use client';

import { useCallback, useRef } from 'react';
import { getDocuments } from '@/lib/api';

interface BookFacetItem {
  id: number;
  name: string;
}

interface BookFacetResponse {
  count: number;
  results: BookFacetItem[];
}

export interface BooksFacetSource {
  /** `FacetTypeahead.fetchItems`-compatible search over documents by title. */
  fetchItems: (search: string) => Promise<BookFacetResponse>;
  /** Resolve a document title picked in the facet back to its real document id. */
  resolveId: (title: string) => number | null;
}

/**
 * Adapter that lets the shared `FacetTypeahead` drive a "selected books" facet
 * without any bespoke fetching. It wraps the existing `getDocuments({ search })`
 * endpoint, reshapes each `{ id, title }` document into the `{ id, name }` shape
 * `FacetTypeahead` expects, and remembers a title→id map (refreshed on every
 * fetch) so a selected display title can be resolved back to a real document id
 * via `resolveId`.
 */
export function useBooksFacetSource(): BooksFacetSource {
  const titleToId = useRef<Map<string, number>>(new Map());

  const fetchItems = useCallback(async (search: string): Promise<BookFacetResponse> => {
    // An empty search returns the first page (initial suggestions), matching
    // FacetTypeahead's contract for the categories/authors sources.
    const data = await getDocuments(search ? { search } : {});
    const results: BookFacetItem[] = data.results.map((doc) => {
      titleToId.current.set(doc.title, doc.id);
      return { id: doc.id, name: doc.title };
    });
    return { count: data.count, results };
  }, []);

  const resolveId = useCallback((title: string): number | null => {
    return titleToId.current.get(title) ?? null;
  }, []);

  return { fetchItems, resolveId };
}

export default useBooksFacetSource;
