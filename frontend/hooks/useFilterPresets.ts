'use client';

import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createSavedFilterPreset,
  deleteSavedFilterPreset,
  listSavedFilterPresets,
  type SavedFilterPreset,
} from '@/lib/api/documentFilters';
import type { DocumentFilterValues } from '@/lib/documentsSearchParams';

const PRESETS_QUERY_KEY = ['filter-presets'] as const;

export interface FilterPresetsBundle {
  presets: SavedFilterPreset[];
  isLoading: boolean;
  /** Rejects with the backend message (e.g. duplicate name) for inline forms. */
  savePreset: (name: string, filters: DocumentFilterValues) => Promise<SavedFilterPreset>;
  deletePreset: (id: number) => Promise<void>;
}

/**
 * The user's named saved-filter presets, shared across every search surface
 * (the `/documents` sidebar, the search console on documents / landing /
 * reader / map) through one TanStack Query cache entry — saving from the
 * console updates the sidebar instantly and vice versa.
 */
export default function useFilterPresets(isAuthenticated: boolean): FilterPresetsBundle {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: PRESETS_QUERY_KEY,
    queryFn: listSavedFilterPresets,
    enabled: isAuthenticated,
    staleTime: 60_000,
  });

  const createMutation = useMutation({
    mutationFn: ({ name, filters }: { name: string; filters: DocumentFilterValues }) =>
      createSavedFilterPreset(name, filters),
    onSuccess: (created) => {
      queryClient.setQueryData<SavedFilterPreset[]>(PRESETS_QUERY_KEY, (prev) => [
        created,
        ...(prev ?? []).filter((p) => p.id !== created.id),
      ]);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteSavedFilterPreset(id),
    onSuccess: (_res, id) => {
      queryClient.setQueryData<SavedFilterPreset[]>(PRESETS_QUERY_KEY, (prev) =>
        (prev ?? []).filter((p) => p.id !== id),
      );
    },
  });

  const savePreset = useCallback(
    (name: string, filters: DocumentFilterValues) =>
      createMutation.mutateAsync({ name, filters }),
    [createMutation],
  );
  const deletePreset = useCallback(
    (id: number) => deleteMutation.mutateAsync(id),
    [deleteMutation],
  );

  return {
    presets: isAuthenticated ? data ?? [] : [],
    isLoading,
    savePreset,
    deletePreset,
  };
}

export type { SavedFilterPreset };
