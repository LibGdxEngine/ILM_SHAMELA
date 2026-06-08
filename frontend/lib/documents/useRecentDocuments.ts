'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { Document, getDocuments } from '@/lib/api';

export function useRecentDocuments(
  limit = 8
): UseQueryResult<Document[], Error> {
  return useQuery<Document[], Error>({
    queryKey: ['documents', 'recent', limit],
    queryFn: async () => {
      const response = await getDocuments({ page: 1 });
      const sorted = [...response.results].sort(
        (a, b) =>
          new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime()
      );
      return sorted.slice(0, limit);
    },
    staleTime: 60_000,
  });
}
