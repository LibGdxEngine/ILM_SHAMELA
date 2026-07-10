// Typed wrappers for the persisted / named document-filter endpoints.
// Mirrors the conventions in `reader.ts`: same-origin relative URLs in the
// browser, `credentials: 'include'` on every request, and the `X-CSRFToken`
// header on writes (DRF SessionAuthentication enforces CSRF on non-GET).

import { csrfHeaders } from '../csrf';
import type { DocumentFilterValues } from '../documentsSearchParams';

// --- URL helpers -----------------------------------------------------------
// Duplicated from `reader.ts` (those helpers are file-local there); this
// codebase favours small per-file duplication over a shared re-export.
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

// --- Error helper ----------------------------------------------------------

type ApiErrorBody = {
  detail?: string;
  message?: string;
  [key: string]: unknown;
};

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  let body: ApiErrorBody = {};
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    // Non-JSON response — keep the empty body and fall through to the fallback.
  }
  if (typeof body.detail === 'string' && body.detail) return body.detail;
  if (typeof body.message === 'string' && body.message) return body.message;
  // Surface the first non-empty array string from any field.
  for (const value of Object.values(body)) {
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
      return value[0];
    }
  }
  return fallback;
}

async function ensureOk(response: Response, fallback: string): Promise<void> {
  if (response.ok) return;
  const message = await readErrorMessage(response, fallback);
  throw new Error(message);
}

// --- Types -----------------------------------------------------------------

export interface SavedFilterPreset {
  id: number;
  name: string;
  filters: DocumentFilterValues;
  created_at: string;
}

// --- URL builders ----------------------------------------------------------

const PREFERENCE_PATH = '/api/search_engine/reader/document-filters/';
const PRESETS_PATH = '/api/search_engine/reader/document-filter-presets/';

// --- Auto-saved filter preference (per-user singleton) ---------------------

/**
 * Fetch the user's auto-saved filter state. Best-effort restore — returns
 * `null` (never throws) on any failure so a slow/failed request can't break
 * the page mount.
 */
export async function getDocumentFilterPreference(): Promise<DocumentFilterValues | null> {
  try {
    const response = await fetch(buildUrl(PREFERENCE_PATH), {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { filters?: DocumentFilterValues };
    return body.filters ?? null;
  } catch {
    return null;
  }
}

export async function updateDocumentFilterPreference(filters: DocumentFilterValues): Promise<void> {
  const response = await fetch(buildUrl(PREFERENCE_PATH), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    credentials: 'include',
    body: JSON.stringify({ filters }),
  });
  await ensureOk(response, 'Failed to save filter preference');
}

// --- Named saved presets (per-user collection) -----------------------------

export async function listSavedFilterPresets(): Promise<SavedFilterPreset[]> {
  const response = await fetch(buildUrl(PRESETS_PATH), {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  });
  await ensureOk(response, 'Failed to fetch saved filter presets');
  return response.json();
}

export async function createSavedFilterPreset(
  name: string,
  filters: DocumentFilterValues,
): Promise<SavedFilterPreset> {
  const response = await fetch(buildUrl(PRESETS_PATH), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    credentials: 'include',
    body: JSON.stringify({ name, filters }),
  });
  await ensureOk(response, 'Failed to save filter preset');
  return response.json();
}

export async function deleteSavedFilterPreset(id: number): Promise<void> {
  const response = await fetch(buildUrl(`${PRESETS_PATH}${id}/`), {
    method: 'DELETE',
    headers: { ...csrfHeaders() },
    credentials: 'include',
  });
  await ensureOk(response, 'Failed to delete filter preset');
}
