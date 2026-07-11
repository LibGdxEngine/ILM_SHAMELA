import { csrfHeaders } from './csrf';

// Get API base URL - use relative URLs when possible to avoid CORS issues
// In the browser, always use relative URLs to match the current origin
// This prevents CORS issues when accessing via different hostnames (localhost vs 127.0.0.1)
function getApiBaseUrl(): string {
  // In the browser, use relative URLs to avoid CORS issues
  // This ensures requests always go to the same origin as the page
  if (typeof window !== 'undefined') {
    return ''; // Empty string means relative URLs
  }

  // For server-side rendering, use the env var or fallback
  const envUrl = process.env.NEXT_PUBLIC_API_URL;
  return envUrl || 'http://localhost:8000';
}

const API_BASE_URL = getApiBaseUrl();

/**
 * Convert backend media URL to frontend-accessible URL
 * If the URL points to the backend server, convert it to use the frontend proxy
 */
export function normalizeMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;

  // If it's already a relative URL or data URL, return as-is
  if (url.startsWith('/') || url.startsWith('data:')) {
    return url;
  }

  // If it's an absolute URL pointing to the backend, convert to relative
  try {
    const urlObj = new URL(url);
    // Check if it's pointing to backend server (localhost:8000, 127.0.0.1:8000, or backend:8000)
    if (
      (urlObj.hostname === 'localhost' && urlObj.port === '8000') ||
      (urlObj.hostname === '127.0.0.1' && urlObj.port === '8000') ||
      urlObj.hostname === 'backend' ||
      url.includes('localhost:8000') ||
      url.includes('127.0.0.1:8000') ||
      url.includes('backend:8000')
    ) {
      // Extract the path part (e.g., /media/documents/covers/...)
      return urlObj.pathname + urlObj.search;
    }
  } catch (e) {
    // If URL parsing fails, return as-is
    console.warn('Failed to parse URL:', url, e);
  }

  return url;
}

export interface Author {
  id: number;
  name: string;
  photo: string | null;
  date_of_birth: string | null;
  date_of_death: string | null;
}

export interface Category {
  id: number;
  name: string;
  created_at?: string;
  updated_at?: string;
}

export interface DocumentAlternateName {
  id: number;
  name: string;
  created_at: string;
}

/** Rights-audit classification of a document (نضيف / رمادي / ممنوع). */
export type RightsStatus = 'unreviewed' | 'clear' | 'gray' | 'restricted';

/** The printed edition a document was digitized from (موافقة المطبوع). */
export interface Edition {
  id: number;
  /** Editor / muhaqqiq (المحقق). */
  editor: string;
  publisher: string;
  publication_place: string;
  edition_statement: string;
  publication_year_hijri: string;
  publication_year_gregorian: string;
  volume_count: number | null;
  /** Digital→printed page ranges; the mapping math lives server-side only. */
  page_map: Array<{
    volume: number;
    from_page: number;
    to_page: number;
    printed_start: number;
  }>;
  notes: string;
}

/** Printed-edition reference for a digital page, derived server-side. */
export interface PrintedRef {
  volume: number;
  printed_page: number;
}

export interface Document {
  id: number;
  title: string;
  file: string;
  uploaded_at: string;
  processed: boolean;
  processing_status?: 'pending' | 'processing' | 'succeeded' | 'failed';
  processing_error?: string | null;
  processing_attempts?: number;
  processing_started_at?: string | null;
  processing_completed_at?: string | null;
  language: string | null;
  content?: string | null;
  authors: Author[];
  categories: Category[];
  description?: string | null;
  written_date?: string | null;
  cover_photo?: string | null;
  cover_photo_url?: string | null;
  thumbnail?: string | null;
  thumbnail_url?: string | null;
  alternate_names?: DocumentAlternateName[];
  /** True when the document has an OCR layout (PDF-overlay reader mode). */
  has_layout?: boolean;
  rights_status?: RightsStatus;
  provenance_source?: string;
  rights_notes?: string;
  /** Present on the detail endpoint only. */
  editions?: Edition[];
  // One of lexical/semantic is `null` for the mode that wasn't computed
  // (exact → score_semantic: null; semantic → score_lexical: null).
  score_lexical?: number | null;
  score_semantic?: number | null;
  score_final?: number;
  /** Highlighted result fragment from search; `null` in pure-semantic mode. */
  snippet?: string | null;
  explanations?: {
    matched_fields: string[];
    method: string;
  };
}

