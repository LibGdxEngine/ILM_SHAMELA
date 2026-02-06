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

export interface Author {
  id: number;
  name: string;
  photo: string | null;
  date_of_birth: string | null;
  date_of_death: string | null;
}

export interface Document {
  id: number;
  title: string;
  file: string;
  uploaded_at: string;
  processed: boolean;
  language: string | null;
  content?: string | null;
  authors: Author[];
  categories: string[];
}

export interface UploadResponse {
  id: number;
  title: string;
  file: string;
  uploaded_at: string;
  processed: boolean;
  language: string | null;
  content?: string | null;
  authors: Author[];
  categories: string[];
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
}

export interface DocumentSearchResponse {
  matches: DocumentSearchMatch[];
  total_matches: number;
  query: string;
}

/**
 * Upload a document file to the backend
 */
export async function uploadDocument(
  file: File,
  onProgress?: (progress: number) => void
): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('title', file.name);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

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
    signal,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || error.message || 'Search failed');
  }

  return response.json();
}
