// Typed wrappers for reader-experience endpoints (Phase 0/1 backend).
// All non-GET helpers include the `X-CSRFToken` header because the backend
// uses DRF SessionAuthentication, which enforces CSRF on writes.

import { csrfHeaders } from '../csrf';

// --- URL helpers -----------------------------------------------------------
// Mirror the relative-URL convention from `frontend/lib/api.ts` so requests
// always go to the same origin in the browser (avoiding CORS issues) and
// fall back to `NEXT_PUBLIC_API_URL` during SSR.
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

export type ReaderFontSize = 'small' | 'medium' | 'large';
export type ReaderTheme = 'light' | 'sepia' | 'dark';
export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'orange';
export type NoteExportFormat = 'md';

export type ReaderPreferences = {
  font_size: ReaderFontSize;
  theme: ReaderTheme;
  font_weight: number;
  letter_spacing: number;
  line_height: number;
  tashkeel_enabled: boolean;
  /** Free-form per-user payload (backend JSONField). PATCH replaces the WHOLE
   *  object — always spread the last-fetched value when writing a key (e.g.
   *  `search_pins` from `useSearchTermStore`). */
  extra?: Record<string, unknown>;
};

export type ApiBookmark = {
  id: number;
  document: number;
  page_number: number;
  paragraph_id: string;
  label: string;
  tags: string[];
  created_at: string;
};

export type ApiNote = {
  id: number;
  document: number;
  page_number: number;
  paragraph_id: string;
  body: string;
  tags: string[];
  created_at: string;
  updated_at: string;
};

export type ApiHighlight = {
  id: number;
  document: number;
  page_number: number;
  paragraph_id: string;
  char_start: number;
  char_end: number;
  color: HighlightColor;
  note: string;
  created_at: string;
};

export type ApiReadingProgress = {
  id: number;
  document: number;
  last_page: number;
  last_paragraph_id: string;
  scroll_ratio: number;
  percent_complete: number;
  updated_at: string;
};

export type ApiContinueReading = ApiReadingProgress & {
  document_title: string;
  cover_photo_url: string | null;
  thumbnail_url: string | null;
  total_pages: number;
};

// Payloads accepted by the API for create/update. The server sets `user`,
// `id`, and timestamps; the client never sends them.
export type CreateBookmarkPayload = {
  document: number;
  page_number: number;
  paragraph_id?: string;
  label?: string;
  tags?: string[];
};

export type UpdateBookmarkPayload = Partial<CreateBookmarkPayload>;

export type CreateNotePayload = {
  document: number;
  page_number: number;
  paragraph_id?: string;
  body: string;
  tags?: string[];
};

export type UpdateNotePayload = Partial<CreateNotePayload>;

export type CreateHighlightPayload = {
  document: number;
  page_number: number;
  paragraph_id: string;
  char_start: number;
  char_end: number;
  color?: HighlightColor;
  note?: string;
};

export type UpdateHighlightPayload = Partial<CreateHighlightPayload>;

export type UpdateReaderPreferencesPayload = Partial<ReaderPreferences>;

export type UpsertReadingProgressPayload = {
  last_page: number;
  last_paragraph_id?: string;
  scroll_ratio?: number;
  percent_complete?: number;
};

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

// --- URL builders ----------------------------------------------------------

const READER_BASE = '/api/search_engine/reader';