export interface UploadResponse {
  id: number;
  title: string;
  file: string;
  uploaded_at: string;
  processed: boolean;
  processing_status?: 'pending' | 'processing' | 'succeeded' | 'failed';
  processing_error?: string | null;
  processing_attempts?: number;
  language: string | null;
  content?: string | null;
  authors: Author[];
  categories: Category[];
  description?: string | null;
  written_date?: string | null;
  cover_photo?: string | null;
  cover_photo_url?: string | null;
  thumbnail?: string | null;
  thumbnail_url?: string | null;
  alternate_names?: DocumentAlternateName[];
}

export interface AuthorsListResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: Author[];
}

export interface CategoriesListResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: Category[];
}

export interface UploadDocumentParams {
  file: File;
  title: string;
  authors_ids?: number[];
  author_names?: string[];
  category_names?: string[];
  alternate_names?: string[];
  description?: string;
  written_date?: string;
  language?: string;
  cover_photo?: File;
  ocr_engine?: string;
  /** Optional datalab/marker OCR JSON enabling the PDF-overlay reader (PDF only). */
  ocr_layout?: File;
  rights_status?: RightsStatus;
  provenance_source?: string;
  /** Printed-edition metadata (موافقة المطبوع) captured at upload. */
  edition_editor?: string;
  edition_publisher?: string;
  edition_year_hijri?: string;
  edition_year_gregorian?: string;
  edition_volume_count?: number;
}

export interface OCREngine {
  id: string;
  label: string;
  available: boolean;
}

export interface SearchResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: Document[];
}

export interface DocumentsListParams {
  page?: number;
  authors?: string[];
  categories?: string[];
  documents?: number[];
  language?: string;
  date_from?: string;
  date_to?: string;
  search?: string;
}

export interface DocumentsListResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: Document[];
  /**
   * Set only by `getDocumentsSearch()` when a search mode degraded (e.g.
   * `semantic` with embeddings unavailable → `"embedding_unavailable"`).
   * Plain `getDocuments()` responses never populate this.
   */
  degraded_reason?: string;
}

/** Library-wide (corpus) search modes accepted by `getDocumentsSearch()`. */
export type CorpusSearchMode = 'exact' | 'semantic' | 'hybrid';

/** One positioned OCR block on a page (PDF-overlay reader mode). */
export interface LayoutBlock {
  id: string;
  type: string;
  /** [x0, y0, x1, y1] in the OCR pixel space of `PageLayout.width/height`. */
  bbox: [number, number, number, number];
  text: string;
  /** Offsets into the page `content` (blocks joined by '\n'). */
  char_start: number;
  char_end: number;
}

/** Per-page OCR geometry for the transparent text overlay. */
export interface PageLayout {
  width: number;
  height: number;
  blocks: LayoutBlock[];
}

export interface DocumentPage {
  page_number: number;
  content: string;
  /** Rendered PDF page image (PDF-overlay reader mode only). */
  image_url?: string | null;
  /** OCR geometry for the transparent overlay (PDF-overlay reader mode only). */
  layout?: PageLayout | null;
  /** Printed-edition (volume, page) for this digital page; null when unmapped. */
  printed_ref?: PrintedRef | null;
}

export interface DocumentPagesResponse {
  total_pages: number;
  current_page: number;
  page_size: number;
  pages: DocumentPage[];
}

export interface DocumentSearchMatch {
  page_number: number;
  snippet: string;
  score?: number;
  score_lexical?: number;
  score_semantic?: number | null;  // null = no chunks for this doc (hide badge)
  score_final?: number;
}

