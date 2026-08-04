'use client';

import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { useI18n } from '@/components/i18n/I18nProvider';
import useMediaQuery from '@/hooks/useMediaQuery';
import useDebounce from '@/hooks/useDebounce';
import { PARCHMENT_SHELL_VARS } from '@/components/search/console/consoleTheme';
import SearchConsole from '@/components/search/console/SearchConsole';
import SearchSectionsAccordion from '@/components/search/console/SearchSectionsAccordion';
import ActiveFiltersFooter from '@/components/search/console/ActiveFiltersFooter';
import PresetsPane from '@/components/search/console/PresetsPane';
import useSearchSections from '@/components/search/console/useSearchSections';
import {
  corpusFiltersToValues,
  countActiveFilters,
  type CorpusFilterHandlers,
  type CorpusFilterState,
} from '@/lib/search/useCorpusSearchState';
import type { SavedFilterPreset } from '@/lib/api/documentFilters';
import type { DocumentFilterValues } from '@/lib/documentsSearchParams';
import { trackEvent } from '@/lib/api/tracking';
import {
  assistSearch,
  getSearchSuggestions,
  type AssistFilters,
} from '@/lib/api';

/** Suggestions only appear once the query reaches this length (debounced). */
const MIN_SUGGEST_CHARS = 3;

/** Parchment/gold theming for the body-portaled dialog. Because the modal is
 *  rendered on `document.body` it does NOT inherit any shell's utility remaps,
 *  so we set the `--shell-*`/`--accent` contract explicitly — the same
 *  variables every console component themes from. */
const PALETTE_VARS = PARCHMENT_SHELL_VARS;

/** Preset wiring for surfaces that have it (signed-in). `onApply` is
 *  surface-specific: `/documents` mutates in place, other surfaces navigate. */
export interface PalettePresetsBundle {
  list: SavedFilterPreset[];
  onApply: (preset: SavedFilterPreset) => void;
  onSave: (name: string, values: DocumentFilterValues) => Promise<unknown>;
  onDelete: (id: number) => Promise<unknown> | void;
}

export interface SearchCommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Seeds the palette input from the header search box each time it opens. */
  initialQuery: string;
  /** The full corpus filter state + mutation handlers (fully controlled). */
  filters: CorpusFilterState;
  handlers: CorpusFilterHandlers;
  isAuthenticated: boolean;
  /** Show the "my uploads" scope choice (default true). */
  canUpload?: boolean;
  /** Apply AI-parsed filters (replace semantics — a fresh query defines the set). */
  onAssistApply: (filters: AssistFilters, interpretation: string | null) => void;
  /** Plain search: set the query, keep facets (also the AI-unavailable fallback). */
  onPlainSubmit: (q: string) => void;
  /** Omit to hide the presets section entirely. */
  presets?: PalettePresetsBundle;
  /** Which surface hosts this palette — stamped on telemetry events. */
  analyticsSurface?: string;
}

/**
 * The library's search "research console": a centered two-pane dialog
 * (section rail + browsable multi-select panes) on desktop, a full-screen
 * accordion takeover on mobile. The header input keeps the AI-assist flow —
 * ≥3-char debounced suggestions in an overlay dropdown, Enter routes the
 * natural-language text through `assistSearch` with a plain-search fallback —
 * while the sticky footer shows every active selection as a removable chip
 * next to save-preset and plain/AI submit actions.
 */
