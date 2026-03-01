'use client';

import { useState, useCallback } from 'react';
import { useI18n } from '@/components/i18n/I18nProvider';
import { Document, DocumentSearchResponse } from '@/lib/api';
import { localeToDateLocale } from '@/lib/i18n/config';
import type { Bookmark, Note } from './readerToolsTypes';
import type { ReaderTheme, FontSizeKey } from './FontThemeControls';
import ReaderPopover from './ReaderPopover';
import SearchToolPanel from './SearchToolPanel';
import NotesToolPanel from './NotesToolPanel';
import BookmarksToolPanel from './BookmarksToolPanel';
import FontThemeControls from './FontThemeControls';

type PopoverName = 'search' | 'notes' | 'bookmarks' | 'fontTheme' | 'info' | 'goToPage' | null;

interface ReaderBottomBarProps {
  // Search
  searchQuery: string;
  isSearching: boolean;
  searchResults: DocumentSearchResponse | null;
  onSearchQueryChange: (query: string) => void;

  // Notes
  notes: Note[];
  noteInput: string;
  onNoteInputChange: (value: string) => void;
  onAddNote: () => void;
  onDeleteNote: (id: string) => void;

  // Bookmarks
  bookmarks: Bookmark[];
  onToggleCurrentBookmark: () => void;
  onRemoveBookmark: (page: number) => void;

  // Navigation
  currentPage: number;
  totalPages: number;
  onGoToPage: (page: number) => void;

  // Font & Theme
  fontSize: FontSizeKey;
  theme: ReaderTheme;
  onFontSizeChange: (size: FontSizeKey) => void;
  onThemeChange: (theme: ReaderTheme) => void;

  // Info
  document: Document;
}