function listUrl(resource: 'bookmarks' | 'notes' | 'highlights', documentId: number): string {
  const path = `${READER_BASE}/${resource}/`;
  const url = API_BASE_URL
    ? new URL(path, API_BASE_URL.endsWith('/') ? API_BASE_URL : `${API_BASE_URL}/`)
    : new URL(path, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
  url.searchParams.append('document', String(documentId));
  return API_BASE_URL ? url.toString() : `${url.pathname}${url.search}`;
}

function detailUrl(resource: 'bookmarks' | 'notes' | 'highlights', id: number): string {
  return buildUrl(`${READER_BASE}/${resource}/${id}/`);
}

// --- AI assistant chat -----------------------------------------------------

export type ChatRole = 'user' | 'assistant';

export type ApiChatCitation = {
  page: number;
  quote: string;
  /** Printed-edition reference (موافقة المطبوع), derived server-side from the
   * document's Edition page_map; absent when the page is unmapped. */
  volume?: number;
  printed_page?: number;
};

export type ApiChatMessage = {
  id: number;
  role: ChatRole;
  content: string;
  citations: ApiChatCitation[];
  context_page: number | null;
  created_at: string;
};

export type ChatContextScope = 'auto' | 'page' | 'book';
export type ChatPin = { page: number; text: string; label: string };

export type ApiChatSession = {
  id: number;
  document: number;
  created_at: string;
  updated_at: string;
  message_count: number;
  title: string;
  context_scope: ChatContextScope;
  pinned_context: ChatPin[];
};

function chatBase(documentId: number): string {
  return `/api/search_engine/documents/${documentId}/chat`;
}

export async function listChatSessions(documentId: number): Promise<ApiChatSession[]> {
  const response = await fetch(buildUrl(`${chatBase(documentId)}/sessions/`), {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  });
  await ensureOk(response, 'Failed to fetch chat sessions');
  return response.json();
}

export async function createChatSession(documentId: number): Promise<ApiChatSession> {
  const response = await fetch(buildUrl(`${chatBase(documentId)}/sessions/`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    credentials: 'include',
    body: '{}',
  });
  await ensureOk(response, 'Failed to create chat session');
  return response.json();
}

export async function updateChatSession(
  documentId: number,
  sessionId: number,
  patch: Partial<Pick<ApiChatSession, 'title' | 'context_scope' | 'pinned_context'>>,
): Promise<ApiChatSession> {
  const response = await fetch(buildUrl(`${chatBase(documentId)}/sessions/${sessionId}/`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    credentials: 'include',
    body: JSON.stringify(patch),
  });
  await ensureOk(response, 'Failed to update chat session');
  return response.json();
}

export async function deleteChatSession(documentId: number, sessionId: number): Promise<void> {
  const response = await fetch(buildUrl(`${chatBase(documentId)}/sessions/${sessionId}/`), {
    method: 'DELETE',
    headers: { ...csrfHeaders() },
    credentials: 'include',
  });
  await ensureOk(response, 'Failed to delete chat session');
}

export async function listChatMessages(
  documentId: number,
  sessionId: number,
): Promise<ApiChatMessage[]> {
  const response = await fetch(
    buildUrl(`${chatBase(documentId)}/sessions/${sessionId}/messages/`),
    {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    },
  );
  await ensureOk(response, 'Failed to fetch chat messages');
  return response.json();
}

export type StoreChatMessagePayload = {
  role: ChatRole;
  content: string;
  citations?: ApiChatCitation[];
  context_page?: number | null;
};

/**
 * Store an already-produced chat message (no LLM call). The CopilotKit reader
 * assistant streams its reply through the deep-agent sidecar, so Django never
 * sees the turn; the client posts each completed message here to keep the
 * durable per-user transcript in sync. Returns the persisted message.
 */
export async function storeChatMessage(
  documentId: number,
  sessionId: number,
  payload: StoreChatMessagePayload,
): Promise<ApiChatMessage> {
  const response = await fetch(
    buildUrl(`${chatBase(documentId)}/sessions/${sessionId}/messages/store/`),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
      credentials: 'include',
      body: JSON.stringify(payload),
    },
  );
  await ensureOk(response, 'Failed to store chat message');
  return response.json();
}

export type StreamChatEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool'; name: string; status: 'running' | 'done' }
  | { type: 'done'; messageId: number; citations: ApiChatCitation[] }
  | { type: 'error'; error: string };

/**
 * Posts a user message and yields parsed Server-Sent Events.
 * Caller iterates and updates the UI per event; on `done`/`error` the stream ends.
 */
export async function* streamChatMessage(
  documentId: number,
  sessionId: number,
  content: string,
  contextPage: number | null,
): AsyncGenerator<StreamChatEvent, void, void> {
  const response = await fetch(
    buildUrl(`${chatBase(documentId)}/sessions/${sessionId}/messages/`),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
      credentials: 'include',
      body: JSON.stringify({ content, context_page: contextPage }),
    },
  );
  if (!response.ok || !response.body) {
    const fallback = await readErrorMessage(response, 'Chat request failed');
    yield { type: 'error', error: fallback };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });

    // Parse complete SSE frames separated by blank line.
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const event = parseSseFrame(frame);
      if (event) yield event;
    }
  }
}

