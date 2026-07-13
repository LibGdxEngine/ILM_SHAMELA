'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiNote,
  CreateNotePayload,
  UpdateNotePayload,
  createNote,
  deleteNote,
  listNotes,
  updateNote,
} from '../api/reader';
import { readerKeys } from './queryKeys';

type AddPayload = Omit<ApiNote, 'id' | 'created_at' | 'updated_at'>;

export interface UseNotesResult {
  data: ApiNote[];
  isLoading: boolean;
  /** Resolves with the created note so callers can track its id (e.g. the
   *  search panel's save-toggle deletes it again on «محفوظ» un-toggle). */
  add: (payload: AddPayload) => Promise<ApiNote>;
  remove: (id: number) => Promise<void>;
  update: (id: number, patch: Partial<ApiNote>) => Promise<void>;
}

const TEMP_ID_BASE = -1;

function isValidDocId(documentId: number): boolean {
  return !!documentId && !Number.isNaN(documentId);
}

export function useNotes(documentId: number): UseNotesResult {
  const queryClient = useQueryClient();
  const enabled = isValidDocId(documentId);
  const key = readerKeys.notes(documentId);

  const query = useQuery<ApiNote[]>({
    queryKey: key,
    queryFn: () => listNotes(documentId),
    enabled,
  });

  const addMutation = useMutation<ApiNote, Error, AddPayload, { previous?: ApiNote[] }>({
    mutationFn: (payload) => {
      const body: CreateNotePayload = {
        document: payload.document,
        page_number: payload.page_number,
        paragraph_id: payload.paragraph_id,
        body: payload.body,
        tags: payload.tags,
      };
      return createNote(body);
    },
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ApiNote[]>(key);
      const now = new Date().toISOString();
      const optimistic: ApiNote = {
        id: TEMP_ID_BASE - Date.now(),
        created_at: now,
        updated_at: now,
        ...payload,
      };
      queryClient.setQueryData<ApiNote[]>(key, [optimistic, ...(previous ?? [])]);
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

  const removeMutation = useMutation<void, Error, number, { previous?: ApiNote[] }>({
    mutationFn: (id) => deleteNote(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ApiNote[]>(key);
      queryClient.setQueryData<ApiNote[]>(
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
    ApiNote,
    Error,
    { id: number; patch: Partial<ApiNote> },
    { previous?: ApiNote[] }
  >({
    mutationFn: ({ id, patch }) => {
      const body: UpdateNotePayload = {
        document: patch.document,
        page_number: patch.page_number,
        paragraph_id: patch.paragraph_id,
        body: patch.body,
        tags: patch.tags,
      };
      return updateNote(id, body);
    },
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ApiNote[]>(key);
      queryClient.setQueryData<ApiNote[]>(
        key,
        (previous ?? []).map((entry) =>
          entry.id === id ? { ...entry, ...patch, updated_at: new Date().toISOString() } : entry
        )
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
    add: (payload) => addMutation.mutateAsync(payload),
    remove: async (id) => {
      await removeMutation.mutateAsync(id);
    },
    update: async (id, patch) => {
      await updateMutation.mutateAsync({ id, patch });
    },
  };
}
