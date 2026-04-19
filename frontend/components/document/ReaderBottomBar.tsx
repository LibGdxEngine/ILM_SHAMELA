'use client';

import { useCallback, useMemo, useState } from 'react';
import { useI18n } from '@/components/i18n/I18nProvider';
import { Document, DocumentSearchResponse } from '@/lib/api';
import { localeToDateLocale } from '@/lib/i18n/config';
import type { Bookmark, Note } from './readerToolsTypes';
import type { ReaderTheme, FontSizeKey, FontWeightKey } from './FontThemeControls';
import ReaderPanel from './ReaderPanel';
import SearchToolPanel from './SearchToolPanel';
import NotesToolPanel from './NotesToolPanel';
import BookmarksToolPanel from './BookmarksToolPanel';
import FontThemeControls from './FontThemeControls';
import { Document as ReaderDocument } from '@/lib/api';
import { useReadingStats } from '@/hooks/useReadingStats';
import ReadingStatsPanel from './ReadingStatsPanel';

type PopoverName =
  | 'search'
  | 'notes'
  | 'bookmarks'
  | 'fontTheme'
  | 'info'
  | 'goToPage'
  | 'more'
  | null;

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
  onDeleteNote: (id: string | number) => void;
  documentId: number;
  pendingNoteTags: string[];
  onPendingNoteTagsChange: (tags: string[]) => void;
  noteSelectedTags: string[];
  onNoteSelectedTagsChange: (tags: string[]) => void;

  // Bookmarks
  bookmarks: Bookmark[];
  bookmarkSelectedTags: string[];
  onBookmarkSelectedTagsChange: (tags: string[]) => void;
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
  // Advanced typography (Block E)
  tashkeelEnabled: boolean;
  onTashkeelChange: (enabled: boolean) => void;
  letterSpacing: number;
  onLetterSpacingChange: (value: number) => void;
  lineHeight: number;
  onLineHeightChange: (value: number) => void;
  fontWeight: FontWeightKey;
  onFontWeightChange: (weight: FontWeightKey) => void;
  language?: string | null;

  // Info
  document: Document;

  // Controlled open panel (optional - for URL-driven auto-open)
  openPanel?: PopoverName;
  onOpenPanelChange?: (panel: PopoverName) => void;
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
  documentId,
  pendingNoteTags,
  onPendingNoteTagsChange,
  noteSelectedTags,
  onNoteSelectedTagsChange,
  bookmarks,
  bookmarkSelectedTags,
  onBookmarkSelectedTagsChange,
  onToggleCurrentBookmark,
  onRemoveBookmark,
  currentPage,
  totalPages,
  onGoToPage,
  fontSize,
  theme,
  onFontSizeChange,
  onThemeChange,
  tashkeelEnabled,
  onTashkeelChange,
  letterSpacing,
  onLetterSpacingChange,
  lineHeight,
  onLineHeightChange,
  fontWeight,
  onFontWeightChange,
  language,
  document: readerDocument,
  openPanel,
  onOpenPanelChange,
}: ReaderBottomBarProps) {
  const { t } = useI18n();
  const [internalPopover, setInternalPopover] = useState<PopoverName>(null);
  const [pageInputValue, setPageInputValue] = useState('');
  const [pageInputError, setPageInputError] = useState<string | null>(null);
  const [showCopiedToast, setShowCopiedToast] = useState(false);

  const activePopover = openPanel !== undefined ? openPanel : internalPopover;

  const setActivePopover = useCallback(
    (next: PopoverName) => {
      if (onOpenPanelChange) {
        onOpenPanelChange(next);
      } else {
        setInternalPopover(next);
      }
    },
    [onOpenPanelChange]
  );

  const togglePopover = useCallback(
    (name: PopoverName) => {
      setActivePopover(activePopover === name ? null : name);
    },
    [activePopover, setActivePopover]
  );

  const closePopover = useCallback(() => {
    setActivePopover(null);
  }, [setActivePopover]);

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
    setActivePopover(null);
  };

  return (
    <>
      {/* Copied toast */}
      {showCopiedToast && (
        <div className="fixed bottom-20 start-1/2 z-[60] -translate-x-1/2 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white shadow-lg rtl:translate-x-1/2">
          {t('reader.linkCopied', 'Link copied to clipboard')}
        </div>
      )}

      <div
        className="fixed inset-x-0 bottom-0 z-50 border-t border-gray-200 bg-white/95 backdrop-blur"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="mx-auto flex max-w-5xl items-center justify-around px-2 py-2">
          {/* Search */}
          <div className="relative">
            <ReaderPanel
              isOpen={activePopover === 'search'}
              onClose={closePopover}
              width="xl"
              title={t('sidebar.search', 'Search')}
            >
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
            </ReaderPanel>
            <BarButton
              icon={
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              }
              label={t('sidebar.search', 'Search')}
              isActive={activePopover === 'search'}
              onClick={() => togglePopover('search')}
            />
          </div>

          {/* Font/Theme (Aa) */}
          <div className="relative">
            <ReaderPanel
              isOpen={activePopover === 'fontTheme'}
              onClose={closePopover}
              width="narrow"
              title={t('reader.fontSize', 'Font size')}
            >
              <FontThemeControls
                fontSize={fontSize}
                theme={theme}
                onFontSizeChange={onFontSizeChange}
                onThemeChange={onThemeChange}
                tashkeelEnabled={tashkeelEnabled}
                onTashkeelChange={onTashkeelChange}
                letterSpacing={letterSpacing}
                onLetterSpacingChange={onLetterSpacingChange}
                lineHeight={lineHeight}
                onLineHeightChange={onLineHeightChange}
                fontWeight={fontWeight}
                onFontWeightChange={onFontWeightChange}
                language={language}
              />
            </ReaderPanel>
            <BarButton
              icon={<span className="text-sm font-bold">Aa</span>}
              label={t('reader.fontSize', 'Font')}
              isActive={activePopover === 'fontTheme'}
              onClick={() => togglePopover('fontTheme')}
            />
          </div>

          {/* Bookmarks */}
          <div className="relative">
            <ReaderPanel
              isOpen={activePopover === 'bookmarks'}
              onClose={closePopover}
              width="wide"
              title={t('sidebar.bookmarks', 'Bookmarks')}
            >
              <BookmarksToolPanel
                bookmarks={bookmarks}
                currentPage={currentPage}
                selectedTags={bookmarkSelectedTags}
                onSelectedTagsChange={onBookmarkSelectedTagsChange}
                onToggleCurrentBookmark={onToggleCurrentBookmark}
                onRemoveBookmark={onRemoveBookmark}
                onGoToPage={(page) => {
                  onGoToPage(page);
                  closePopover();
                }}
              />
            </ReaderPanel>
            <BarButton
              icon={
                <svg className="h-5 w-5" fill={isCurrentPageBookmarked ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                </svg>
              }
              label={t('sidebar.bookmarks', 'Bookmarks')}
              isActive={activePopover === 'bookmarks' || isCurrentPageBookmarked}
              onClick={() => togglePopover('bookmarks')}
            />
          </div>

          {/* Page indicator (center) */}
          <div className="relative">
            <ReaderPanel
              isOpen={activePopover === 'goToPage'}
              onClose={closePopover}
              width="narrow"
              title={t('reader.goToPage', 'Go to page')}
            >
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
                {pageInputError && <p className="text-xs text-red-500">{pageInputError}</p>}
                <button
                  type="submit"
                  className="w-full rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-700"
                >
                  {t('reader.go', 'Go')}
                </button>
              </form>
            </ReaderPanel>
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

          {/* More / overflow */}
          <div className="relative">
            <ReaderPanel
              isOpen={activePopover === 'more'}
              onClose={closePopover}
              width="wide"
              title={t('reader.more', 'More')}
            >
              <div className="flex flex-col gap-2">
                <OverflowItem
                  label={t('sidebar.notes', 'Notes')}
                  badge={notes.length > 0 ? notes.length : undefined}
                  icon={
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  }
                  onClick={() => setActivePopover('notes')}
                />
                <OverflowItem
                  label={t('reader.share', 'Share')}
                  icon={
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                    </svg>
                  }
                  onClick={() => {
                    handleShare();
                    closePopover();
                  }}
                />
                <OverflowItem
                  label={t('reader.info', 'Info')}
                  icon={
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  }
                  onClick={() => setActivePopover('info')}
                />
              </div>
            </ReaderPanel>
            <BarButton
              icon={
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h.01M12 12h.01M19 12h.01" />
                </svg>
              }
              label={t('reader.more', 'More')}
              isActive={activePopover === 'more'}
              badge={notes.length > 0 ? notes.length : undefined}
              onClick={() => togglePopover('more')}
            />
          </div>
        </div>
      </div>

      {/* Notes panel (opened from More) — its trigger container needs to hold
          the ReaderPanel so positioning is sane on desktop. We mount it as a
          standalone overlay since it's not anchored to a bar button directly. */}
      {activePopover === 'notes' && (
        <FloatingPanel title={t('sidebar.notes', 'Notes')} onClose={closePopover}>
          <NotesToolPanel
            notes={notes}
            noteInput={noteInput}
            currentPage={currentPage}
            documentId={documentId}
            pendingNoteTags={pendingNoteTags}
            selectedTags={noteSelectedTags}
            onPendingNoteTagsChange={onPendingNoteTagsChange}
            onSelectedTagsChange={onNoteSelectedTagsChange}
            onNoteInputChange={onNoteInputChange}
            onAddNote={onAddNote}
            onDeleteNote={onDeleteNote}
            onGoToPage={(page) => {
              onGoToPage(page);
              closePopover();
            }}
          />
        </FloatingPanel>
      )}

      {activePopover === 'info' && (
        <FloatingPanel title={t('reader.info', 'Info')} onClose={closePopover}>
          <ReaderInfoPopoverContent readerDocument={readerDocument} currentPage={currentPage} />
        </FloatingPanel>
      )}
    </>
  );
}

