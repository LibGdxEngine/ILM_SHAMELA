'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DocumentSearchResponse } from '@/lib/api';
import { useI18n } from '@/components/i18n/I18nProvider';
import SearchResultsList from './SearchResultsList';

interface SearchToolPanelProps {
  query: string;
  isSearching: boolean;
  searchResults: DocumentSearchResponse | null;
  onQueryChange: (query: string) => void;
  onGoToPage: (page: number) => void;
}

export default function SearchToolPanel({
  query,
  isSearching,
  searchResults,
  onQueryChange,
  onGoToPage,
}: SearchToolPanelProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const matches = useMemo(() => searchResults?.matches ?? [], [searchResults]);

  // Reset the active index whenever the result set changes.
  useEffect(() => {
    setActiveIndex(0);
  }, [searchResults]);

  // Mirror the query to the URL via replaceState so navigation stack stays clean.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const current = url.searchParams.get('q') ?? '';
    const trimmed = query.trim();
    if (trimmed === current) return;
    if (trimmed) {
      url.searchParams.set('q', trimmed);
    } else {
      url.searchParams.delete('q');
    }
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, [query]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (matches.length === 0) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, matches.length - 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const target = matches[activeIndex];
        if (target) {
          onGoToPage(target.page_number);
        }
      } else if (event.key === 'Escape') {
        inputRef.current?.blur();
      }
    },
    [matches, activeIndex, onGoToPage]
  );

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('sidebar.searchPlaceholder', 'Search inside the document...')}
          className="w-full rounded-[12px] border border-border bg-white/[0.02] px-4 py-3 ps-10 text-[14px] font-fraunces text-text placeholder:text-text-3 transition-all focus:border-accent focus:bg-accent-soft focus:shadow-[0_0_0_4px_rgba(192,133,82,0.08)] focus:outline-none"
          autoFocus
        />
        <svg
          className="pointer-events-none absolute inset-inline-start-3 top-3.5 h-4 w-4 text-accent"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        {isSearching && (
          <div className="absolute inset-inline-end-3 top-3">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent-2 border-t-transparent" />
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {searchResults ? (
          <>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[11px] tracking-[0.18em] uppercase text-accent font-medium">
                {t('sidebar.results', 'Results')}
              </span>
              <span className="rounded-full border border-border-strong bg-white/[0.04] px-2.5 py-0.5 text-[11px] text-text-2">
                {t('sidebar.found', 'Found {count}', { count: searchResults.total_matches })}
              </span>
            </div>

            {matches.length === 0 ? (
              <div className="flex flex-1 items-center justify-center rounded-[16px] border border-dashed border-border-strong bg-white/[0.02] p-8 text-center">
                <div>
                  <p className="mb-1 font-fraunces text-[14px] text-text">
                    {t('sidebar.noMatches', 'No matches found')}
                  </p>
                  <p className="text-[12px] text-text-3">{t('sidebar.tryAnother', 'Try another keyword')}</p>
                </div>
              </div>
            ) : (
              <SearchResultsList
                results={matches}
                activeIndex={activeIndex}
                onActivate={(page) => onGoToPage(page)}
                onHover={(index) => setActiveIndex(index)}
              />
            )}
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center rounded-[16px] border border-dashed border-border-strong bg-white/[0.02] p-8 text-center">
            <p className="max-w-xs text-[13px] text-text-3 leading-relaxed">
              {t('reader.searchHint', 'Search by phrase or word to jump directly to matching pages.')}
            </p>
          </div>
        )}
      </div>

      <p className="text-[11px] text-text-3 tracking-wide" aria-hidden="true">
        {t('reader.searchKeyboardHint', '↑↓ to navigate · Enter to jump · Esc to close')}
      </p>
    </div>
  );
}
