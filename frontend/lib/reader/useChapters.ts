'use client';

import { useQuery } from '@tanstack/react-query';

import { ApiChapter, listChapters } from '../api/reader';
import { readerKeys } from './queryKeys';

export interface UseChaptersResult {
  data: ApiChapter[];
  isLoading: boolean;
  error: Error | null;
}

/**
 * React Query hook for the document's chapter tree.
 * Returns an empty array until the request resolves so consumers can render
 * a tree-or-empty branch without a separate "uninitialized" state.
 */
export function useChapters(documentId: number): UseChaptersResult {
  const enabled = !!documentId && !Number.isNaN(documentId);
  const query = useQuery<ApiChapter[]>({
    queryKey: readerKeys.chapters(documentId),
    queryFn: () => listChapters(documentId),
    enabled,
    staleTime: 5 * 60 * 1000, // chapters rarely change
  });

  return {
    data: query.data ?? [],
    isLoading: query.isLoading,
    error: (query.error as Error | null) ?? null,
  };
}

/**
 * Walk a chapter tree (flat-with-children) and return the deepest chapter
 * whose page_start <= currentPage. Used to highlight the active branch.
 */
export function findActiveChapter(
  tree: ApiChapter[],
  currentPage: number,
): ApiChapter | null {
  let active: ApiChapter | null = null;
  const walk = (nodes: ApiChapter[]) => {
    for (const node of nodes) {
      if (node.page_start <= currentPage) {
        active = node;
        if (node.children?.length) walk(node.children);
      } else {
        break;
      }
    }
  };
  walk(tree);
  return active;
}