function parseSseFrame(frame: string): StreamChatEvent | null {
  let eventName: string | null = null;
  let data = '';
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) eventName = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (!eventName) return null;
  try {
    const payload = JSON.parse(data);
    if (eventName === 'delta' && typeof payload.text === 'string') {
      return { type: 'delta', text: payload.text };
    }
    if (eventName === 'tool' && typeof payload.name === 'string') {
      return {
        type: 'tool',
        name: payload.name,
        status: payload.status === 'done' ? 'done' : 'running',
      };
    }
    if (eventName === 'done') {
      return {
        type: 'done',
        messageId: payload.message_id ?? 0,
        citations: Array.isArray(payload.citations) ? payload.citations : [],
      };
    }
    if (eventName === 'error') {
      return { type: 'error', error: payload.error ?? 'Unknown error' };
    }
  } catch {
    // ignore malformed payloads
  }
  return null;
}

// --- Chapters --------------------------------------------------------------

export type ApiChapter = {
  id: number;
  title: string;
  order: number;
  page_start: number;
  page_end: number | null;
  children: ApiChapter[];
};

export async function listChapters(documentId: number): Promise<ApiChapter[]> {
  const url = buildUrl(`/api/search_engine/documents/${documentId}/chapters/`);
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  });
  await ensureOk(response, 'Failed to fetch chapters');
  return response.json();
}

// --- Bookmarks -------------------------------------------------------------

export async function listBookmarks(documentId: number): Promise<ApiBookmark[]> {
  const response = await fetch(listUrl('bookmarks', documentId), {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  });
  await ensureOk(response, 'Failed to fetch bookmarks');
  return response.json();
}

