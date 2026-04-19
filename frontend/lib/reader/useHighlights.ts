'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiHighlight,
  CreateHighlightPayload,
  UpdateHighlightPayload,
  createHighlight,
  deleteHighlight,
  listHighlights,
  updateHighlight,
} from '../api/reader';
import { readerKeys } from './queryKeys';

type AddPayload = Omit<ApiHighlight, 'id' | 'created_at'>;

export interface UseHighlightsResult {
  data: ApiHighlight[];
  isLoading: boolean;
  add: (payload: AddPayload) => Promise<void>;
  remove: (id: number) => Promise<void>;
  update: (id: number, patch: Partial<ApiHighlight>) => Promise<void>;
}

const TEMP_ID_BASE = -1;

function isValidDocId(documentId: number): boolean {
  return !!documentId && !Number.isNaN(documentId);
}

export function useHighlights(documentId: number): UseHighlightsResult {
  const queryClient = useQueryClient();
  const enabled = isValidDocId(documentId);
  const key = readerKeys.highlights(documentId);

  const query = useQuery<ApiHighlight[]>({
    queryKey: key,
    queryFn: () => listHighlights(documentId),
    enabled,
  });

  const addMutation = useMutation<ApiHighlight, Error, AddPayload, { previous?: ApiHighlight[] }>({
    mutationFn: (payload) => {
      const body: CreateHighlightPayload = {
        document: payload.document,
        page_number: payload.page_number,
        paragraph_id: payload.paragraph_id,
        char_start: payload.char_start,
        char_end: payload.char_end,
        color: payload.color,
        note: payload.note,
      };
      return createHighlight(body);
    },
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ApiHighlight[]>(key);
      const optimistic: ApiHighlight = {
        id: TEMP_ID_BASE - Date.now(),
        created_at: new Date().toISOString(),
        ...payload,
      };
      queryClient.setQueryData<ApiHighlight[]>(key, [...(previous ?? []), optimistic]);
      return { previous };
    },
    onError: (_err, _payload, context) => {
      if (context?.previous) {
        queryClient.setQueryData(key, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: key });
    },
  });

  const removeMutation = useMutation<void, Error, number, { previous?: ApiHighlight[] }>({
    mutationFn: (id) => deleteHighlight(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ApiHighlight[]>(key);
      queryClient.setQueryData<ApiHighlight[]>(
        key,
        (previous ?? []).filter((entry) => entry.id !== id)
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(key, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: key });
    },
  });

  const updateMutation = useMutation<
    ApiHighlight,
    Error,
    { id: number; patch: Partial<ApiHighlight> },
    { previous?: ApiHighlight[] }
  >({
    mutationFn: ({ id, patch }) => {
      const body: UpdateHighlightPayload = {
        document: patch.document,
        page_number: patch.page_number,
        paragraph_id: patch.paragraph_id,
        char_start: patch.char_start,
        char_end: patch.char_end,
        color: patch.color,
        note: patch.note,
      };
      return updateHighlight(id, body);
    },
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ApiHighlight[]>(key);
      queryClient.setQueryData<ApiHighlight[]>(
        key,
        (previous ?? []).map((entry) => (entry.id === id ? { ...entry, ...patch } : entry))
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(key, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: key });
    },
  });

  return {
    data: query.data ?? [],
    isLoading: enabled && query.isLoading,
    add: async (payload) => {
      await addMutation.mutateAsync(payload);
    },
    remove: async (id) => {
      await removeMutation.mutateAsync(id);
    },
    update: async (id, patch) => {
      await updateMutation.mutateAsync({ id, patch });
    },
  };
}
