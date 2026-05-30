'use client';

import Link from 'next/link';
import { ReactNode, useMemo } from 'react';

import { useI18n } from '@/components/i18n/I18nProvider';
import { Document } from '@/lib/api';
import { useLocalizedPath } from '@/lib/i18n/navigation';

import { useReaderShell } from './ReaderShell';

interface ReaderHeaderProps {
  document: Document;
  currentPage: number;
  totalPages: number;
  /** Title of the chapter that the user is currently reading (for the breadcrumb tail). */
  currentChapterTitle?: string | null;
  isBookmarked: boolean;

  /** Header icon actions. Implementations can be popovers, drawers, etc. */
  onOpenSearch: () => void;
  onToggleBookmark: () => void;
  onOpenFontControls: () => void;
  onOpenMore: () => void;
}

/**
 * Slim 56px sticky reader header.
 *
 * Right→left order in RTL:
 *   [logo] [breadcrumb] ........ [title centered] ........ [icon row + assistant toggle]
 * A thin orange progress bar lives flush against the bottom edge.
 */
export default function ReaderHeader({
  document,
  currentPage,
  totalPages,
  currentChapterTitle,
  isBookmarked,
  onOpenSearch,
  onToggleBookmark,
  onOpenFontControls,
  onOpenMore,
}: ReaderHeaderProps) {
  const { t } = useI18n();
  const localizedPath = useLocalizedPath();
  const { assistantCollapsed, toggleAssistant } = useReaderShell();

  const breadcrumbTail = useMemo(() => {
    const parts: string[] = [t('reader.breadcrumb.library', 'Library')];
    if (document.title) parts.push(document.title);
    if (currentChapterTitle) parts.push(currentChapterTitle);
    return parts;
  }, [document.title, currentChapterTitle, t]);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/90 backdrop-blur-xl">
      <div className="relative flex h-14 items-center gap-3 px-4 md:px-6">
        <Link
          href={localizedPath('/documents')}
          aria-label={t('reader.backToLibrary', 'Back to library')}
          className="flex items-center gap-2 rounded-md px-1.5 py-1 text-text transition-colors hover:bg-accent-soft"
        >
          <LogoMark />
        </Link>

        <nav
          aria-label={t('reader.breadcrumb.label', 'Breadcrumb')}
          className="hidden min-w-0 items-center gap-1.5 text-[13px] text-text-2 md:flex"
        >
          {breadcrumbTail.map((label, i) => (
            <span key={i} className="flex min-w-0 items-center gap-1.5">
              {i > 0 && <ChevronSep />}
              <span
                className={
                  i === breadcrumbTail.length - 1
                    ? 'truncate text-text'
                    : 'truncate text-text-2'
                }
                title={label}
              >
                {label}
              </span>
            </span>
          ))}
        </nav>

        <h1
          className="pointer-events-none absolute start-1/2 max-w-[40%] -translate-x-1/2 truncate font-reem-kufi text-[15px] font-medium text-text rtl:translate-x-1/2"
          title={document.title}
        >
          <bdi>{document.title}</bdi>
        </h1>

        <div className="ms-auto flex items-center gap-1">
          <span className="me-2 hidden whitespace-nowrap rounded-full border border-border bg-card-2 px-2.5 py-0.5 text-[11.5px] text-text-2 md:inline-flex">
            {t('reader.pageOf', 'Page {current} of {total}', {
              current: currentPage,
              total: totalPages,
            })}
          </span>

          <IconButton
            label={t('reader.header.search', 'Search')}
            onClick={onOpenSearch}
          >
            <SearchIcon />
          </IconButton>

          <IconButton
            label={t('reader.header.bookmark', 'Bookmark')}
            onClick={onToggleBookmark}
            active={isBookmarked}
          >
            <BookmarkIcon filled={isBookmarked} />
          </IconButton>

          <IconButton
            label={t('reader.header.font', 'Text settings')}
            onClick={onOpenFontControls}
          >
            <span className="font-reem-kufi text-[14px] font-semibold">Aa</span>
          </IconButton>

          <IconButton
            label={t('reader.header.more', 'More')}
            onClick={onOpenMore}
          >
            <MoreIcon />
          </IconButton>

          <IconButton
            label={t('reader.header.assistant', 'AI assistant')}
            onClick={toggleAssistant}
            active={!assistantCollapsed}
          >
            <AssistantIcon />
          </IconButton>
        </div>
      </div>

      <div className="absolute inset-x-0 -bottom-px h-[3px] bg-black/[0.04]">
        <div
          className="h-full bg-gradient-to-r from-accent to-accent-2 shadow-[0_0_10px_-2px_rgba(185,115,64,0.5)] transition-[width] duration-300 ease-out"
          style={{
            width: totalPages > 0 ? `${(currentPage / totalPages) * 100}%` : '0%',
          }}
        />
      </div>
    </header>
  );
}

/* ---------- atoms ---------- */

function IconButton({
  label,
  onClick,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={[
        'inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors',
        active
          ? 'bg-accent text-white hover:bg-[#a86432]'
          : 'text-text-2 hover:bg-accent-soft hover:text-accent',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function LogoMark() {
  return (
    <span className="inline-flex h-7 items-center font-reem-kufi text-[15px] font-semibold tracking-wide text-accent">
      ILM
    </span>
  );
}

function ChevronSep() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      className="flex-shrink-0 text-text-3 rtl:-scale-x-100"
      aria-hidden="true"
    >
      <path d="M3.5 1.5L7 5l-3.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function BookmarkIcon({ filled }: { filled?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="19" cy="12" r="1.4" />
    </svg>
  );
}

function AssistantIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l2.39 4.84L20 8l-4 3.9.94 5.47L12 14.77l-4.94 2.6L8 11.9 4 8l5.61-1.16L12 2z" />
    </svg>
  );
}
