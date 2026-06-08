'use client';

import { ApiChapter } from '@/lib/api/reader';

interface ChapterTreeProps {
  chapters: ApiChapter[];
  /** Page-number range currently in view; used to highlight the active branch. */
  activeChapterId: number | null;
  /** Click handler — receives the chapter's `page_start`. */
  onSelect: (pageNumber: number) => void;
  /** Render depth — recursion increments. Top level = 0. */
  depth?: number;
}

const arabicIndic = new Intl.NumberFormat('ar-EG-u-nu-arab');

/**
 * Recursive chapter list. Top-level rows are flush-aligned; nested rows step
 * in by 16px per depth level. The currently active chapter (deepest match)
 * gets a 3px orange right border (RTL) + tinted background.
 */
export default function ChapterTree({
  chapters,
  activeChapterId,
  onSelect,
  depth = 0,
}: ChapterTreeProps) {
  if (chapters.length === 0) return null;

  return (
    <ul className="space-y-0.5" role="tree">
      {chapters.map((ch, idx) => {
        const isActive = ch.id === activeChapterId;
        return (
          <li key={ch.id} role="treeitem" aria-selected={isActive}>
            <button
              type="button"
              onClick={() => onSelect(ch.page_start)}
              className={[
                'group relative flex w-full items-baseline gap-2 py-1.5 pe-3 text-start text-[13px] leading-snug transition-colors',
                isActive
                  ? 'bg-accent-soft text-text'
                  : 'text-text-2 hover:bg-accent-soft/60 hover:text-text',
              ].join(' ')}
              style={{
                paddingInlineStart: 12 + depth * 16,
                borderInlineEnd: isActive ? '3px solid var(--accent)' : '3px solid transparent',
              }}
            >
              <span className="text-text-3 tabular-nums" style={{ minWidth: depth === 0 ? '1.5rem' : '1.25rem' }}>
                {depth === 0 ? arabicIndic.format(idx + 1) : '·'}
              </span>
              <span className="flex-1 truncate">{ch.title}</span>
              <span className="ms-2 shrink-0 text-[11px] text-text-3">
                {arabicIndic.format(ch.page_start)}
                {ch.page_end ? `–${arabicIndic.format(ch.page_end)}` : ''}
              </span>
            </button>
            {ch.children?.length > 0 && (
              <ChapterTree
                chapters={ch.children}
                activeChapterId={activeChapterId}
                onSelect={onSelect}
                depth={depth + 1}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
