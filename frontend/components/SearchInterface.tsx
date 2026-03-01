'use client';

import { useState, useEffect, useCallback } from 'react';
import { searchDocuments, Document } from '@/lib/api';
import { useI18n } from '@/components/i18n/I18nProvider';
import { localeToDateLocale } from '@/lib/i18n/config';
import { highlightText, extractSnippet } from '@/lib/utils';

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

export default function SearchInterface() {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Document[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debouncedQuery = useDebounce(query, 500);

  const performSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await searchDocuments(searchQuery);
      setResults(response.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('search.errorFallback', 'Search failed'));
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    performSearch(debouncedQuery);
  }, [debouncedQuery, performSearch]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(localeToDateLocale(locale), {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="w-full">
      <div className="mb-6">
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('search.placeholder', 'Search documents...')}
            className="w-full px-4 py-3 pl-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
          <svg
            className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400"
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
          {isLoading && (
            <div className="absolute right-4 top-1/2 transform -translate-y-1/2">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500"></div>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded-lg">
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      {!query.trim() && (
        <div className="text-center py-12 text-gray-500">
          <p>{t('search.emptyPrompt', 'Enter a query to find documents')}</p>
        </div>
      )}

      {query.trim() && !isLoading && results.length === 0 && !error && (
        <div className="text-center py-12 text-gray-500">
          <p>{t('search.noResults', 'No documents found matching your search')}</p>
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-4">
          <div className="text-sm text-gray-600 mb-4">
            {t('search.resultsCount', 'Found {count} results', { count: results.length })}
          </div>
          {results.map((document) => {
            const isReady = document.processing_status
              ? document.processing_status === 'succeeded'
              : document.processed;
            return (
              <div
                key={document.id}
                className="border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-3">
                  <h3 className="text-lg font-semibold text-gray-900">
                    {document.title}
                  </h3>
                  <span
                    className={`px-2 py-1 text-xs rounded-full ${
                      isReady
                        ? 'bg-green-100 text-green-800'
                        : 'bg-yellow-100 text-yellow-800'
                    }`}
                  >
                    {isReady
                      ? t('search.status.processed', 'Processed')
                      : t('search.status.processing', 'Processing...')}
                  </span>
                </div>

                {document.content && query.trim() && (
                  <div className="mb-3">
                    <p
                      className="text-gray-700 text-sm leading-relaxed"
                      dangerouslySetInnerHTML={{
                        __html: highlightText(
                          extractSnippet(document.content, query, 300),
                          query
                        ),
                      }}
                    />
                  </div>
                )}

                {!document.content && (
                  <p className="text-gray-500 text-sm italic mb-3">
                    {t('search.contentUnavailable', 'Content not available yet')}
                  </p>
                )}

                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>{t('search.uploaded', 'Uploaded')}: {formatDate(document.uploaded_at)}</span>
                  {document.language && (
                    <span className="px-2 py-1 bg-gray-100 rounded">
                      {document.language.toUpperCase()}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
