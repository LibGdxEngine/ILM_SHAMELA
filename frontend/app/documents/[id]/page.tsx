'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getDocument,
  getDocumentPages,
  searchInDocument,
  Document,
  DocumentPagesResponse,
  DocumentSearchResponse,
} from '@/lib/api';

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

function highlightText(text: string, query: string): string {
  if (!query.trim()) return text;
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return text.replace(regex, '<mark class="bg-yellow-200">$1</mark>');
}

export default function DocumentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const documentId = parseInt(params.id as string);

  const [document, setDocument] = useState<Document | null>(null);
  const [pages, setPages] = useState<DocumentPagesResponse | null>(null);
  const [currentPageNum, setCurrentPageNum] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingPages, setIsLoadingPages] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<DocumentSearchResponse | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const debouncedSearch = useDebounce(searchQuery, 500);

  const fetchDocument = useCallback(async () => {
    try {
      const doc = await getDocument(documentId);
      setDocument(doc);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load document');
    } finally {
      setIsLoading(false);
    }
  }, [documentId]);

  const fetchPages = useCallback(async (page: number) => {
    setIsLoadingPages(true);
    try {
      const pagesData = await getDocumentPages(documentId, page, 1);
      setPages(pagesData);
      setCurrentPageNum(page);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pages');
    } finally {
      setIsLoadingPages(false);
    }
  }, [documentId]);

  const performSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults(null);
      return;
    }

    setIsSearching(true);
    try {
      const results = await searchInDocument(documentId, query);
      setSearchResults(results);
    } catch (err) {
      console.error('Search error:', err);
      setSearchResults({ matches: [], total_matches: 0, query });
    } finally {
      setIsSearching(false);
    }
  }, [documentId]);

  useEffect(() => {
    fetchDocument();
    fetchPages(1);
  }, [fetchDocument, fetchPages]);

  useEffect(() => {
    performSearch(debouncedSearch);
  }, [debouncedSearch, performSearch]);

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= (pages?.total_pages || 1)) {
      fetchPages(page);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const goToSearchResult = (pageNumber: number) => {
    setCurrentPageNum(pageNumber);
    fetchPages(pageNumber);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  if (isLoading) {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="container mx-auto px-4 py-8 max-w-6xl">
          <div className="bg-white rounded-lg shadow-sm p-12 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading document...</p>
          </div>
        </div>
      </main>
    );
  }

  if (error || !document) {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="container mx-auto px-4 py-8 max-w-6xl">
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
              <p>{error || 'Document not found'}</p>
            </div>
            <Link
              href="/documents"
              className="mt-4 inline-block text-blue-600 hover:text-blue-700"
            >
              ← Back to Documents
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Header */}
        <div className="mb-6">
          <Link
            href="/documents"
            className="text-blue-600 hover:text-blue-700 mb-4 inline-block"
          >
            ← Back to Documents
          </Link>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">{document.title}</h1>
          <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
            {document.authors && document.authors.length > 0 && (
              <div>
                <span className="font-medium">Authors: </span>
                <span>{document.authors.join(', ')}</span>
              </div>
            )}
            {document.language && (
              <div>
                <span className="font-medium">Language: </span>
                <span>{document.language.toUpperCase()}</span>
              </div>
            )}
            <div>
              <span className="font-medium">Uploaded: </span>
              <span>{formatDate(document.uploaded_at)}</span>
            </div>
            {document.categories && document.categories.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {document.categories.map((category) => (
                  <span
                    key={category}
                    className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded-full"
                  >
                    {category}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Search Bar */}
        <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search within this document..."
              className="w-full px-4 py-2 pl-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
            <svg
              className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            {isSearching && (
              <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500"></div>
              </div>
            )}
          </div>

          {/* Search Results */}
          {searchResults && searchQuery.trim() && (
            <div className="mt-4">
              {searchResults.total_matches > 0 ? (
                <div>
                  <p className="text-sm text-gray-600 mb-2">
                    Found {searchResults.total_matches} match{searchResults.total_matches !== 1 ? 'es' : ''}
                  </p>
                  <div className="max-h-48 overflow-y-auto space-y-2">
                    {searchResults.matches.map((match, idx) => (
                      <div
                        key={idx}
                        className="p-2 bg-gray-50 rounded hover:bg-gray-100 cursor-pointer"
                        onClick={() => goToSearchResult(match.page_number)}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-blue-600">
                            Page {match.page_number}
                          </span>
                          <span className="text-xs text-gray-500">Position: {match.position}</span>
                        </div>
                        <p
                          className="text-sm text-gray-700"
                          dangerouslySetInnerHTML={{ __html: highlightText(match.snippet, searchQuery) }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-600">No matches found</p>
              )}
            </div>
          )}
        </div>

        {/* Document Content */}
        <div className="bg-white rounded-lg shadow-sm p-8 mb-6">
          {isLoadingPages ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-4 text-gray-600">Loading page...</p>
            </div>
          ) : pages && pages.pages.length > 0 ? (
            <div>
              <div
                className="prose max-w-none mb-6"
                dangerouslySetInnerHTML={{
                  __html: highlightText(
                    pages.pages[0].content.replace(/\n/g, '<br />'),
                    searchQuery
                  ),
                }}
              />
            </div>
          ) : (
            <div className="text-center py-12 text-gray-600">
              <p>No content available</p>
            </div>
          )}
        </div>

        {/* Pagination */}
        {pages && pages.total_pages > 1 && (
          <div className="bg-white rounded-lg shadow-sm p-4">
            <div className="flex items-center justify-between">
              <button
                onClick={() => handlePageChange(currentPageNum - 1)}
                disabled={currentPageNum === 1}
                className="px-4 py-2 border border-gray-300 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
              >
                Previous Page
              </button>
              <span className="text-sm text-gray-700">
                Page {currentPageNum} of {pages.total_pages}
              </span>
              <button
                onClick={() => handlePageChange(currentPageNum + 1)}
                disabled={currentPageNum === pages.total_pages}
                className="px-4 py-2 border border-gray-300 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
              >
                Next Page
              </button>
            </div>

            {/* Page Jump */}
            <div className="mt-4 flex items-center justify-center space-x-2">
              <span className="text-sm text-gray-600">Go to page:</span>
              <input
                type="number"
                min={1}
                max={pages.total_pages}
                value={currentPageNum}
                onChange={(e) => {
                  const page = parseInt(e.target.value);
                  if (page >= 1 && page <= pages.total_pages) {
                    handlePageChange(page);
                  }
                }}
                className="w-20 px-2 py-1 border border-gray-300 rounded-md text-center"
              />
              <span className="text-sm text-gray-600">of {pages.total_pages}</span>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
