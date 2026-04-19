'use client';

import { useEffect, useRef } from 'react';
import type { DocumentSearchMatch } from '@/lib/api';
import { useI18n } from '@/components/i18n/I18nProvider';

interface SearchResultsListProps {
  results: DocumentSearchMatch[];
  activeIndex: number;
  onActivate: (page: number, index: number) => void;
  onHover?: (index: number) => void;
}

export default function SearchResultsList({
  results,
  activeIndex,
  onActivate,
  onHover,
}: SearchResultsListProps) {
  const { t } = useI18n();
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Keep the active item visible when keyboard nav moves the index.
  useEffect(() => {
    const node = itemRefs.current[activeIndex];
    // scrollIntoView is not implemented in jsdom; guard so unit tests don't
    // have to polyfill it.
    if (node && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  return (
    <div className="min-h-0 space-y-3 overflow-y-auto pe-1" role="listbox" aria-label="Search results">
      {results.map((match, index) => {
        const isActive = index === activeIndex;
        return (
          <button
            key={`${match.page_number}-${index}`}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            type="button"
            role="option"
            aria-selected={isActive}
            onClick={() => onActivate(match.page_number, index)}
            onMouseEnter={() => onHover?.(index)}
            className={`w-full rounded-xl border p-3 text-start transition-all ${
              isActive
                ? 'border-teal-400 bg-teal-50 ring-2 ring-teal-400'
                : 'border-gray-200 bg-white hover:border-teal-300 hover:bg-teal-50/40'
            }`}
          >
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs font-semibold text-teal-800">
                {t('reader.pageLabel', 'Page {page}', { page: match.page_number })}
              </span>
              {match.score_semantic != null && (
                <span
                  className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700"
                  title="Semantic relevance"
                >
                  ✦ {Math.round(match.score_semantic * 100)}%
                </span>
              )}
              {match.score_final != null && match.score_semantic != null && (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">
                  {Math.round(match.score_final * 100)}
                </span>
              )}
            </div>
            <p
              className="line-clamp-3 text-sm leading-6 text-gray-700"
              dangerouslySetInnerHTML={{ __html: match.snippet }}
            />
          </button>
        );
      })}
    </div>
  );
}
