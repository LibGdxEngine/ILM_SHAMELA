'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { useI18n } from '@/components/i18n/I18nProvider';
import SearchFacetControls from '@/components/search/SearchFacetControls';
import type { SelectedBook } from '@/components/search/SearchFacetControls';
import useDebounce from '@/hooks/useDebounce';
import {
  assistSearch,
  getSearchSuggestions,
  type AssistFilters,
  type CorpusSearchMode,
} from '@/lib/api';

/** Suggestions only appear once the query reaches this length (debounced). */
const MIN_SUGGEST_CHARS = 3;

/** Parchment/gold theming for the body-portaled dialog. Because the modal is
 *  rendered on `document.body` it does NOT inherit the `.reading-room` utility
 *  remaps, so we set the `--shell-*`/`--accent` contract explicitly here — the
 *  same variables `FacetTypeahead` and the mode toggle theme from. */
const PALETTE_VARS: CSSProperties = {
  ['--accent' as string]: '#b07d2b',
  ['--accent-2' as string]: '#c99a4e',
  ['--shell-surface' as string]: '#fcf8ee',
  ['--shell-line' as string]: '#e2d5ba',
  ['--shell-muted' as string]: '#8a7d68',
  ['--shell-ink' as string]: '#2c2620',
  ['--shell-on-accent' as string]: '#fcf8ee',
};

export interface SearchCommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Seeds the palette input from the header search box each time it opens. */
  initialQuery: string;
  mode: CorpusSearchMode;
  onModeChange: (mode: CorpusSearchMode) => void;
  selectedCategories: string[];
  onToggleCategory: (name: string) => void;
  selectedAuthors: string[];
  onToggleAuthor: (name: string) => void;
  selectedBooks: SelectedBook[];
  onToggleBook: (book: SelectedBook) => void;
  isAuthenticated: boolean;
  /** Apply AI-parsed filters (replace semantics — a fresh query defines the set). */
  onAssistApply: (filters: AssistFilters, interpretation: string | null) => void;
  /** Plain-search fallback when the AI is unavailable: set the query, keep facets. */
  onPlainSubmit: (q: string) => void;
}

/**
 * Centered, blurred-background command palette for the `/documents` library.
 *
 * - Fast ≥3-char debounced autocomplete over `/documents/suggest/`.
 * - Every submit routes the natural-language text through the search-engine AI
 *   (`assistSearch`), which returns structured filters that replace the current
 *   selection; on AI failure it falls back to a plain search.
 * - Carries the full control set (search-mode toggle + author/category/book
 *   facet typeaheads), mirroring the shared `NavSearchPopover`.
 *
 * Modeled on `SimilarWordsModal` (portal + backdrop-blur + Escape + mousedown
 * close). i18n: `dir={direction}` on the container, `dir="auto"` on the input,
 * `<bdi>` around suggestions so mixed Arabic/Latin renders correctly.
 */