export interface DocumentSearchResponse {
  matches: DocumentSearchMatch[];
  total_matches: number;
  query: string;
  has_semantic?: boolean;
  /** Mode these results were produced with — stamped client-side (the backend does not echo it). */
  mode?: InDocSearchMode;
}

/** In-document search modes (mirror of the backend `VALID_SEARCH_MODES`). */
export type InDocSearchMode = 'exact' | 'similar' | 'semantic' | 'mix';

export interface SearchInDocumentOptions {
  mode?: InDocSearchMode;
  /** Vector-similarity threshold (0–1); applies to `semantic` and `mix`. */
  threshold?: number;
  signal?: AbortSignal;
}

export interface SearchSuggestionsResponse {
  query: string;
  suggestions: string[];
}

/** Structured filters produced by the natural-language search assistant.
 *  Shape mirrors the `/documents` page's `DocumentFilterValues`. */
export interface AssistFilters {
  q: string;
  mode: CorpusSearchMode;
  authors: string[];
  categories: string[];
  languages: string[];
  dateFrom: string | null;
  dateTo: string | null;
}

export interface AssistSearchResponse {
  filters: AssistFilters;
  interpretation: string | null;
  /** Present when the LLM was unavailable and we fell back to a plain search. */
  degraded_reason?: string;
}

/**
 * Get list of authors
 */
export async function getAuthors(search?: string): Promise<AuthorsListResponse> {
  const basePath = '/api/search_engine/authors/';
  const url = API_BASE_URL
    ? new URL(basePath, API_BASE_URL.endsWith('/') ? API_BASE_URL : `${API_BASE_URL}/`)
    : new URL(basePath, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');

  if (search) {
    url.searchParams.append('search', search);
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || error.message || 'Failed to fetch authors');
  }

  return response.json();
}

/**
 * Get list of categories
 */
export async function getCategories(search?: string): Promise<CategoriesListResponse> {
  const basePath = '/api/search_engine/categories/';
  const url = API_BASE_URL
    ? new URL(basePath, API_BASE_URL.endsWith('/') ? API_BASE_URL : `${API_BASE_URL}/`)
    : new URL(basePath, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');

  if (search) {
    url.searchParams.append('search', search);
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || error.message || 'Failed to fetch categories');
  }

  return response.json();
}

/**
 * Upload a document file to the backend
 */
