'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { ApiRecommendation, getRecommendations } from '../api/recommendations';
import { readerKeys } from './queryKeys';

export function useRecommendations(
  limit?: number
): UseQueryResult<ApiRecommendation[], Error> {
  return useQuery<ApiRecommendation[], Error>({
    queryKey: [...readerKeys.recommendations(), limit ?? null],
    queryFn: () => getRecommendations(limit),
    // Recommendations change far less often than reading progress, and the
    // backend caches per-user for ~5 min anyway.
    staleTime: 5 * 60 * 1000,
  });
}