export default function SearchCommandPalette({
  open,
  onOpenChange,
  initialQuery,
  mode,
  onModeChange,
  selectedCategories,
  onToggleCategory,
  selectedAuthors,
  onToggleAuthor,
  selectedBooks,
  onToggleBook,
  isAuthenticated,
  onAssistApply,
  onPlainSubmit,
}: SearchCommandPaletteProps) {
  const { t, direction, locale } = useI18n();

  const [draft, setDraft] = useState(initialQuery);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Always reflects the latest `open` prop so an in-flight assist request can
  // tell whether the user dismissed the palette before it resolved.
  const openRef = useRef(open);
  openRef.current = open;

  // Seed the draft from the header query and focus the input — only on the
  // closed→open transition, so a later `initialQuery` change (or re-render)
  // while the palette is open never clobbers the user's in-progress text.
  const prevOpenRef = useRef(false);
  useEffect(() => {
    const justOpened = open && !prevOpenRef.current;
    prevOpenRef.current = open;
    if (!justOpened) return;
    setDraft(initialQuery);
    setActiveIndex(-1);
    setPending(false);
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open, initialQuery]);

  // Escape closes the palette.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  const trimmed = draft.trim();
  const debounced = useDebounce(trimmed, 300);
  const canSuggest = open && !pending && debounced.length >= MIN_SUGGEST_CHARS;

  const { data: suggestData, isFetching: suggestFetching } = useQuery({
    queryKey: ['palette-suggest', debounced],
    queryFn: () => getSearchSuggestions(debounced),
    enabled: canSuggest,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const suggestions = canSuggest ? suggestData?.suggestions ?? [] : [];

  const acceptSuggestion = (value: string) => {
    setDraft(value);
    setActiveIndex(-1);
    inputRef.current?.focus();
  };

  const runAssist = async () => {
    const query = draft.trim();
    if (!query || pending) return;
    setPending(true);
    try {
      const res = await assistSearch(query, locale);
      // The user may have dismissed the palette while the request was in
      // flight — don't apply filters they never saw resolve.
      if (!openRef.current) return;
      if (res.degraded_reason) {
        // AI unavailable → plain search, preserving the user's existing facets.
        onPlainSubmit(query);
      } else {
        onAssistApply(res.filters, res.interpretation);
      }
      onOpenChange(false);
    } catch {
      if (!openRef.current) return;
      // Network/server error: never block the user — run a plain search.
      onPlainSubmit(query);
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  };

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && suggestions.length) {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp' && suggestions.length) {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < suggestions.length) {
        acceptSuggestion(suggestions[activeIndex]);
      } else {
        void runAssist();
      }
    }
  };

  if (!open || typeof document === 'undefined') return null;

  const modal = (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/45 p-4 backdrop-blur-md sm:p-6"
      onMouseDown={() => onOpenChange(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('docs.palette.title', 'البحث الذكي في المكتبة')}
        dir={direction}
        onMouseDown={(e) => e.stopPropagation()}
        style={PALETTE_VARS}
        className="animate-popover-in mt-[8vh] flex max-h-[82vh] w-full max-w-xl flex-col overflow-hidden rounded-[18px] border shadow-[0_28px_64px_-18px_rgba(44,38,32,0.45)]"
      >
        <div
          className="flex min-h-0 flex-col"
          style={{ background: 'var(--shell-surface)', borderColor: 'var(--shell-line)' }}
        >
          {/* ─── Search input ─── */}
          <div
            className={`flex items-center gap-3 border-b px-4 py-3.5 ${pending ? 'ai-halo' : ''}`}
            style={{ borderColor: 'var(--shell-line)' }}
          >
            {pending ? (
              <span
                className="h-[18px] w-[18px] shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
                style={{ color: 'var(--accent)' }}
                aria-hidden
              />
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--shell-muted)" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16.5" y2="16.5" />
              </svg>
            )}
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-expanded={suggestions.length > 0}
              aria-controls="palette-suggestions"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setActiveIndex(-1);
              }}
              onKeyDown={onInputKeyDown}
              disabled={pending}
              placeholder={t('docs.palette.placeholder', 'اكتب سؤالك بالعربية أو الإنجليزية…')}
              aria-label={t('docs.palette.title', 'البحث الذكي في المكتبة')}
              dir="auto"
              className="min-w-0 flex-1 bg-transparent text-[16px] outline-none disabled:opacity-60"
              style={{ color: 'var(--shell-ink)' }}
            />
            <kbd
              className="hidden shrink-0 rounded-[6px] border px-1.5 py-0.5 text-[10px] font-medium sm:block"
              style={{ borderColor: 'var(--shell-line)', color: 'var(--shell-muted)' }}
            >
              Esc
            </kbd>
          </div>

          {/* ─── Scrollable body ─── */}
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {pending ? (
              <p
                className="flex items-center justify-center gap-2 py-6 text-[13px]"
                style={{ color: 'var(--shell-muted)' }}
                role="status"
                aria-live="polite"
              >
                {t('docs.palette.interpreting', 'يفسّر الذكاء الاصطناعي طلبك…')}
              </p>
            ) : (
              <>
                {/* Autocomplete (≥3 chars) */}
                {canSuggest && (
                  <div className="mb-4">
                    {suggestions.length > 0 ? (
                      <ul id="palette-suggestions" role="listbox" className="flex flex-col gap-0.5">
                        {suggestions.map((s, i) => (
                          <li key={`${s}-${i}`} role="option" aria-selected={i === activeIndex}>
                            <button
                              type="button"
                              onMouseEnter={() => setActiveIndex(i)}
                              onClick={() => acceptSuggestion(s)}
                              className="flex w-full items-center gap-2.5 rounded-[9px] px-3 py-2 text-start text-[13.5px] transition-colors"
                              style={{
                                background: i === activeIndex ? 'var(--accent-soft, rgba(176,125,43,0.12))' : 'transparent',
                                color: 'var(--shell-ink)',
                              }}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--shell-muted)" strokeWidth="2" strokeLinecap="round" aria-hidden>
                                <circle cx="11" cy="11" r="7" />
                                <line x1="21" y1="21" x2="16.5" y2="16.5" />
                              </svg>
                              <bdi className="truncate">{s}</bdi>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      !suggestFetching && (
                        <p className="px-1 py-1 text-[12.5px]" style={{ color: 'var(--shell-muted)' }}>
                          {t('docs.palette.noSuggestions', 'لا اقتراحات — اضغط Enter للبحث')}
                        </p>
                      )
                    )}
                  </div>
                )}

                <p className="mb-4 text-[12px] leading-[1.6]" style={{ color: 'var(--shell-muted)' }}>
                  {t('docs.palette.aiHint', 'اضغط Enter ليحوّل الذكاء الاصطناعي كلامك إلى بحث وتصفية.')}
                </p>

                <SearchFacetControls
                  mode={mode}
                  onModeChange={onModeChange}
                  selectedCategories={selectedCategories}
                  onToggleCategory={onToggleCategory}
                  selectedAuthors={selectedAuthors}
                  onToggleAuthor={onToggleAuthor}
                  selectedBooks={selectedBooks}
                  onToggleBook={onToggleBook}
                  isAuthenticated={isAuthenticated}
                />
              </>
            )}
          </div>

          {/* ─── Footer submit ─── */}
          <div className="border-t px-4 py-3" style={{ borderColor: 'var(--shell-line)' }}>
            <button
              type="button"
              onClick={() => void runAssist()}
              disabled={pending || !trimmed}
              className="w-full rounded-[10px] py-2.5 text-[13.5px] font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: 'var(--accent)', color: 'var(--shell-on-accent)' }}
            >
              {pending
                ? t('docs.palette.interpreting', 'يفسّر الذكاء الاصطناعي طلبك…')
                : t('docs.palette.submit', 'ابحث بالذكاء الاصطناعي')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
