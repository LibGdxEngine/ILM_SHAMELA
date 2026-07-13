// Typed wrapper for the combined facet-options endpoint feeding the search
// console's static filter sections (languages / countries / death centuries).
// Same conventions as `documentFilters.ts`: same-origin relative URLs in the
// browser, `credentials: 'include'`.

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

const FACET_OPTIONS_PATH = '/api/search_engine/documents/facet-options/';

export interface FacetOptionCount<T extends string | number = string> {
  value: T;
  count: number;
}

/** Server payload: raw values + document counts; display labels (language
 *  names, "القرن الثامن") are applied client-side. Cached 300s server-side. */
export interface FacetOptionsResponse {
  languages: FacetOptionCount<string>[];
  death_centuries: FacetOptionCount<number>[];
  countries: FacetOptionCount<string>[];
}

/**
 * One round-trip per console-open for every static facet's options. Throws on
 * failure — `useSearchSections` treats a rejected fetch as "hide the section
 * (unless it has selections)", so environment skew degrades gracefully.
 */
export async function getFacetOptions(): Promise<FacetOptionsResponse> {
  const response = await fetch(buildUrl(FACET_OPTIONS_PATH), {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch facet options (${response.status})`);
  }
  return response.json();
}
