// Typed wrappers for the library-assistant chat endpoints (document-less,
// per-user sessions that persist the CopilotKit library-agent transcript).
// Mirrors the relative-URL + CSRF conventions of `frontend/lib/api/reader.ts`:
// DRF SessionAuthentication enforces CSRF on writes, and browser requests use a
// relative URL (same origin) falling back to NEXT_PUBLIC_API_URL during SSR.

import { csrfHeaders } from '../csrf';

// --- URL helpers -----------------------------------------------------------
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

async function ensureOk(response: Response, fallback: string): Promise<void> {
  if (response.ok) return;
  let detail = '';
  try {
    const data = await response.json();
    detail = typeof data === 'string' ? data : data?.error || data?.detail || '';
  } catch {
    /* non-JSON error body */
  }
  throw new Error(detail || `${fallback} (${response.status})`);
}

const BASE = '/api/search_engine/library/chat';

// --- Types -----------------------------------------------------------------

export type LibraryChatRole = 'user' | 'assistant';

export type ApiLibrarySession = {
  id: number;
  thread_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
};

export type ApiLibraryMessage = {
  id: number;
  client_id: string;
  role: LibraryChatRole;
  content: string;
  created_at: string;
};

export type LibraryMessagePayload = {
  client_id: string;
  role: LibraryChatRole;
  content: string;
};

// --- Sessions --------------------------------------------------------------

export async function listLibrarySessions(): Promise<ApiLibrarySession[]> {
  const response = await fetch(buildUrl(`${BASE}/sessions/`), {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  });
  await ensureOk(response, 'Failed to fetch library sessions');
  return response.json();
}

/**
 * Idempotent create: the server reuses the row for this (user, thread_id) if it
 * already exists, so a StrictMode double-invoke or retry can't duplicate.
 */
export async function createLibrarySession(
  threadId: string,
  title = '',
): Promise<ApiLibrarySession> {
  const response = await fetch(buildUrl(`${BASE}/sessions/`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    credentials: 'include',
    body: JSON.stringify({ thread_id: threadId, title }),
  });
  await ensureOk(response, 'Failed to create library session');
  return response.json();
}

export async function updateLibrarySession(
  sessionId: number,
  patch: Partial<Pick<ApiLibrarySession, 'title'>>,
): Promise<ApiLibrarySession> {
  const response = await fetch(buildUrl(`${BASE}/sessions/${sessionId}/`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    credentials: 'include',
    body: JSON.stringify(patch),
  });
  await ensureOk(response, 'Failed to update library session');
  return response.json();
}

export async function deleteLibrarySession(sessionId: number): Promise<void> {
  const response = await fetch(buildUrl(`${BASE}/sessions/${sessionId}/`), {
    method: 'DELETE',
    headers: { ...csrfHeaders() },
    credentials: 'include',
  });
  await ensureOk(response, 'Failed to delete library session');
}

// --- Messages --------------------------------------------------------------

export async function listLibraryMessages(
  sessionId: number,
): Promise<ApiLibraryMessage[]> {
  const response = await fetch(buildUrl(`${BASE}/sessions/${sessionId}/messages/`), {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  });
  await ensureOk(response, 'Failed to fetch library messages');
  return response.json();
}

/**
 * Bulk-persist already-produced turns (no LLM call). Idempotent by client_id,
 * so callers can naively sync unpersisted messages without fear of duplicates.
 * Returns the derived session title alongside the stored messages.
 */
export async function persistLibraryMessages(
  sessionId: number,
  messages: LibraryMessagePayload[],
): Promise<{ title: string; messages: ApiLibraryMessage[] }> {
  const response = await fetch(buildUrl(`${BASE}/sessions/${sessionId}/messages/`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    credentials: 'include',
    body: JSON.stringify({ messages }),
  });
  await ensureOk(response, 'Failed to persist library messages');
  return response.json();
}