export async function uploadDocument(
  params: UploadDocumentParams,
  onProgress?: (progress: number) => void
): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append('file', params.file);
  formData.append('title', params.title);

  // Add optional metadata fields
  if (params.authors_ids && params.authors_ids.length > 0) {
    params.authors_ids.forEach(id => {
      formData.append('authors_ids', id.toString());
    });
  }

  if (params.author_names && params.author_names.length > 0) {
    // Send author_names as JSON array for ListField
    formData.append('author_names', JSON.stringify(params.author_names));
  }

  if (params.category_names && params.category_names.length > 0) {
    // Send category_names as JSON array for ListField
    formData.append('category_names', JSON.stringify(params.category_names));
  }

  if (params.alternate_names && params.alternate_names.length > 0) {
    // Send alternate_names as JSON array for ListField
    formData.append('alternate_names', JSON.stringify(params.alternate_names));
  }

  if (params.description) {
    formData.append('description', params.description);
  }

  if (params.written_date) {
    formData.append('written_date', params.written_date);
  }

  if (params.language) {
    formData.append('language', params.language);
  }

  if (params.cover_photo) {
    formData.append('cover_photo', params.cover_photo);
  }

  if (params.ocr_engine) {
    formData.append('ocr_engine', params.ocr_engine);
  }

  if (params.ocr_layout) {
    formData.append('ocr_layout', params.ocr_layout);
  }

  if (params.rights_status) {
    formData.append('rights_status', params.rights_status);
  }

  if (params.provenance_source) {
    formData.append('provenance_source', params.provenance_source);
  }

  if (params.edition_editor) {
    formData.append('edition_editor', params.edition_editor);
  }

  if (params.edition_publisher) {
    formData.append('edition_publisher', params.edition_publisher);
  }

  if (params.edition_year_hijri) {
    formData.append('edition_year_hijri', params.edition_year_hijri);
  }

  if (params.edition_year_gregorian) {
    formData.append('edition_year_gregorian', params.edition_year_gregorian);
  }

  if (params.edition_volume_count) {
    formData.append('edition_volume_count', params.edition_volume_count.toString());
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.withCredentials = true;

    // Track upload progress
    if (onProgress) {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const progress = (e.loaded / e.total) * 100;
          onProgress(progress);
        }
      });
    }

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const response = JSON.parse(xhr.responseText);
          resolve(response);
        } catch (error) {
          reject(new Error('Failed to parse response'));
        }
      } else {
        try {
          const error = JSON.parse(xhr.responseText);
          reject(new Error(error.detail || error.message || 'Upload failed'));
        } catch {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      }
    });

    xhr.addEventListener('error', () => {
      reject(new Error('Network error during upload'));
    });

    xhr.addEventListener('abort', () => {
      reject(new Error('Upload was aborted'));
    });

    // Construct URL - use relative if API_BASE_URL is empty
    const uploadUrl = API_BASE_URL
      ? `${API_BASE_URL}${API_BASE_URL.endsWith('/') ? '' : '/'}api/search_engine/documents/`
      : '/api/search_engine/documents/';
    xhr.open('POST', uploadUrl);
    if (typeof document !== 'undefined') {
      const csrfToken = document.cookie
        .split('; ')
        .find((row) => row.startsWith('csrftoken='))
        ?.split('=')[1];
      if (csrfToken) {
        xhr.setRequestHeader('X-CSRFToken', decodeURIComponent(csrfToken));
      }
    }
    xhr.send(formData);
  });
}

/**
 * Search for documents
 */
export async function searchDocuments(query: string): Promise<SearchResponse> {
  if (!query.trim()) {
    return {
      count: 0,
      next: null,
      previous: null,
      results: [],
    };
  }

  // Use relative URL if API_BASE_URL is empty, otherwise construct full URL
  const basePath = '/api/search_engine/documents/search/';
  const url = API_BASE_URL
    ? new URL(basePath, API_BASE_URL.endsWith('/') ? API_BASE_URL : `${API_BASE_URL}/`)
    : new URL(basePath, window.location.origin);
  url.searchParams.append('q', query);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || error.message || 'Search failed');
  }

  return response.json();
}

/**
 * Get paginated list of documents with filtering
 */
export async function getDocuments(params: DocumentsListParams = {}): Promise<DocumentsListResponse> {
  const basePath = '/api/search_engine/documents/';
  const url = API_BASE_URL
    ? new URL(basePath, API_BASE_URL.endsWith('/') ? API_BASE_URL : `${API_BASE_URL}/`)
    : new URL(basePath, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');

  if (params.page) {
    url.searchParams.append('page', params.page.toString());
  }
  if (params.authors && params.authors.length > 0) {
    url.searchParams.append('authors', params.authors.join(','));
  }
  if (params.categories && params.categories.length > 0) {
    url.searchParams.append('categories', params.categories.join(','));
  }
  if (params.documents && params.documents.length > 0) {
    url.searchParams.append('documents', params.documents.join(','));
  }
  if (params.language) {
    url.searchParams.append('language', params.language);
  }
  if (params.date_from) {
    url.searchParams.append('date_from', params.date_from);
  }
  if (params.date_to) {
    url.searchParams.append('date_to', params.date_to);
  }
  if (params.search) {
    url.searchParams.append('q', params.search);
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || error.message || 'Failed to fetch documents');
  }

  return response.json();
}

export interface DocumentsSearchParams {
  /** Free-text query (required — this endpoint is query-driven). */
  q: string;
  /** Search mode; omitted from the request when `'hybrid'` (the backend default). */
  mode?: CorpusSearchMode;
  /** Scope the search to specific document IDs. */
  documents?: number[];
  page?: number;
  authors?: string[];
  categories?: string[];
  language?: string;
  date_from?: string;
  date_to?: string;
}

