'use client';

import { useId, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { useI18n } from '@/components/i18n/I18nProvider';
import { toLocaleDigits } from '@/lib/utils';
import useOptionSearch from './useOptionSearch';
import type { OptionItem, OptionsSectionSpec } from './types';

/** Row glyph: outlined square, filled with a check when selected. */
function CheckGlyph({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className="grid h-[16px] w-[16px] shrink-0 place-items-center rounded-[5px] border transition-colors"
      style={{
        borderColor: on ? 'var(--accent, #b07d2b)' : 'var(--shell-line, #e2d5ba)',
        background: on ? 'var(--accent, #b07d2b)' : 'transparent',
        color: 'var(--shell-on-accent, #fcf8ee)',
      }}
    >
      {on && (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </span>
  );
}

/**
 * The browsable multi-select body of an `options` filter section, shared by
 * the console's main pane and the accordion. A search-to-narrow input on top
 * (server-backed for `search` sources, client filtering for `static` ones),
 * then an always-open `listbox` with the current selections pinned first —
 * selections render even when absent from the current result page, so they
 * can always be removed. Focus stays in the input; ArrowUp/Down move
 * `aria-activedescendant`, Enter toggles (the `FacetTypeahead` idiom, adapted
 * from dropdown to inline list).
 */
export default function OptionListPane({ section }: { section: OptionsSectionSpec }) {
  const { t, locale } = useI18n();
  const listboxId = useId();
  const [activeIndex, setActiveIndex] = useState(-1);

  const source = section.source;
  const isSearch = source.type === 'search';
  const serverSearch = useOptionSearch(
    source.type === 'search' ? source.cacheKey : 'static-noop',
    source.type === 'search' ? source.fetchOptions : async () => ({ count: 0, options: [] }),
    isSearch,
  );
  const [staticQuery, setStaticQuery] = useState('');

  const query = isSearch ? serverSearch.query : staticQuery;
  const setQuery = isSearch ? serverSearch.setQuery : setStaticQuery;

  const unselected = useMemo<OptionItem[]>(() => {
    const selectedIds = new Set(section.selected.map((s) => String(s.id)));
    if (section.source.type === 'search') {
      return serverSearch.options.filter((o) => !selectedIds.has(String(o.id)));
    }
    const q = staticQuery.trim().toLocaleLowerCase(locale);
    return section.source.options.filter(
      (o) =>
        !selectedIds.has(String(o.id)) &&
        (!q || o.label.toLocaleLowerCase(locale).includes(q)),
    );
  }, [section.selected, section.source, serverSearch.options, staticQuery, locale]);

  // Selections pinned on top, then the browsable/unselected rows.
  const rows = useMemo<{ item: OptionItem; on: boolean }[]>(
    () => [
      ...section.selected.map((item) => ({ item, on: true })),
      ...unselected.map((item) => ({ item, on: false })),
    ],
    [section.selected, unselected],
  );

  const isFetching = isSearch && serverSearch.isFetching;
  const showEmpty = !isFetching && rows.length === 0;
  const hasMore = isSearch && serverSearch.hasMore;

  const toggleRow = (row: { item: OptionItem }) => {
    section.onToggle(row.item);
    setActiveIndex(-1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && rows.length) {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp' && rows.length) {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      const row = rows[activeIndex];
      if (row) {
        e.preventDefault();
        toggleRow(row);
      }
    } else if (e.key === 'Escape' && query) {
      // First Esc clears the narrow query; claim it so the dialog stays open.
      e.preventDefault();
      setQuery('');
      setActiveIndex(-1);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5">
      {section.degraded && (
        <p
          className="rounded-[9px] border px-3 py-2 text-[11.5px] leading-[1.6]"
          style={{ borderColor: 'var(--shell-line, #e2d5ba)', color: 'var(--shell-muted, #9a8b70)' }}
        >
          {t('console.optionsLoadError', 'تعذّر تحميل الخيارات — يمكنك إزالة المحدد منها فقط.')}
        </p>
      )}

      <div className="relative">
        <svg
          className="pointer-events-none absolute top-1/2 start-2.5 h-3.5 w-3.5 -translate-y-1/2"
          style={{ color: 'var(--shell-muted, #9a8b70)' }}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          type="text"
          role="combobox"
          aria-expanded={rows.length > 0}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            activeIndex >= 0 && rows[activeIndex] ? `${listboxId}-opt-${activeIndex}` : undefined
          }
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(-1);
          }}
          onKeyDown={onKeyDown}
          placeholder={section.labels.placeholder}
          aria-label={section.labels.placeholder}
          dir="auto"
          className="w-full rounded-[10px] border py-2 pe-3 ps-8 font-fraunces text-[12.5px] outline-none transition-all"
          style={{
            background: 'var(--shell-surface, #fcf8ee)',
            color: 'var(--shell-ink, #2c2620)',
            borderColor: 'var(--shell-line, #e2d5ba)',
          }}
        />
      </div>

      <ul
        id={listboxId}
        role="listbox"
        aria-multiselectable="true"
        aria-label={section.label}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {rows.map((row, i) => (
          <li key={`${row.on ? 'on' : 'off'}-${row.item.id}`} role="presentation">
            <button
              type="button"
              id={`${listboxId}-opt-${i}`}
              role="option"
              aria-selected={row.on}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => toggleRow(row)}
              className="flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-[7px] text-start text-[13px] transition-colors"
              style={{
                background:
                  i === activeIndex
                    ? 'color-mix(in srgb, var(--accent, #b07d2b) 10%, transparent)'
                    : 'transparent',
                color: row.on ? 'var(--shell-ink, #2c2620)' : 'var(--shell-ink-2, #6e6354)',
              }}
            >
              <CheckGlyph on={row.on} />
              <bdi className="min-w-0 flex-1 truncate">{row.item.label}</bdi>
              {typeof row.item.count === 'number' && (
                <span
                  className="shrink-0 text-[11px] tabular-nums"
                  style={{ color: 'var(--shell-muted, #9a8b70)' }}
                >
                  {toLocaleDigits(row.item.count, locale)}
                </span>
              )}
            </button>
          </li>
        ))}

        {isFetching && rows.length === 0 && (
          <li
            className="px-2.5 py-2 text-[12px]"
            style={{ color: 'var(--shell-muted, #9a8b70)' }}
            aria-live="polite"
          >
            {t('docs.categorySearch.loading', 'جارٍ البحث…')}
          </li>
        )}
        {showEmpty && (
          <li className="px-2.5 py-2 text-[12px]" style={{ color: 'var(--shell-muted, #9a8b70)' }}>
            {section.labels.empty}
          </li>
        )}
      </ul>

      {hasMore && (
        <p
          className="border-t pt-2 text-[11px]"
          style={{ borderColor: 'var(--shell-line, #e7dbc1)', color: 'var(--shell-muted, #9a8b70)' }}
        >
          {section.labels.more}
        </p>
      )}
    </div>
  );
}
