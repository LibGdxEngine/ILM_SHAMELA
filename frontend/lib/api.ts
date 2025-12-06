const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export interface Document {
  id: number;
  title: string;
  file: string;
  uploaded_at: string;
  processed: boolean;
  language: string | null;
  content: string | null;
}

export interface UploadResponse {
  id: number;
  title: string;
  file: string;
  uploaded_at: string;
  processed: boolean;
  language: string | null;
  content: string | null;
}

export interface SearchResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: Document[];
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

    xhr.open('POST', `${API_BASE_URL}/api/search_engine/documents/`);
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

  const url = new URL(`${API_BASE_URL}/api/search_engine/documents/search/`);
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