/**
 * Library-wide (corpus) search over documents via the Elasticsearch-backed
 * `documents/search/` endpoint, supporting exact / semantic / hybrid modes and
 * book-scoping. Distinct from the dead `searchDocuments()` helper; this is the
 * function the navbar search flow uses whenever a query is active.
 */
export async function getDocumentsSearch(params: DocumentsSearchParams): Promise<DocumentsListResponse> {
  const basePath = '/api/search_engine/documents/search/';
  const url = API_BASE_URL
    ? new URL(basePath, API_BASE_URL.endsWith('/') ? API_BASE_URL : `${API_BASE_URL}/`)
    : new URL(basePath, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');

  url.searchParams.append('q', params.q);
  // Omit `mode` entirely when it's the backend default to keep requests minimal.
  if (params.mode && params.mode !== 'hybrid') {
    url.searchParams.append('mode', params.mode);
  }
  if (params.documents && params.documents.length > 0) {
    url.searchParams.append('documents', params.documents.join(','));
  }
  if (params.authors && params.authors.length > 0) {
    url.searchParams.append('authors', params.authors.join(','));
  }
  if (params.categories && params.categories.length > 0) {
    url.searchParams.append('categories', params.categories.join(','));
  }
  if (params.language) {
    url.searchParams.append('language', params.language);
  }
  if (params.date_from) {
    url.searchParams.append('date_from', params.date_from);
  }
  if (params.date_to) {
    url.searchParams.append('date_to', params.date_to);
  }
  if (params.page) {
    url.searchParams.append('page', params.page.toString());
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    // DocumentSearchView returns validation errors as `{error: '...'}`
    // (e.g. "Invalid mode…"), so check `error` first to surface the real message.
    throw new Error(error.error || error.detail || error.message || 'Search failed');
  }

  return response.json();
}

/**
 * Get a single document by ID
 */
export async function getDocument(id: number): Promise<Document> {
  const url = API_BASE_URL
    ? `${API_BASE_URL}${API_BASE_URL.endsWith('/') ? '' : '/'}api/search_engine/documents/${id}/`
    : `/api/search_engine/documents/${id}/`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || error.message || 'Failed to fetch document');
  }

  return response.json();
}

/**
 * Thrown when the backend reports the user's daily reading quota is spent
 * (429 with `error: 'quota_exceeded'`), so the reader can show a dedicated
 * "come back tomorrow" screen instead of a generic failure.
 */
export class QuotaExceededError extends Error {
  quota: 'documents' | 'pages';
  limit: number;
  retryAfterSeconds: number;

  constructor(body: { quota: 'documents' | 'pages'; limit: number; retry_after_seconds: number }) {
    super('quota_exceeded');
    this.name = 'QuotaExceededError';
    this.quota = body.quota;
    this.limit = body.limit;
    this.retryAfterSeconds = body.retry_after_seconds;
  }
}

/**
 * Get paginated content pages of a document
 */
export async function getDocumentPages(
  id: number,
  page: number = 1,
  pageSize: number = 1
): Promise<DocumentPagesResponse> {
  const basePath = `/api/search_engine/documents/${id}/pages/`;
  const url = API_BASE_URL
    ? new URL(basePath, API_BASE_URL.endsWith('/') ? API_BASE_URL : `${API_BASE_URL}/`)
    : new URL(basePath, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
  url.searchParams.append('page', page.toString());
  url.searchParams.append('page_size', pageSize.toString());

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    if (response.status === 429 && error.error === 'quota_exceeded') {
      throw new QuotaExceededError(error);
    }
    throw new Error(error.detail || error.message || error.error || 'Failed to fetch document pages');
  }

  return response.json();
}

/**
 * Search within a single document
 */
