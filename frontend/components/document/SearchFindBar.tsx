'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DocumentSearchResponse } from '@/lib/api';
import { useI18n } from '@/components/i18n/I18nProvider';
import SearchResultsList from './SearchResultsList';

interface SearchFindBarProps {
  query: string;
  isSearching: boolean;
  searchResults: DocumentSearchResponse | null;
  onQueryChange: (query: string) => void;
  onGoToPage: (page: number) => void;
  onClose: () => void;
}

/**
 * Floating "find bar" for in-document search — a slim browser/VS Code-style bar
 * anchored to the top-end of the reading area. It keeps almost the full width
 * free for reading; the input, match position, prev/next steppers, a results
 * toggle and a close button all live on one row. The full result list is
 * collapsed by default and expands below the bar on demand.
 *
 * Stepping (↑/↓, the steppers, Enter) jumps the page to each match while the
 * bar stays open — the find-next loop. Escape and the ✕ button close it.
 */
export default function SearchFindBar({
  query,
  isSearching,
  searchResults,
  onQueryChange,
  onGoToPage,
  onClose,
}: SearchFindBarProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [showList, setShowList] = useState(false);

  const matches = useMemo(() => searchResults?.matches ?? [], [searchResults]);
  const hasMatches = matches.length > 0;

  // Reset the active match whenever a new result set arrives.
  useEffect(() => {
    setActiveIndex(0);
  }, [searchResults]);

  // Mirror the query to the URL via replaceState so deep-links (?q=) work and
  // the navigation stack stays clean.
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

  // Window-level shortcuts: Escape closes from anywhere; Ctrl/Cmd+F refocuses
  // and selects the field (matching native find ergonomics) instead of opening
  // the browser's own find.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && (event.key === 'f' || event.key === 'F')) {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Move the active match and jump the page to it, keeping the bar open so the
  // reader can walk results (the find-next loop). Clamps at the ends.
  const goToIndex = useCallback(
    (index: number) => {
      if (matches.length === 0) return;
      const count = matches.length;
      const next = Math.max(0, Math.min(index, count - 1));
      setActiveIndex(next);
      const target = matches[next];
      if (target) {
        onGoToPage(target.page_number);
      }
    },
    [matches, onGoToPage]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (matches.length === 0) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        goToIndex(activeIndex + 1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        goToIndex(activeIndex - 1);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        goToIndex(activeIndex);
      }
    },
    [matches, activeIndex, goToIndex, onClose]
  );

  const stepperClass =
    'inline-flex h-7 w-7 items-center justify-center rounded-md text-text-2 transition-colors hover:bg-accent-soft hover:text-accent disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-text-2';

  return (
    <div
      role="search"
      aria-label={t('reader.searchInBook', 'Search this book')}
      className="fixed inset-inline-end-3 top-[68px] z-[45] w-[min(92vw,440px)]"
    >
      {/* The bar */}
      <div className="flex items-center gap-1 rounded-[14px] border border-border-strong bg-card/95 px-2 py-1.5 shadow-[0_18px_42px_-12px_rgba(0,0,0,0.55)] backdrop-blur-xl">
        <svg
          className="pointer-events-none ms-1 h-4 w-4 flex-shrink-0 text-accent"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('sidebar.searchPlaceholder', 'Search inside the document...')}
          className="min-w-0 flex-1 bg-transparent px-1.5 py-1 text-[14px] font-fraunces text-text placeholder:text-text-3 focus:outline-none"
          autoFocus
        />

        {/* Position readout / spinner */}
        {isSearching ? (
          <div className="me-1 h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-accent-2 border-t-transparent" />
        ) : hasMatches ? (
          <span className="me-1 flex-shrink-0 text-[11.5px] tabular-nums text-text-2" aria-live="polite">
            {t('reader.matchPosition', '{current} / {total}', {
              current: activeIndex + 1,
              total: matches.length,
            })}
          </span>
        ) : query.trim() && searchResults ? (
          <span className="me-1 flex-shrink-0 text-[11.5px] text-text-3">
            {t('sidebar.noMatches', 'No matches found')}
          </span>
        ) : null}

        <div className="flex flex-shrink-0 items-center">
          <button
            type="button"
            onClick={() => goToIndex(activeIndex - 1)}
            disabled={!hasMatches}
            aria-label={t('reader.prevMatch', 'Previous match')}
            className={stepperClass}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => goToIndex(activeIndex + 1)}
            disabled={!hasMatches}
            aria-label={t('reader.nextMatch', 'Next match')}
            className={stepperClass}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          <span className="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />

          <button
            type="button"
            onClick={() => setShowList((value) => !value)}
            disabled={!searchResults}
            aria-label={t('reader.toggleResults', 'Show all results')}
            aria-expanded={showList}
            aria-pressed={showList}
            className={`${stepperClass} ${showList ? 'bg-accent-soft text-accent' : ''}`}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('reader.closePanel', 'Close panel')}
            className={stepperClass}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Expandable results list */}
      {showList && (
        <div className="mt-1.5 flex max-h-[55vh] flex-col rounded-[14px] border border-border-strong bg-card/95 p-2.5 shadow-[0_18px_42px_-12px_rgba(0,0,0,0.55)] backdrop-blur-xl">
          {searchResults && hasMatches ? (
            <>
              <div className="mb-2 px-0.5 text-[11px] tracking-[0.18em] uppercase text-accent font-medium">
                {t('sidebar.found', 'Found {count}', { count: searchResults.total_matches })}
              </div>
              <SearchResultsList
                results={matches}
                activeIndex={activeIndex}
                onActivate={(page, index) => {
                  setActiveIndex(index);
                  onGoToPage(page);
                }}
                onHover={(index) => setActiveIndex(index)}
              />
            </>
          ) : (
            <p className="px-2 py-6 text-center text-[13px] text-text-3 leading-relaxed">
              {query.trim()
                ? t('sidebar.tryAnother', 'Try another keyword')
                : t('reader.searchHint', 'Search by phrase or word to jump directly to matching pages.')}
            </p>
          )}
        </div>
      )}

      <p className="mt-1.5 px-1 text-[11px] text-text-3 tracking-wide" aria-hidden="true">
        {t('reader.searchKeyboardHint', '↑↓ to navigate · Enter to jump · Esc to close')}
      </p>
    </div>
  );
}
