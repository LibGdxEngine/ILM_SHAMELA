'use client';

import { ReactNode, useMemo, useState } from 'react';

import { useI18n } from '@/components/i18n/I18nProvider';
import { Document, normalizeMediaUrl } from '@/lib/api';

import { useReaderShell } from './ReaderShell';

export type TocTabKey = 'chapters' | 'bookmarks' | 'notes' | 'stats';

interface ReaderTOCColumnProps {
  document: Document;
  currentPage: number;
  totalPages: number;
  /** Tab slot content. Pass null to skip rendering for a given tab. */
  chaptersContent: ReactNode;
  bookmarksContent: ReactNode;
  notesContent: ReactNode;
  statsContent: ReactNode;
  /** Optional controlled tab. Uncontrolled defaults to "chapters". */
  initialTab?: TocTabKey;
}

const TABS: { key: TocTabKey; labelKey: string; fallback: string }[] = [
  { key: 'chapters', labelKey: 'reader.toc.tabs.chapters', fallback: 'Chapters' },
  { key: 'bookmarks', labelKey: 'reader.toc.tabs.bookmarks', fallback: 'Bookmarks' },
  { key: 'notes', labelKey: 'reader.toc.tabs.notes', fallback: 'Notes' },
  { key: 'stats', labelKey: 'reader.toc.tabs.stats', fallback: 'Stats' },
];

/**
 * Right-column reader sidebar with book identity card + 4 tabs.
 * Collapsing is owned by ReaderShell; this component reads the flag and
 * renders either a 56px icon rail or the full panel.
 */
export default function ReaderTOCColumn({
  document,
  currentPage,
  totalPages,
  chaptersContent,
  bookmarksContent,
  notesContent,
  statsContent,
  initialTab = 'chapters',
}: ReaderTOCColumnProps) {
  const { t } = useI18n();
  const { tocCollapsed, toggleToc } = useReaderShell();
  const [tab, setTab] = useState<TocTabKey>(initialTab);

  const coverUrl = useMemo(
    () =>
      normalizeMediaUrl(document.cover_photo_url) ||
      normalizeMediaUrl(document.thumbnail_url),
    [document.cover_photo_url, document.thumbnail_url],
  );

  const monogram = (document.title?.trim()?.charAt(0) || '?').toUpperCase();
  const authors = document.authors?.map((a) => a.name).join('، ');

  if (tocCollapsed) {
    return (
      <div className="flex h-full flex-col items-center gap-1 py-3">
        <button
          type="button"
          aria-label={t('reader.toc.expand', 'Expand TOC')}
          onClick={toggleToc}
          className="rounded-md p-2 text-text-2 transition-colors hover:bg-accent-soft hover:text-accent"
        >
          <ExpandCaretIcon />
        </button>
      </div>
    );
  }

  const tabContent: Record<TocTabKey, ReactNode> = {
    chapters: chaptersContent,
    bookmarks: bookmarksContent,
    notes: notesContent,
    stats: statsContent,
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Book identity card */}
      <div className="border-b border-border p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1" />
          <button
            type="button"
            aria-label={t('reader.toc.collapse', 'Collapse TOC')}
            onClick={toggleToc}
            className="rounded-md p-1.5 text-text-3 transition-colors hover:bg-accent-soft hover:text-accent"
          >
            <CaretIcon />
          </button>
        </div>

        <div className="flex justify-center pt-1">
          <div
            className="relative h-[130px] w-[90px] flex-shrink-0 overflow-hidden rounded-md border border-border bg-card-2 shadow-whisper"
            style={{ transform: 'perspective(800px) rotateY(-6deg)' }}
          >
            {coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-accent-2 to-accent font-fraunces text-2xl font-semibold text-white">
                <bdi>{monogram}</bdi>
              </div>
            )}
          </div>
        </div>

        <h2 className="mt-4 line-clamp-2 text-center font-reem-kufi text-[16px] font-semibold leading-snug text-text">
          <bdi>{document.title}</bdi>
        </h2>
        {authors && (
          <p className="mt-1 line-clamp-1 text-center text-[13px] italic text-text-2">
            <bdi>{authors}</bdi>
          </p>
        )}
        <p className="mt-2 text-center text-[11.5px] text-text-3">
          {t('reader.pageOf', 'Page {current} of {total}', {
            current: currentPage,
            total: totalPages,
          })}
        </p>
      </div>

      {/* Tab strip */}
      <div role="tablist" className="flex border-b border-border bg-bg-2/40">
        {TABS.map((entry) => {
          const active = tab === entry.key;
          return (
            <button
              key={entry.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(entry.key)}
              className={[
                'flex-1 border-b-2 px-1 py-2.5 text-[11.5px] font-medium transition-colors',
                active
                  ? 'border-accent text-text'
                  : 'border-transparent text-text-3 hover:text-text-2',
              ].join(' ')}
            >
              {t(entry.labelKey, entry.fallback)}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tabContent[tab] ?? (
          <p className="p-4 text-[13px] text-text-3">
            {t('reader.toc.empty', 'Nothing to show yet.')}
          </p>
        )}
      </div>
    </div>
  );
}

/* ---------- icons ---------- */

function CaretIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="9 18 15 12 9 6" className="rtl:hidden" />
      <polyline points="15 18 9 12 15 6" className="hidden rtl:block" />
    </svg>
  );
}

function ExpandCaretIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="15 18 9 12 15 6" className="rtl:hidden" />
      <polyline points="9 18 15 12 9 6" className="hidden rtl:block" />
    </svg>
  );
}