export async function searchInDocument(
  id: number,
  query: string,
  opts: SearchInDocumentOptions = {}
): Promise<DocumentSearchResponse> {
  const { mode = 'mix', threshold, signal } = opts;
  if (!query.trim()) {
    return {
      matches: [],
      total_matches: 0,
      query: '',
      mode,
    };
  }

  const basePath = `/api/search_engine/documents/${id}/search/`;
  const url = API_BASE_URL
    ? new URL(basePath, API_BASE_URL.endsWith('/') ? API_BASE_URL : `${API_BASE_URL}/`)
    : new URL(basePath, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
  url.searchParams.append('q', query);
  url.searchParams.append('mode', mode);
  // Threshold only matters for the vector-bearing modes.
  if (threshold != null && (mode === 'semantic' || mode === 'mix')) {
    url.searchParams.append('threshold', String(threshold));
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    signal,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || error.message || 'Search failed');
  }

  return { ...(await response.json()), mode };
}

/**
 * Get the list of OCR engines available for document processing.
 */
export async function getOCREngines(): Promise<OCREngine[]> {
  const basePath = '/api/search_engine/ocr-engines/';
  const url = API_BASE_URL
    ? new URL(basePath, API_BASE_URL.endsWith('/') ? API_BASE_URL : `${API_BASE_URL}/`)
    : new URL(basePath, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || error.message || 'Failed to fetch OCR engines');
  }

  return response.json();
}

/**
 * Get search suggestions for partial input.
 */
export async function getSearchSuggestions(query: string): Promise<SearchSuggestionsResponse> {
  if (!query.trim()) {
    return { query: '', suggestions: [] };
  }

  const basePath = '/api/search_engine/documents/suggest/';
  const url = API_BASE_URL
    ? new URL(basePath, API_BASE_URL.endsWith('/') ? API_BASE_URL : `${API_BASE_URL}/`)
    : new URL(basePath, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
  url.searchParams.append('q', query);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || error.message || 'Failed to fetch suggestions');
  }

  return response.json();
}

/**
 * Convert a free-form natural-language query (Arabic/English) into structured
 * library filters via the search-engine AI. Returns the parsed `filters` (in the
 * page's `DocumentFilterValues` shape) plus a short human `interpretation`. When
 * the LLM is unavailable the backend degrades to a plain hybrid search over the
 * raw text and sets `degraded_reason`, so callers can always apply the result.
 */
export async function assistSearch(q: string, locale?: string): Promise<AssistSearchResponse> {
  const basePath = '/api/search_engine/documents/search/assist/';
  const url = API_BASE_URL
    ? new URL(basePath, API_BASE_URL.endsWith('/') ? API_BASE_URL : `${API_BASE_URL}/`)
    : new URL(basePath, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...csrfHeaders(),
    },
    credentials: 'include',
    body: JSON.stringify({ q, locale }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || error.message || 'AI search failed');
  }

  return response.json();
}

/**
 * Get paginated list of documents by author's country (nationality)
 */
export async function getDocumentsByCountry(
  country: string,
  page: number = 1
): Promise<DocumentsListResponse> {
  if (!country.trim()) {
    return {
      count: 0,
      next: null,
      previous: null,
      results: [],
    };
  }

  const basePath = `/api/search_engine/documents/country/${encodeURIComponent(country)}/`;
  const url = API_BASE_URL
    ? new URL(basePath, API_BASE_URL.endsWith('/') ? API_BASE_URL : `${API_BASE_URL}/`)
    : new URL(basePath, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');

  if (page > 1) {
    url.searchParams.append('page', page.toString());
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || error.message || 'Failed to fetch documents by country');
  }

  return response.json();
}

export interface CountryDocumentStat {
  country: string;
  document_count: number;
}

/**
 * Get aggregated document counts per country from the denormalized table.
 */
export async function getCountryDocumentStats(): Promise<CountryDocumentStat[]> {
  const basePath = '/api/search_engine/documents/country-stats/';
  const url = API_BASE_URL
    ? new URL(basePath, API_BASE_URL.endsWith('/') ? API_BASE_URL : `${API_BASE_URL}/`)
    : new URL(basePath, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || error.message || 'Failed to fetch country stats');
  }

  return response.json();
}