export default function SearchCommandPalette({
  open,
  onOpenChange,
  initialQuery,
  filters,
  handlers,
  isAuthenticated,
  canUpload = true,
  onAssistApply,
  onPlainSubmit,
  presets,
  analyticsSurface = 'palette',
}: SearchCommandPaletteProps) {
  const { t, direction, locale } = useI18n();
  const isDesktop = useMediaQuery('(min-width: 768px)', true);

  const [draft, setDraft] = useState(initialQuery);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [pending, setPending] = useState(false);
  // First Esc (or an accepted suggestion) hides the overlay until the draft
  // changes again; the second Esc then closes the palette.
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
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
    setSuggestionsDismissed(false);
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open, initialQuery]);

  // Escape closes the palette — but only when no inner popover consumed it.
  // Inner consumers (date picker, suggestions overlay, preset form, option
  // search) call preventDefault; their document-level listeners may run after
  // ours, so defer the check one tick to observe the final defaultPrevented.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      window.setTimeout(() => {
        if (!e.defaultPrevented) onOpenChange(false);
      }, 0);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  const trimmed = draft.trim();
  const debounced = useDebounce(trimmed, 300);
  const canSuggest =
    open && !pending && !suggestionsDismissed && debounced.length >= MIN_SUGGEST_CHARS;

  const { data: suggestData, isFetching: suggestFetching } = useQuery({
    queryKey: ['palette-suggest', debounced],
    queryFn: () => getSearchSuggestions(debounced),
    enabled: canSuggest,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const suggestions = canSuggest ? suggestData?.suggestions ?? [] : [];
  const suggestionsOpen = suggestions.length > 0;

  const acceptSuggestion = (value: string) => {
    setDraft(value);
    setActiveIndex(-1);
    setSuggestionsDismissed(true);
    inputRef.current?.focus();
  };

  const trackFilterApply = (ai: boolean) => {
    trackEvent('filter_apply', {
      metadata: {
        surface: analyticsSurface,
        ai,
        mode: filters.mode,
        scope: filters.scope,
        term_count: filters.terms.length,
        categories: filters.categories.length,
        authors: filters.authors.length,
        books: filters.books.length,
        languages: filters.languages.length,
        countries: filters.countries.length,
        death_centuries: filters.deathCenturies.length,
      },
    });
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
      trackFilterApply(true);
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

  const submitPlain = () => {
    onPlainSubmit(trimmed);
    trackFilterApply(false);
    onOpenChange(false);
  };

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && suggestions.length) {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp' && suggestions.length) {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Escape' && suggestionsOpen) {
      // First Esc dismisses the overlay; the deferred document handler sees
      // defaultPrevented and keeps the palette open.
      e.preventDefault();
      setSuggestionsDismissed(true);
      setActiveIndex(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < suggestions.length) {
        acceptSuggestion(suggestions[activeIndex]);
      } else {
        void runAssist();
      }
    }
  };

  // Simple focus trap: Tab cycles within the dialog (it is aria-modal).
  const onDialogKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const root = dialogRef.current;
    if (!root) return;
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const activeCount = countActiveFilters(filters);
  const canSaveCurrent = trimmed.length > 0 || activeCount > 0;

  const sections = useSearchSections({
    filters,
    handlers,
    isAuthenticated,
    canUpload,
    presetCount: presets ? presets.list.length : null,
  });

  if (!open || typeof document === 'undefined') return null;

  const presetsPane = presets ? (
    <PresetsPane
      presets={presets.list}
      onApply={(preset) => {
        presets.onApply(preset);
        trackEvent('preset_apply', {
          metadata: { surface: analyticsSurface, preset_id: preset.id },
        });
        onOpenChange(false);
      }}
      onDelete={presets.onDelete}
      onSave={(name) => presets.onSave(name, corpusFiltersToValues(filters, trimmed))}
      canSaveCurrent={canSaveCurrent}
    />
  ) : undefined;

  const signInHint = !isAuthenticated
    ? t('nav.search.signInHint', 'سجّل الدخول للتصفية حسب العلم أو المؤلف أو الكتاب.')
    : undefined;

  const header = (
    <div className="relative">
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
          aria-expanded={suggestionsOpen}
          aria-controls="palette-suggestions"
          aria-autocomplete="list"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setActiveIndex(-1);
            setSuggestionsDismissed(false);
          }}
          onKeyDown={onInputKeyDown}
          disabled={pending}
          placeholder={t('docs.palette.placeholder', 'اكتب سؤالك بالعربية أو الإنجليزية…')}
          aria-label={t('docs.palette.title', 'البحث الذكي في المكتبة')}
          dir="auto"
          className="min-w-0 flex-1 bg-transparent text-[16px] outline-none disabled:opacity-60"
          style={{ color: 'var(--shell-ink)' }}
        />
        {isDesktop ? (
          <kbd
            className="hidden shrink-0 rounded-[6px] border px-1.5 py-0.5 text-[10px] font-medium sm:block"
            style={{ borderColor: 'var(--shell-line)', color: 'var(--shell-muted)' }}
          >
            Esc
          </kbd>
        ) : (
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label={t('common.close', 'إغلاق')}
            className="shrink-0 rounded-md p-1"
            style={{ color: 'var(--shell-muted)' }}
          >
            <svg className="h-4.5 w-4.5" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Suggestions overlay — floats over the body, no reflow. */}
      {suggestionsOpen && (
        <div
          className="absolute inset-x-3 top-full z-10 mt-1 overflow-hidden rounded-[12px] border shadow-[0_18px_42px_-12px_rgba(44,38,32,0.28)]"
          style={{ background: 'var(--shell-surface)', borderColor: 'var(--shell-line)' }}
        >
          <ul id="palette-suggestions" role="listbox" className="max-h-56 overflow-y-auto py-1">
            {suggestions.map((s, i) => (
              <li key={`${s}-${i}`} role="option" aria-selected={i === activeIndex}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => acceptSuggestion(s)}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-start text-[13.5px] transition-colors"
                  style={{
                    background:
                      i === activeIndex
                        ? 'color-mix(in srgb, var(--accent, #b07d2b) 12%, transparent)'
                        : 'transparent',
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
          {suggestFetching && (
            <p className="border-t px-3 py-1.5 text-[11px]" style={{ borderColor: 'var(--shell-line)', color: 'var(--shell-muted)' }} aria-live="polite">
              {t('docs.categorySearch.loading', 'جارٍ البحث…')}
            </p>
          )}
        </div>
      )}
    </div>
  );

  const body = (
    <div className="relative flex min-h-0 flex-1 flex-col" aria-busy={pending}>
      {isDesktop ? (
        <SearchConsole sections={sections} presetsPane={presetsPane} signInHint={signInHint} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
          <SearchSectionsAccordion
            sections={sections}
            presetsPane={presetsPane}
            signInHint={signInHint}
          />
        </div>
      )}
      {pending && (
        <div
          className="absolute inset-0 z-10 cursor-wait"
          style={{ background: 'color-mix(in srgb, var(--shell-surface, #fcf8ee) 55%, transparent)' }}
          aria-hidden
        />
      )}
    </div>
  );

  const footer = (
    <ActiveFiltersFooter
      filters={filters}
      handlers={handlers}
      onSavePreset={
        presets
          ? (name) => presets.onSave(name, corpusFiltersToValues(filters, trimmed))
          : undefined
      }
      canSaveCurrent={canSaveCurrent}
      onPlainSubmit={submitPlain}
      plainDisabled={pending || (!trimmed && activeCount === 0)}
      onAiSubmit={() => void runAssist()}
      aiDisabled={pending || !trimmed}
      aiPending={pending}
    />
  );

  const modal = (
    <div
      className="fixed inset-0 z-[80] flex items-stretch justify-center overflow-y-auto bg-black/45 backdrop-blur-md md:items-start md:p-6"
      onMouseDown={() => onOpenChange(false)}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('docs.palette.title', 'البحث الذكي في المكتبة')}
        dir={direction}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onDialogKeyDown}
        style={{
          ...PALETTE_VARS,
          background: 'var(--shell-surface)',
          borderColor: 'var(--shell-line)',
        }}
        className="flex h-full w-full flex-col overflow-hidden border-0 md:mt-[6vh] md:h-auto md:max-h-[82vh] md:min-h-[420px] md:w-full md:max-w-[860px] md:animate-popover-in md:rounded-[18px] md:border md:shadow-[0_28px_64px_-18px_rgba(44,38,32,0.45)]"
      >
        {header}
        {body}
        {footer}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