export default function ReaderBottomBar({
  searchQuery,
  isSearching,
  searchResults,
  onSearchQueryChange,
  notes,
  noteInput,
  onNoteInputChange,
  onAddNote,
  onDeleteNote,
  bookmarks,
  onToggleCurrentBookmark,
  onRemoveBookmark,
  currentPage,
  totalPages,
  onGoToPage,
  fontSize,
  theme,
  onFontSizeChange,
  onThemeChange,
  document: readerDocument,
}: ReaderBottomBarProps) {
  const { t } = useI18n();
  const [openPopover, setOpenPopover] = useState<PopoverName>(null);
  const [pageInputValue, setPageInputValue] = useState('');
  const [pageInputError, setPageInputError] = useState<string | null>(null);
  const [showCopiedToast, setShowCopiedToast] = useState(false);

  const togglePopover = useCallback((name: PopoverName) => {
    setOpenPopover((prev) => (prev === name ? null : name));
  }, []);

  const closePopover = useCallback(() => {
    setOpenPopover(null);
  }, []);

  const isCurrentPageBookmarked = bookmarks.some((b) => b.page === currentPage);

  const handleShare = useCallback(() => {
    const url = `${window.location.href.split('?')[0]}?page=${currentPage}`;
    navigator.clipboard.writeText(url).then(() => {
      setShowCopiedToast(true);
      setTimeout(() => setShowCopiedToast(false), 2000);
    });
  }, [currentPage]);

  const handleGoToPageSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPageInputError(null);
    const pageNum = parseInt(pageInputValue.trim(), 10);
    if (Number.isNaN(pageNum)) {
      setPageInputError(t('reader.invalidPageNumber', 'Enter a valid page number.'));
      return;
    }
    if (pageNum < 1 || (totalPages > 0 && pageNum > totalPages)) {
      setPageInputError(
        t('reader.pageRange', 'Page number must be between 1 and {total}.', { total: totalPages })
      );
      return;
    }
    onGoToPage(pageNum);
    setPageInputValue('');
    setOpenPopover(null);
  };

  // Open a specific tool (used by keyboard shortcuts)
  const openTool = useCallback((name: PopoverName) => {
    setOpenPopover(name);
  }, []);

  // Expose openTool on the component for parent access via ref-like pattern
  // We'll use a different approach - expose via callback
  // Actually parent will just call setOpenPopover through a simpler mechanism

  return (
    <>
      {/* Copied toast */}
      {showCopiedToast && (
        <div className="fixed bottom-20 left-1/2 z-[60] -translate-x-1/2 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white shadow-lg">
          {t('reader.linkCopied', 'Link copied to clipboard')}
        </div>
      )}

      <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-gray-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-around px-2 py-2">
          {/* Search */}
          <div className="relative">
            <ReaderPopover isOpen={openPopover === 'search'} onClose={closePopover} width="wide">
              <SearchToolPanel
                query={searchQuery}
                isSearching={isSearching}
                searchResults={searchResults}
                onQueryChange={onSearchQueryChange}
                onGoToPage={(page) => {
                  onGoToPage(page);
                  closePopover();
                }}
              />
            </ReaderPopover>
            <BarButton
              icon={
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              }
              label={t('sidebar.search', 'Search')}
              isActive={openPopover === 'search'}
              onClick={() => togglePopover('search')}
            />
          </div>

          {/* Notes */}
          <div className="relative">
            <ReaderPopover isOpen={openPopover === 'notes'} onClose={closePopover} width="wide">
              <NotesToolPanel
                notes={notes}
                noteInput={noteInput}
                currentPage={currentPage}
                onNoteInputChange={onNoteInputChange}
                onAddNote={onAddNote}
                onDeleteNote={onDeleteNote}
                onGoToPage={(page) => {
                  onGoToPage(page);
                  closePopover();
                }}
              />
            </ReaderPopover>
            <BarButton
              icon={
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              }
              label={t('sidebar.notes', 'Notes')}
              isActive={openPopover === 'notes'}
              badge={notes.length > 0 ? notes.length : undefined}
              onClick={() => togglePopover('notes')}
            />
          </div>

          {/* Bookmarks */}
          <div className="relative">
            <ReaderPopover isOpen={openPopover === 'bookmarks'} onClose={closePopover} width="wide">
              <BookmarksToolPanel
                bookmarks={bookmarks}
                currentPage={currentPage}
                onToggleCurrentBookmark={onToggleCurrentBookmark}
                onRemoveBookmark={onRemoveBookmark}
                onGoToPage={(page) => {
                  onGoToPage(page);
                  closePopover();
                }}
              />
            </ReaderPopover>
            <BarButton
              icon={
                <svg className="h-5 w-5" fill={isCurrentPageBookmarked ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                </svg>
              }
              label={t('sidebar.bookmarks', 'Bookmarks')}
              isActive={openPopover === 'bookmarks' || isCurrentPageBookmarked}
              onClick={() => togglePopover('bookmarks')}
            />
          </div>

          {/* Font/Theme */}
          <div className="relative">
            <ReaderPopover isOpen={openPopover === 'fontTheme'} onClose={closePopover} width="narrow">
              <FontThemeControls
                fontSize={fontSize}
                theme={theme}
                onFontSizeChange={onFontSizeChange}
                onThemeChange={onThemeChange}
              />
            </ReaderPopover>
            <BarButton
              icon={<span className="text-sm font-bold">Aa</span>}
              label={t('reader.fontSize', 'Font')}
              isActive={openPopover === 'fontTheme'}
              onClick={() => togglePopover('fontTheme')}
            />
          </div>

          {/* Share */}
          <BarButton
            icon={
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
            }
            label={t('reader.share', 'Share')}
            onClick={handleShare}
          />

          {/* Info */}
          <div className="relative">
            <ReaderPopover isOpen={openPopover === 'info'} onClose={closePopover} width="wide">
              <ReaderInfoPopoverContent
                readerDocument={readerDocument}
                currentPage={currentPage}
              />
            </ReaderPopover>
            <BarButton
              icon={
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
              label={t('reader.info', 'Info')}
              isActive={openPopover === 'info'}
              onClick={() => togglePopover('info')}
            />
          </div>

          {/* Page indicator */}
          <div className="relative">
            <ReaderPopover isOpen={openPopover === 'goToPage'} onClose={closePopover} width="narrow">
              <form onSubmit={handleGoToPageSubmit} className="space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {t('reader.goToPage', 'Go to page')}
                </label>
                <input
                  type="number"
                  min="1"
                  max={totalPages || undefined}
                  value={pageInputValue}
                  onChange={(e) => {
                    setPageInputValue(e.target.value);
                    setPageInputError(null);
                  }}
                  placeholder={`1 - ${totalPages}`}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-200"
                  autoFocus
                />
                {pageInputError && (
                  <p className="text-xs text-red-500">{pageInputError}</p>
                )}
                <button
                  type="submit"
                  className="w-full rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-700"
                >
                  {t('reader.go', 'Go')}
                </button>
              </form>
            </ReaderPopover>
            <BarButton
              icon={
                <span className="text-[11px] font-semibold leading-tight">
                  {currentPage}/{totalPages}
                </span>
              }
              label={t('reader.pageOf', '{current}/{total}', { current: currentPage, total: totalPages })}
              hideLabel
              onClick={() => togglePopover('goToPage')}
            />
          </div>
        </div>
      </div>
    </>
  );
}

// Reusable bar button
function BarButton({
  icon,
  label,
  isActive,
  badge,
  hideLabel,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  isActive?: boolean;
  badge?: number;
  hideLabel?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex flex-col items-center gap-0.5 rounded-lg px-2 py-1.5 text-xs transition-colors ${
        isActive ? 'text-teal-700' : 'text-gray-500 hover:text-gray-700'
      }`}
      aria-label={label}
    >
      <span className="relative">
        {icon}
        {badge !== undefined && (
          <span className="absolute -top-1.5 -right-2 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
            {badge}
          </span>
        )}
      </span>
      {!hideLabel && <span className="hidden text-[10px] sm:block">{label}</span>}
    </button>
  );
}

// Inline info content (reuses reading stats but without the popover wrapper from ReaderInfoPopover)
import { useMemo } from 'react';
import { Document as ReaderDocument } from '@/lib/api';
import { useReadingStats } from '@/hooks/useReadingStats';
import ReadingStatsPanel from './ReadingStatsPanel';

function ReaderInfoPopoverContent({
  readerDocument,
  currentPage,
}: {
  readerDocument: ReaderDocument;
  currentPage: number;
}) {
  const { t, locale } = useI18n();
  const { stats, resetStats } = useReadingStats(readerDocument.id, currentPage);

  const uploadedDate = useMemo(
    () => new Date(readerDocument.uploaded_at).toLocaleDateString(localeToDateLocale(locale)),
    [readerDocument.uploaded_at, locale]
  );

  return (
    <div>
      <div className="mb-4 space-y-3">
        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
            {t('sidebar.title', 'Title')}
          </h3>
          <p className="text-sm font-medium leading-6 text-gray-900">{readerDocument.title}</p>
        </section>

        {readerDocument.authors && readerDocument.authors.length > 0 && (
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
              {t('sidebar.authors', 'Authors')}
            </h3>
            <p className="text-sm text-gray-700">{readerDocument.authors.map((a) => a.name).join(', ')}</p>
          </section>
        )}

        {readerDocument.categories && readerDocument.categories.length > 0 && (
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
              {t('sidebar.categories', 'Categories')}
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {readerDocument.categories.map((category) => {
                const key = typeof category === 'string' ? category : String(category.id);
                const name = typeof category === 'string' ? category : category.name;
                return (
                  <span key={key} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                    {name}
                  </span>
                );
              })}
            </div>
          </section>
        )}

        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
            {t('sidebar.details', 'Details')}
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-2">
              <span className="block text-[10px] uppercase text-gray-500">
                {t('sidebar.uploaded', 'Uploaded')}
              </span>
              <span className="text-xs font-semibold text-gray-800">{uploadedDate}</span>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-2">
              <span className="block text-[10px] uppercase text-gray-500">
                {t('docs.language', 'Language')}
              </span>
              <span className="text-xs font-semibold text-gray-800">
                {readerDocument.language || t('sidebar.unknown', 'Unknown')}
              </span>
            </div>
          </div>
        </section>
      </div>

      <ReadingStatsPanel stats={stats} onReset={resetStats} />
    </div>
  );
}
