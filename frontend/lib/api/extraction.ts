// Typed wrappers for the extraction typeahead endpoints feeding the search
// console's persons and places facet sections. Same conventions as
// `facetOptions.ts`: relative URLs in the browser, credentials: 'include'.

import type { OptionSearchPage } from '@/components/search/console/types';

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

interface PersonResult {
  id: number;
  display_name: string;
  death_year_hijri?: number | null;
  death_century?: number | null;
  mention_doc_count: number;
}

interface PlaceResult {
  id: number;
  name: string;
  modern_name?: string | null;
  feature_type?: string | null;
  mention_doc_count: number;
}

interface PersonsResponse {
  count: number;
  results: PersonResult[];
}

interface PlacesResponse {
  count: number;
  results: PlaceResult[];
}

export async function fetchPersonOptions(search: string): Promise<OptionSearchPage> {
  const url = buildUrl('/api/extraction/persons/');
  const params = new URLSearchParams();
  if (search) params.set('q', search);
  const response = await fetch(`${url}?${params.toString()}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch person options (${response.status})`);
  }
  const data: PersonsResponse = await response.json();
  return {
    count: data.count,
    options: data.results.map((p) => ({
      id: p.id,
      label: p.death_year_hijri
        ? `${p.display_name} (ت ${p.death_year_hijri}هـ)`
        : p.display_name,
      count: p.mention_doc_count,
    })),
  };
}

export async function fetchPlaceOptions(search: string): Promise<OptionSearchPage> {
  const url = buildUrl('/api/extraction/places/');
  const params = new URLSearchParams();
  if (search) params.set('q', search);
  const response = await fetch(`${url}?${params.toString()}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch place options (${response.status})`);
  }
  const data: PlacesResponse = await response.json();
  return {
    count: data.count,
    options: data.results.map((pl) => ({
      id: pl.id,
      label: pl.modern_name ? `${pl.name} — ${pl.modern_name}` : pl.name,
      count: pl.mention_doc_count,
    })),
  };
}
