'use client';

import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { useI18n } from '@/components/i18n/I18nProvider';
import ReaderPanel from '@/components/document/ReaderPanel';
import SearchSectionsAccordion from '@/components/search/console/SearchSectionsAccordion';
import ActiveFilterChips from '@/components/search/console/ActiveFilterChips';
import PresetsPane from '@/components/search/console/PresetsPane';
import useSearchSections from '@/components/search/console/useSearchSections';
import { PARCHMENT_SHELL_VARS } from '@/components/search/console/consoleTheme';
import type { SelectedBook } from '@/components/search/console/types';
import type { PalettePresetsBundle } from '@/components/documents/SearchCommandPalette';
import {
  corpusFiltersToValues,
  countActiveFilters,
  type CorpusFilterHandlers,
  type CorpusFilterState,
} from '@/lib/search/useCorpusSearchState';
import useMediaQuery from '@/hooks/useMediaQuery';
import { trackEvent } from '@/lib/api/tracking';

// `SelectedBook`'s canonical home is the console types module; re-export so
// existing importers of this module keep working.
export type { SelectedBook };

export interface NavSearchPopoverProps {
  /** Controlled open state. */
  open: boolean;
  /** Request an open-state change (close on outside-click / Escape / submit). */
  onOpenChange: (open: boolean) => void;
  /** The trigger element — excluded from outside-click-close so it can toggle. */
  anchorRef: RefObject<HTMLElement | null>;
  /**
   * `'auto'` (default): anchored dropdown ≥768px, `ReaderPanel` sheet below.
   * `'panel'`: always a `ReaderPanel` (used by the reader, whose shell clips
   * absolutely-positioned dropdowns).
   */
  presentation?: 'auto' | 'panel';
  /** Show the free-text query input. Pass `false` when the page's own search box already sits above. */
  showQueryField?: boolean;
  queryValue: string;
  onQueryChange: (value: string) => void;
  /** Fired by the submit button and Enter; the popover then closes itself. */
  onSubmit: () => void;
  /** The full corpus filter state + mutation handlers (fully controlled). */
  filters: CorpusFilterState;
  handlers: CorpusFilterHandlers;
  isAuthenticated: boolean;
  /** Show the "my uploads" scope choice (default true). */
  canUpload?: boolean;
  /** Preset wiring (apply navigates on these surfaces); omit to hide. */
  presets?: PalettePresetsBundle;
  /** Which surface hosts this popover — stamped on telemetry events. */
  analyticsSurface?: string;
}

/**
 * The shared navbar search-filter popup, presenting the same filter-section
 * model as the `/documents` research console in a compact single column:
 * collapsible sections with selected-count badges, browsable multi-select
 * option lists, saved presets, and the active selections as removable chips
 * above the submit button.
 *
 * Presentation:
 *  - anchored dropdown on desktop (`'auto'`), mirroring `DatePickerField`'s
 *    outside-click + Escape idiom (no new dependency);
 *  - `ReaderPanel` slide-over on mobile, and always when `presentation='panel'`
 *    (the accordion gets an explicit parchment surface there — ReaderPanel
 *    itself styles from the dark app tokens).
 */
