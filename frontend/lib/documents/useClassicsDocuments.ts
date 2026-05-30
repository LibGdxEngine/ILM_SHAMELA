'use client';

import type { Document } from '@/lib/api';

export interface ClassicsHookResult {
  data: Document[] | undefined;
  isLoading: boolean;
}

// TODO: backend curation — replace with a real fetch once a curated
// "essential classics" list is available. The shape mirrors React Query's
// minimal result so the consuming shelf component can swap implementations
// without changes.
export function useClassicsDocuments(): ClassicsHookResult {
  return { data: undefined, isLoading: false };
}
