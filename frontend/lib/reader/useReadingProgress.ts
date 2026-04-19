'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import {
  ApiReadingProgress,
  UpsertReadingProgressPayload,
  upsertReadingProgress,
} from '../api/reader';
import { readerKeys } from './queryKeys';

const DEBOUNCE_MS = 5000;

export interface UseReadingProgressResult {
  data: ApiReadingProgress | undefined;
  isLoading: boolean;
  save: (payload: UpsertReadingProgressPayload) => void;
}

function isValidDocId(documentId: number): boolean {
  return !!documentId && !Number.isNaN(documentId);
}

/**
 * Reading progress hook with leading + trailing debounce semantics.
 *
 * The first `save()` call after a quiet period fires immediately so the
 * server reflects the user's current page right away; subsequent calls
 * within the debounce window queue a trailing fire 5s after the last call,
 * keeping write volume bounded for the dedicated `reader_progress` throttle.
 */
export function useReadingProgress(documentId: number): UseReadingProgressResult {
  const queryClient = useQueryClient();
  const enabled = isValidDocId(documentId);
  const key = readerKeys.progress(documentId);

  const query = useQuery<ApiReadingProgress>({
    queryKey: key,
    queryFn: async () => {
      // No GET endpoint exists for a single document's progress; the cache
      // is seeded by writes and the continue-reading list. Return whatever
      // is already in the cache so this query is a no-op until then.
      const cached = queryClient.getQueryData<ApiReadingProgress>(key);
      if (cached) return cached;
      throw new Error('Reading progress not yet loaded');
    },
    enabled: false,
  });

  const lastSentRef = useRef<{ last_page: number } | null>(null);

  const mutation = useMutation<
    ApiReadingProgress,
    Error,
    UpsertReadingProgressPayload
  >({
    mutationFn: (payload) => upsertReadingProgress(documentId, payload),
    onSuccess: (data, payload) => {
      queryClient.setQueryData<ApiReadingProgress>(key, data);
      lastSentRef.current = { last_page: payload.last_page };
    },
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFireRef = useRef<number>(0);
  const pendingPayloadRef = useRef<UpsertReadingProgressPayload | null>(null);

  // Stable mutation reference so `save` doesn't churn on each render.
  const mutateRef = useRef(mutation.mutate);
  mutateRef.current = mutation.mutate;

  const save = useCallback(
    (payload: UpsertReadingProgressPayload) => {
      if (!enabled) return;
      if (lastSentRef.current?.last_page === payload.last_page) return;

      const now = Date.now();
      const sinceLast = now - lastFireRef.current;
      pendingPayloadRef.current = payload;

      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      // Leading edge: fire immediately when there is no recent activity.
      if (lastFireRef.current === 0 || sinceLast >= DEBOUNCE_MS) {
        lastFireRef.current = now;
        const toSend = pendingPayloadRef.current;
        pendingPayloadRef.current = null;
        if (toSend) mutateRef.current(toSend);
        return;
      }

      // Trailing edge: schedule a fire 5s after the most recent call.
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        lastFireRef.current = Date.now();
        const toSend = pendingPayloadRef.current;
        pendingPayloadRef.current = null;
        if (toSend) mutateRef.current(toSend);
      }, DEBOUNCE_MS);
    },
    [enabled]
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const pending = pendingPayloadRef.current;
      pendingPayloadRef.current = null;
      if (pending) {
        mutateRef.current(pending);
      }
    };
  }, []);

  return {
    data: query.data,
    isLoading: false,
    save,
  };
}
