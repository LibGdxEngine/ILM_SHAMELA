'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../AuthContext';
import {
  ReaderPreferences,
  UpdateReaderPreferencesPayload,
  getReaderPreferences,
  updateReaderPreferences,
} from '../api/reader';
import { readerKeys } from './queryKeys';

export interface UseReaderPreferencesResult {
  data: ReaderPreferences | undefined;
  isLoading: boolean;
  update: (patch: UpdateReaderPreferencesPayload) => Promise<void>;
}

export function useReaderPreferences(): UseReaderPreferencesResult {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();
  const key = readerKeys.preferences();

  const query = useQuery<ReaderPreferences>({
    queryKey: key,
    queryFn: () => getReaderPreferences(),
    enabled: isAuthenticated,
  });

  const updateMutation = useMutation<
    ReaderPreferences,
    Error,
    UpdateReaderPreferencesPayload,
    { previous?: ReaderPreferences }
  >({
    mutationFn: (patch) => updateReaderPreferences(patch),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ReaderPreferences>(key);
      if (previous) {
        queryClient.setQueryData<ReaderPreferences>(key, { ...previous, ...patch });
      }
      return { previous };
    },
    onError: (_err, _patch, context) => {
      if (context?.previous) {
        queryClient.setQueryData(key, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: key });
    },
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    update: async (patch) => {
      await updateMutation.mutateAsync(patch);
    },
  };
}
