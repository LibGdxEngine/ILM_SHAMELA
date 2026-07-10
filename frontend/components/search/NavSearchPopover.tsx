'use client';

import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { useI18n } from '@/components/i18n/I18nProvider';
import ReaderPanel from '@/components/document/ReaderPanel';
import SearchFacetControls from '@/components/search/SearchFacetControls';
import type { SelectedBook } from '@/components/search/SearchFacetControls';
import type { CorpusSearchMode } from '@/lib/api';
import useMediaQuery from '@/hooks/useMediaQuery';

// `SelectedBook` now lives with the shared facet controls; re-export it so
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
  mode: CorpusSearchMode;
  onModeChange: (mode: CorpusSearchMode) => void;
  selectedCategories: string[];
  onToggleCategory: (name: string) => void;
  selectedAuthors: string[];
  onToggleAuthor: (name: string) => void;
  selectedBooks: SelectedBook[];
  onToggleBook: (book: SelectedBook) => void;
  isAuthenticated: boolean;
}

/**
 * The shared navbar search-filter popup. Fully controlled: query, mode and the
 * three selection sets are owned by the caller. It themes itself entirely from
 * the ambient shell CSS variables (`--accent`, `--shell-surface`, `--shell-line`,
 * `--shell-muted`, `--shell-ink`, `--shell-on-accent`) — with gold/parchment
 * fallbacks — so it renders correctly on the gold Reading Room / landing / auth
 * shells, the blue Atlas shell, and inside the reader room (which does not define
 * the full `--shell-*` set).
 *
 * Presentation:
 *  - anchored dropdown on desktop (`'auto'`), mirroring `DatePickerField`'s
 *    outside-click + Escape idiom (no new dependency);
 *  - `ReaderPanel` slide-over on mobile, and always when `presentation='panel'`.
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
  mode,
  onModeChange,
  selectedCategories,
  onToggleCategory,
  selectedAuthors,
  onToggleAuthor,
  selectedBooks,
  onToggleBook,
  isAuthenticated,
}: NavSearchPopoverProps) {
  const { t, direction } = useI18n();
  const isDesktop = useMediaQuery('(min-width: 768px)', true);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [queryFocused, setQueryFocused] = useState(false);

  const usePanel = presentation === 'panel' || !isDesktop;

  // Outside-click + Escape close for the anchored dropdown (ReaderPanel handles
  // its own dismissal in the panel branch). Mirrors DatePickerField.
  useEffect(() => {
    if (usePanel || !open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return; // trigger toggles itself
      onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onOpenChange(false);
        anchorRef.current?.focus?.();
      }
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
    onOpenChange(false);
  };

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
        {inner}
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
      className="absolute top-full z-40 mt-2 start-0 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-[14px] border shadow-[0_18px_42px_-12px_rgba(44,38,32,0.28)]"
      style={{
        background: 'var(--shell-surface, #fcf8ee)',
        borderColor: 'var(--shell-line, #e2d5ba)',
      }}
    >
      <div className="max-h-[min(70vh,34rem)] overflow-y-auto p-4">{inner}</div>
    </div>
  );
}
