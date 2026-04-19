'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { ApiContinueReading, listContinueReading } from '../api/reader';
import { readerKeys } from './queryKeys';

export function useContinueReading(
  limit?: number
): UseQueryResult<ApiContinueReading[], Error> {
  return useQuery<ApiContinueReading[], Error>({
    queryKey: [...readerKeys.continueReading(), limit ?? null],
    queryFn: () => listContinueReading(limit),
  });
}
