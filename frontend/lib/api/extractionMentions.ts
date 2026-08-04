// Typed wrapper for the extraction/mentions endpoint.
// Follows the relative-URL convention from lib/api/reader.ts.

function getApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    return '';
  }
  const envUrl = process.env.NEXT_PUBLIC_API_URL;
  return envUrl || 'http://localhost:8000';
}

const API_BASE_URL = getApiBaseUrl();

function buildUrl(path: string): string {
  if (API_BASE_URL) {
    return `${API_BASE_URL}${API_BASE_URL.endsWith('/') ? '' : '/'}${path.startsWith('/') ? path.slice(1) : path}`;
  }
  return path.startsWith('/') ? path : `/${path}`;
}

// --- Types -----------------------------------------------------------------

export type EntityType =
  | 'person'
  | 'place'
  | 'date'
  | 'quran'
  | 'hadith_source'
  // Layer-1 universal types (LLM NER pass)
  | 'organization'
  | 'work_title'
  | 'event'
  | 'money'
  | 'measure'
  | 'percent'
  | 'law_regulation'
  | 'product_brand'
  | 'id_number'
  // Layer-2 structural spans
  | 'isnad'
  | 'matn'
  | 'poetry'
  | 'quote';

export interface PageMention {
  id: number;
  entity_type: EntityType;
  char_start: number;
  char_end: number;
  surface_text: string;
  normalized_text: string;
  normalized: Record<string, unknown>;
  person_id: number | null;
  place_id: number | null;
  work_id?: number | null;
  confidence: number;
  /** sha256 of the page content at extraction time. */
  content_hash: string;
}

export interface PageMentionsResponse {
  document_id: number;
  page_number: number;
  /** sha256 of the page's current content. */
  content_hash: string;
  mentions: PageMention[];
}

// --- Fetch -----------------------------------------------------------------

export async function getPageMentions(
  docId: number,
  page: number,
  opts?: { signal?: AbortSignal },
): Promise<PageMentionsResponse> {
  const url = buildUrl(`/api/extraction/documents/${docId}/pages/${page}/mentions/`);
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    signal: opts?.signal,
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch mentions for page ${page}: ${response.status}`);
  }
  return response.json() as Promise<PageMentionsResponse>;
}
