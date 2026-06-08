'use client';

import { useId, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import useDebounce from '@/hooks/useDebounce';
import { FACET_INPUT_CLASS, FilterSection, PILL_ON } from './filterTokens';

interface FacetItem {
  id: number;
  name: string;
}

interface FacetSearchResponse {
  count: number;
  results: FacetItem[];
}

interface FacetTypeaheadProps {
  /** React Query cache-key prefix, e.g. 'authors' | 'categories'. */
  cacheKey: string;
  /** Server search; an empty string returns the first page (initial suggestions). */
  fetchItems: (search: string) => Promise<FacetSearchResponse>;
  /** Currently selected names. */
  selected: string[];
  /** Add or remove a name from the selection. */
  onToggle: (name: string) => void;
  labels: {
    heading: string;
    placeholder: string;
    loading: string;
    empty: string;
    more: string;
    remove: string;
  };
}

/**
 * Server-backed facet picker. Typing queries the given `fetchItems` endpoint
 * (debounced) and shows live matches from the whole database — not just values
 * present on the loaded documents. Selection is by *name* so it stays compatible
 * with the documents filter, the URL (`?<facet>=…`) and the page's active chips.
 *
 * Used for both authors and categories — see `FilterSidebar`.
 */
export default function FacetTypeahead({
  cacheKey,
  fetchItems,
  selected,
  onToggle,
  labels,
}: FacetTypeaheadProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listboxId = useId();

  const debounced = useDebounce(query.trim(), 300);
  const { data, isFetching } = useQuery<FacetSearchResponse, Error>({
    queryKey: [cacheKey, 'search', debounced],
    queryFn: () => fetchItems(debounced),
    placeholderData: keepPreviousData, // no flicker between keystrokes
    staleTime: 60_000,
    enabled: open, // only fetch while the dropdown is focused/open
  });

  const results = data?.results ?? [];
  const count = data?.count ?? 0;
  // Hide already-selected values from the suggestion list.
  const suggestions = results.filter((item) => !selected.includes(item.name));
  const hasMore = count > results.length;

  const select = (name: string) => {
    onToggle(name);
    setQuery('');
    setActiveIndex(0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      const choice = suggestions[activeIndex];
      if (choice) {
        e.preventDefault();
        select(choice.name);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const showEmpty = open && !isFetching && debounced !== '' && suggestions.length === 0;
  const showDropdown = open && (isFetching || suggestions.length > 0 || showEmpty);

  return (
    <FilterSection heading={labels.heading}>
      {/* Selected values — always visible so they can be removed here too. */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2.5">
          {selected.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => onToggle(name)}
              className={`${PILL_ON} group`}
              title={labels.remove}
            >
              <span dir="auto">{name}</span>
              <svg className="w-3 h-3 opacity-70 group-hover:opacity-100" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          ))}
        </div>
      )}

      <div className="relative">
        <svg
          className="absolute top-1/2 -translate-y-1/2 start-2.5 w-3.5 h-3.5 text-text-3 pointer-events-none z-10"
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
          aria-expanded={showDropdown}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            showDropdown && suggestions[activeIndex] ? `${listboxId}-opt-${activeIndex}` : undefined
          }
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
            setOpen(true);
          }}
          onFocus={() => {
            if (blurTimer.current) clearTimeout(blurTimer.current);
            setOpen(true);
          }}
          onBlur={() => {
            // Delay so a click on an option registers before the list closes.
            blurTimer.current = setTimeout(() => setOpen(false), 120);
          }}
          onKeyDown={handleKeyDown}
          placeholder={labels.placeholder}
          dir="auto"
          aria-label={labels.placeholder}
          className={FACET_INPUT_CLASS}
        />

        {showDropdown && (
          <ul
            id={listboxId}
            role="listbox"
            className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto rounded-[10px] border border-border-strong bg-card shadow-[0_12px_30px_-12px_rgba(0,0,0,0.45)] py-1"
          >
            {isFetching && suggestions.length === 0 && (
              <li className="px-3 py-2 text-[12px] text-text-3" aria-live="polite">
                {labels.loading}
              </li>
            )}

            {showEmpty && (
              <li className="px-3 py-2 text-[12px] text-text-3">{labels.empty}</li>
            )}

            {suggestions.map((item, i) => (
              <li key={item.id} role="presentation">
                <button
                  type="button"
                  id={`${listboxId}-opt-${i}`}
                  role="option"
                  aria-selected={i === activeIndex}
                  // Prevent the input's blur from firing before this click.
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => select(item.name)}
                  className={`w-full text-start px-3 py-2 text-[12.5px] transition-colors ${
                    i === activeIndex ? 'bg-accent-soft text-accent-2' : 'text-text-2 hover:bg-accent-soft/40'
                  }`}
                >
                  <span dir="auto">{item.name}</span>
                </button>
              </li>
            ))}

            {hasMore && suggestions.length > 0 && (
              <li className="px-3 pt-1.5 pb-1 text-[11px] text-text-3 border-t border-border">
                {labels.more}
              </li>
            )}
          </ul>
        )}
      </div>
    </FilterSection>
  );
}