export default function NavSearchPopover({
  open,
  onOpenChange,
  anchorRef,
  presentation = 'auto',
  showQueryField = true,
  queryValue,
  onQueryChange,
  onSubmit,
  filters,
  handlers,
  isAuthenticated,
  canUpload = true,
  presets,
  analyticsSurface = 'nav-popover',
}: NavSearchPopoverProps) {
  const { t, direction } = useI18n();
  const isDesktop = useMediaQuery('(min-width: 768px)', true);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [queryFocused, setQueryFocused] = useState(false);

  const usePanel = presentation === 'panel' || !isDesktop;

  // Outside-click + Escape close for the anchored dropdown (ReaderPanel handles
  // its own dismissal in the panel branch). Mirrors DatePickerField, with the
  // console's deferred defaultPrevented check so inner popovers claim Esc first.
  useEffect(() => {
    if (usePanel || !open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return; // trigger toggles itself
      onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      window.setTimeout(() => {
        if (e.defaultPrevented) return;
        onOpenChange(false);
        anchorRef.current?.focus?.();
      }, 0);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [usePanel, open, onOpenChange, anchorRef]);

  const handleSubmit = () => {
    onSubmit();
    trackEvent('filter_apply', {
      metadata: {
        surface: analyticsSurface,
        ai: false,
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
    onOpenChange(false);
  };

  const sections = useSearchSections({
    filters,
    handlers,
    isAuthenticated,
    canUpload,
    presetCount: presets ? presets.list.length : null,
  });

  const canSaveCurrent = queryValue.trim().length > 0 || countActiveFilters(filters) > 0;

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
      onSave={(name) => presets.onSave(name, corpusFiltersToValues(filters, queryValue.trim()))}
      canSaveCurrent={canSaveCurrent}
    />
  ) : undefined;

  // NOTE: no explicit vars here — the anchored dropdown inherits whichever
  // shell hosts it (gold reading-room, blue atlas, …); only the ReaderPanel
  // branch stamps the parchment contract because it sits on dark app tokens.
  const inner = (
    <div className="flex flex-col gap-4" dir={direction}>
      {showQueryField && (
        <input
          type="text"
          value={queryValue}
          onChange={(e) => onQueryChange(e.target.value)}
          onFocus={() => setQueryFocused(true)}
          onBlur={() => setQueryFocused(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder={t('nav.search.placeholder', 'ابحث في الكتب والمؤلفين والموضوعات…')}
          aria-label={t('nav.search.openLabel', 'ابحث في المكتبة')}
          dir="auto"
          className="w-full rounded-[10px] px-3.5 py-2.5 text-[13.5px] font-fraunces transition-all"
          style={{
            background: 'var(--shell-surface, #fcf8ee)',
            color: 'var(--shell-ink, #2c2620)',
            border: `1px solid ${queryFocused ? 'var(--accent, #b07d2b)' : 'var(--shell-line, #e2d5ba)'}`,
            boxShadow: queryFocused
              ? '0 0 0 4px color-mix(in srgb, var(--accent, #b07d2b) 12%, transparent)'
              : 'none',
            outline: 'none',
          }}
        />
      )}

      <SearchSectionsAccordion
        sections={sections}
        presetsPane={presetsPane}
        signInHint={
          !isAuthenticated
            ? t('nav.search.signInHint', 'سجّل الدخول للتصفية حسب العلم أو المؤلف أو الكتاب.')
            : undefined
        }
        defaultOpenKey="mode"
      />

      <ActiveFilterChips filters={filters} handlers={handlers} />

      {isAuthenticated && (
        <button
          type="button"
          onClick={handleSubmit}
          className="w-full rounded-[10px] py-2.5 text-[13px] font-semibold transition-all"
          style={{ background: 'var(--accent, #b07d2b)', color: 'var(--shell-on-accent, #fcf8ee)' }}
        >
          {t('nav.search.submit', 'بحث')}
        </button>
      )}
    </div>
  );

  if (usePanel) {
    return (
      <ReaderPanel isOpen={open} onClose={() => onOpenChange(false)} title={t('nav.search.title', 'البحث والتصفية')}>
        {/* Explicit parchment card — ReaderPanel's own surface uses the dark
            app tokens, which would swallow the parchment-themed controls. */}
        <div
          className="rounded-[12px] p-3"
          style={{ background: 'var(--shell-surface, #fcf8ee)', ...PARCHMENT_SHELL_VARS }}
        >
          {inner}
        </div>
      </ReaderPanel>
    );
  }

  if (!open) return null;

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={t('nav.search.title', 'البحث والتصفية')}
      dir={direction}
      className="absolute top-full z-40 mt-2 start-0 w-[26rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-[14px] border shadow-[0_18px_42px_-12px_rgba(44,38,32,0.28)]"
      style={{
        background: 'var(--shell-surface, #fcf8ee)',
        borderColor: 'var(--shell-line, #e2d5ba)',
      }}
    >
      <div className="max-h-[min(70vh,34rem)] overflow-y-auto p-4">{inner}</div>
    </div>
  );
}