// Floating standalone panel used for Notes / Info which are deep in the overflow
// tree rather than anchored to a bar button. Falls back to a centered modal
// on desktop and a bottom-sheet on mobile (matches ReaderPanel semantics).
function FloatingPanel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <ReaderPanel isOpen={true} onClose={onClose} width="wide" title={title}>
      {children}
    </ReaderPanel>
  );
}

function OverflowItem({
  label,
  icon,
  badge,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-start text-sm font-medium text-gray-700 transition-colors hover:border-teal-300 hover:bg-teal-50/40"
    >
      <span className="flex items-center gap-3">
        <span className="text-teal-700">{icon}</span>
        <span>{label}</span>
      </span>
      {badge !== undefined && (
        <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
          {badge}
        </span>
      )}
    </button>
  );
}

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
      className={`relative flex h-12 flex-col items-center justify-center gap-0.5 rounded-lg px-3 text-xs transition-colors ${
        isActive ? 'text-teal-700' : 'text-gray-500 hover:text-gray-700'
      }`}
      aria-label={label}
    >
      <span className="relative">
        {icon}
        {badge !== undefined && (
          <span className="absolute -top-1.5 -end-2 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
            {badge}
          </span>
        )}
      </span>
      {!hideLabel && <span className="hidden text-[10px] sm:block">{label}</span>}
    </button>
  );
}

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
