// Personalized document recommendations → GET /api/analytics/recommendations/
// (transparently proxied to Django). Mirrors the continue-reading client fn;
// the backend returns the standard document-list shape plus the recommendation
// reason/score for each card.
import type { Document } from '@/lib/api';

export interface ApiRecommendation extends Document {
  /** Why this was recommended: 'for_you' | 'more_by_author' | 'popular' | 'newest'. */
  reason: string;
  /** Detail for the reason, e.g. the author name for 'more_by_author'. */
  reason_detail: string | null;
  score: number;
}

export async function getRecommendations(limit?: number): Promise<ApiRecommendation[]> {
  const query = typeof limit === 'number' ? `?limit=${encodeURIComponent(String(limit))}` : '';
  const response = await fetch(`/api/analytics/recommendations/${query}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error('Failed to fetch recommendations');
  }
  return response.json();
}