export async function createBookmark(payload: CreateBookmarkPayload): Promise<ApiBookmark> {
  const response = await fetch(buildUrl(`${READER_BASE}/bookmarks/`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  await ensureOk(response, 'Failed to create bookmark');
  return response.json();
}

export async function updateBookmark(id: number, patch: UpdateBookmarkPayload): Promise<ApiBookmark> {
  const response = await fetch(detailUrl('bookmarks', id), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    credentials: 'include',
    body: JSON.stringify(patch),
  });
  await ensureOk(response, 'Failed to update bookmark');
  return response.json();
}

export async function deleteBookmark(id: number): Promise<void> {
  const response = await fetch(detailUrl('bookmarks', id), {
    method: 'DELETE',
    headers: { ...csrfHeaders() },
    credentials: 'include',
  });
  await ensureOk(response, 'Failed to delete bookmark');
}

// --- Notes -----------------------------------------------------------------

export async function listNotes(documentId: number): Promise<ApiNote[]> {
  const response = await fetch(listUrl('notes', documentId), {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  });
  await ensureOk(response, 'Failed to fetch notes');
  return response.json();
}

export async function createNote(payload: CreateNotePayload): Promise<ApiNote> {
  const response = await fetch(buildUrl(`${READER_BASE}/notes/`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  await ensureOk(response, 'Failed to create note');
  return response.json();
}

export async function updateNote(id: number, patch: UpdateNotePayload): Promise<ApiNote> {
  const response = await fetch(detailUrl('notes', id), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    credentials: 'include',
    body: JSON.stringify(patch),
  });
  await ensureOk(response, 'Failed to update note');
  return response.json();
}

export async function deleteNote(id: number): Promise<void> {
  const response = await fetch(detailUrl('notes', id), {
    method: 'DELETE',
    headers: { ...csrfHeaders() },
    credentials: 'include',
  });
  await ensureOk(response, 'Failed to delete note');
}

// --- Highlights ------------------------------------------------------------

export async function listHighlights(documentId: number): Promise<ApiHighlight[]> {
  const response = await fetch(listUrl('highlights', documentId), {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  });
  await ensureOk(response, 'Failed to fetch highlights');
  return response.json();
}

export async function createHighlight(payload: CreateHighlightPayload): Promise<ApiHighlight> {
  const response = await fetch(buildUrl(`${READER_BASE}/highlights/`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  await ensureOk(response, 'Failed to create highlight');
  return response.json();
}

export async function updateHighlight(
  id: number,
  patch: UpdateHighlightPayload
): Promise<ApiHighlight> {
  const response = await fetch(detailUrl('highlights', id), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    credentials: 'include',
    body: JSON.stringify(patch),
  });
  await ensureOk(response, 'Failed to update highlight');
  return response.json();
}

export async function deleteHighlight(id: number): Promise<void> {
  const response = await fetch(detailUrl('highlights', id), {
    method: 'DELETE',
    headers: { ...csrfHeaders() },
    credentials: 'include',
  });
  await ensureOk(response, 'Failed to delete highlight');
}

// --- Text corrections (error reports) --------------------------------------

export type CorrectionStatus = 'open' | 'reviewed' | 'resolved';

export type ApiTextCorrection = {
  id: number;
  document: number;
  page_number: number;
  paragraph_id: string;
  char_start: number;
  char_end: number;
  selected_text: string;
  description: string;
  suggested_correction: string;
  status: CorrectionStatus;
  created_at: string;
};

// The server sets `user`, `id`, `status`, and timestamps; the client never
// sends them.
export type CreateCorrectionPayload = {
  document: number;
  page_number: number;
  paragraph_id?: string;
  char_start: number;
  char_end: number;
  selected_text: string;
  description: string;
  suggested_correction?: string;
};

export async function createCorrection(
  payload: CreateCorrectionPayload
): Promise<ApiTextCorrection> {
  const response = await fetch(buildUrl(`${READER_BASE}/corrections/`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  await ensureOk(response, 'Failed to submit correction');
  return response.json();
}

// --- Reader preferences ----------------------------------------------------

export async function getReaderPreferences(): Promise<ReaderPreferences> {
  const response = await fetch(buildUrl(`${READER_BASE}/preferences/`), {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  });
  await ensureOk(response, 'Failed to fetch reader preferences');
  return response.json();
}

export async function updateReaderPreferences(
  patch: UpdateReaderPreferencesPayload
): Promise<ReaderPreferences> {
  const response = await fetch(buildUrl(`${READER_BASE}/preferences/`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    credentials: 'include',
    body: JSON.stringify(patch),
  });
  await ensureOk(response, 'Failed to update reader preferences');
  return response.json();
}

// --- Reading progress ------------------------------------------------------

export async function upsertReadingProgress(
  documentId: number,
  payload: UpsertReadingProgressPayload
): Promise<ApiReadingProgress> {
  const response = await fetch(buildUrl(`${READER_BASE}/progress/${documentId}/`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  await ensureOk(response, 'Failed to save reading progress');
  return response.json();
}

// --- Continue reading shelf ------------------------------------------------

export async function listContinueReading(limit?: number): Promise<ApiContinueReading[]> {
  const path = `${READER_BASE}/continue/`;
  const url = API_BASE_URL
    ? new URL(path, API_BASE_URL.endsWith('/') ? API_BASE_URL : `${API_BASE_URL}/`)
    : new URL(path, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
  if (typeof limit === 'number') {
    url.searchParams.append('limit', String(limit));
  }
  const target = API_BASE_URL ? url.toString() : `${url.pathname}${url.search}`;
  const response = await fetch(target, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  });
  await ensureOk(response, 'Failed to fetch continue-reading shelf');
  return response.json();
}

// --- Notes export ----------------------------------------------------------

export async function exportNotes(documentId: number, format: NoteExportFormat): Promise<Blob> {
  const path = `${READER_BASE}/notes/export/`;
  const url = API_BASE_URL
    ? new URL(path, API_BASE_URL.endsWith('/') ? API_BASE_URL : `${API_BASE_URL}/`)
    : new URL(path, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
  url.searchParams.append('document', String(documentId));
  url.searchParams.append('format', format);
  const target = API_BASE_URL ? url.toString() : `${url.pathname}${url.search}`;
  const response = await fetch(target, {
    method: 'GET',
    credentials: 'include',
  });
  await ensureOk(response, 'Failed to export notes');
  return response.blob();
}
