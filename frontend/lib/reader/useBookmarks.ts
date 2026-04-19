'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiBookmark,
  CreateBookmarkPayload,
  UpdateBookmarkPayload,
  createBookmark,
  deleteBookmark,
  listBookmarks,
  updateBookmark,
} from '../api/reader';
import { readerKeys } from './queryKeys';

type AddPayload = Omit<ApiBookmark, 'id' | 'created_at'>;

export interface UseBookmarksResult {
  data: ApiBookmark[];
  isLoading: boolean;
  add: (payload: AddPayload) => Promise<void>;
  remove: (id: number) => Promise<void>;
  update: (id: number, patch: Partial<ApiBookmark>) => Promise<void>;
}

const TEMP_ID_BASE = -1;

function isValidDocId(documentId: number): boolean {
  return !!documentId && !Number.isNaN(documentId);
}

export function useBookmarks(documentId: number): UseBookmarksResult {
  const queryClient = useQueryClient();
  const enabled = isValidDocId(documentId);
  const key = readerKeys.bookmarks(documentId);

  const query = useQuery<ApiBookmark[]>({
    queryKey: key,
    queryFn: () => listBookmarks(documentId),
    enabled,
  });

  const addMutation = useMutation<ApiBookmark, Error, AddPayload, { previous?: ApiBookmark[] }>({
    mutationFn: (payload) => {
      const body: CreateBookmarkPayload = {
        document: payload.document,
        page_number: payload.page_number,
        paragraph_id: payload.paragraph_id,
        label: payload.label,
        tags: payload.tags,
      };
      return createBookmark(body);
    },
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ApiBookmark[]>(key);
      const optimistic: ApiBookmark = {
        id: TEMP_ID_BASE - Date.now(),
        created_at: new Date().toISOString(),
        ...payload,
      };
      queryClient.setQueryData<ApiBookmark[]>(key, [...(previous ?? []), optimistic]);
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

  const removeMutation = useMutation<void, Error, number, { previous?: ApiBookmark[] }>({
    mutationFn: (id) => deleteBookmark(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ApiBookmark[]>(key);
      queryClient.setQueryData<ApiBookmark[]>(
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
    ApiBookmark,
    Error,
    { id: number; patch: Partial<ApiBookmark> },
    { previous?: ApiBookmark[] }
  >({
    mutationFn: ({ id, patch }) => {
      const body: UpdateBookmarkPayload = {
        document: patch.document,
        page_number: patch.page_number,
        paragraph_id: patch.paragraph_id,
        label: patch.label,
        tags: patch.tags,
      };
      return updateBookmark(id, body);
    },
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ApiBookmark[]>(key);
      queryClient.setQueryData<ApiBookmark[]>(
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
