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
            className={`w-full rounded-[14px] border p-3 text-start transition-all ${
              isActive
                ? 'border-accent bg-accent-soft shadow-[0_0_0_3px_rgba(192,133,82,0.18)]'
                : 'border-border bg-white/[0.02] hover:border-accent/50 hover:bg-accent-soft/40'
            }`}
          >
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <span className="rounded-full border border-accent/30 bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent-2">
                {t('reader.pageLabel', 'Page {page}', { page: match.page_number })}
              </span>
              {match.score_semantic != null && (
                <span
                  className="rounded-full border border-border-strong bg-white/[0.04] px-2 py-0.5 text-[11px] text-text-2"
                  title="Semantic relevance"
                >
                  <span className="text-accent" aria-hidden>✦</span> {Math.round(match.score_semantic * 100)}%
                </span>
              )}
              {match.score_final != null && match.score_semantic != null && (
                <span className="rounded-full border border-border bg-white/[0.03] px-2 py-0.5 text-[11px] text-text-3">
                  {Math.round(match.score_final * 100)}
                </span>
              )}
            </div>
            <p
              className="line-clamp-3 text-[13px] leading-[1.65] text-text-2 font-fraunces"
              dangerouslySetInnerHTML={{ __html: match.snippet }}
            />
          </button>
        );
      })}
    </div>
  );
}
