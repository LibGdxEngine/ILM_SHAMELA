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
  score_lexical?: number;
  score_semantic?: number;
  score_final?: number;
  explanations?: {
    matched_fields: string[];
    weights: { lexical: number; semantic: number };
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
}

export interface DocumentPage {
  page_number: number;
  content: string;
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
}

export interface SearchSuggestionsResponse {
  query: string;
  suggestions: string[];
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
    throw new Error(error.detail || error.message || 'Failed to fetch document pages');
  }

  return response.json();
}

/**
 * Search within a single document
 */
export async function searchInDocument(
  id: number,
  query: string,
  signal?: AbortSignal
): Promise<DocumentSearchResponse> {
  if (!query.trim()) {
    return {
      matches: [],
      total_matches: 0,
      query: '',
    };
  }

  const basePath = `/api/search_engine/documents/${id}/search/`;
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
    signal,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || error.message || 'Search failed');
  }

  return response.json();
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
