'use client';

import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  getDocument,
  getDocumentPages,
  searchInDocument,
  Document,
  DocumentPage as DocumentPageType,
  DocumentSearchResponse,
} from '@/lib/api';
import DocumentViewer from '@/components/document/DocumentViewer';
import ReaderBottomBar from '@/components/document/ReaderBottomBar';
import ReadingProgressBar from '@/components/document/ReadingProgressBar';
import type { Bookmark, Note } from '@/components/document/readerToolsTypes';
import type { ReaderTheme, FontSizeKey } from '@/components/document/FontThemeControls';
import { FONT_SIZE_VALUES } from '@/components/document/FontThemeControls';
import RequireAuth from '@/components/RequireAuth';
import { useI18n } from '@/components/i18n/I18nProvider';
import { useLocalizedPath } from '@/lib/i18n/navigation';

const PAGE_BATCH_SIZE = 5;

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || element.isContentEditable;
}

interface ReaderPreferences {
  fontSize: FontSizeKey;
  theme: ReaderTheme;
}

function loadReaderPreferences(): ReaderPreferences {
  try {
    const saved = localStorage.getItem('reader_preferences');
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        fontSize: parsed.fontSize || 'medium',
        theme: parsed.theme || 'light',
      };
    }
  } catch {
    // ignore
  }
  return { fontSize: 'medium', theme: 'light' };
}

function saveReaderPreferences(prefs: ReaderPreferences) {
  localStorage.setItem('reader_preferences', JSON.stringify(prefs));
}

export default function DocumentDetailPage() {
  const params = useParams();
  const { t } = useI18n();
  const localizedPath = useLocalizedPath();
  const documentId = parseInt(params.id as string, 10);

  const [document, setDocument] = useState<Document | null>(null);
  const [pages, setPages] = useState<DocumentPageType[]>([]);
  const [totalPages, setTotalPages] = useState(0);

  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentBatchPage, setCurrentBatchPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const hasMoreRef = useRef(hasMore);
  const isLoadingMoreRef = useRef(isLoadingMore);
  const isFetchingRef = useRef(false);
  const earliestBatchRef = useRef(1);
  const scrollAdjustRef = useRef<number | null>(null);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  useEffect(() => {
    isLoadingMoreRef.current = isLoadingMore;
  }, [isLoadingMore]);

  const [visiblePageNum, setVisiblePageNum] = useState(1);

  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<DocumentSearchResponse | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [notes, setNotes] = useState<Note[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [noteInput, setNoteInput] = useState('');
  const [hasHydratedLocalData, setHasHydratedLocalData] = useState(false);

  // Font & theme preferences
  const [fontSize, setFontSize] = useState<FontSizeKey>('medium');
  const [readerTheme, setReaderTheme] = useState<ReaderTheme>('light');

  // Load preferences on mount
  useEffect(() => {
    const prefs = loadReaderPreferences();
    setFontSize(prefs.fontSize);
    setReaderTheme(prefs.theme);
  }, []);

  const handleFontSizeChange = useCallback((size: FontSizeKey) => {
    setFontSize(size);
    saveReaderPreferences({ fontSize: size, theme: readerTheme });
  }, [readerTheme]);

  const handleThemeChange = useCallback((theme: ReaderTheme) => {
    setReaderTheme(theme);
    saveReaderPreferences({ fontSize, theme });
  }, [fontSize]);

  const fetchDocument = useCallback(async () => {
    try {
      const doc = await getDocument(documentId);
      setDocument(doc);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('docs.errorLoading', 'Failed to load document'));
    } finally {
      setIsLoading(false);
    }
  }, [documentId, t]);

  const fetchPagesBatch = useCallback(
    async (batchPageNum: number, resetArgs = false) => {
      if (isFetchingRef.current) return;
      if ((!resetArgs && !hasMoreRef.current) || (isLoadingMoreRef.current && !resetArgs)) return;

      isFetchingRef.current = true;
      setIsLoadingMore(true);

      try {
        const response = await getDocumentPages(documentId, batchPageNum, PAGE_BATCH_SIZE);

        setTotalPages(response.total_pages);
        if (resetArgs) {
          setPages(response.pages);
        } else {
          setPages((prev) => [...prev, ...response.pages]);
        }

        if (response.pages.length > 0) {
          const lastPage = response.pages[response.pages.length - 1];
          setHasMore(lastPage.page_number < response.total_pages);
        } else {
          setHasMore(false);
        }

        setCurrentBatchPage(batchPageNum);
      } catch (fetchError) {
        console.error('Error fetching pages:', fetchError);
      } finally {
        setIsLoadingMore(false);
        isFetchingRef.current = false;
      }
    },
    [documentId]
  );

  const fetchPreviousBatch = useCallback(async () => {
    if (earliestBatchRef.current <= 1) return;
    if (isFetchingRef.current) return;

    isFetchingRef.current = true;
    setIsLoadingMore(true);

    const prevBatch = earliestBatchRef.current - 1;

    const scrollContainer = window.document.getElementById('document-scroll-container');
    scrollAdjustRef.current = scrollContainer?.scrollHeight ?? null;

    try {
      const response = await getDocumentPages(documentId, prevBatch, PAGE_BATCH_SIZE);
      setPages((prev) => [...response.pages, ...prev]);
      earliestBatchRef.current = prevBatch;
    } catch (err) {
      console.error('Error fetching previous pages:', err);
    } finally {
      setIsLoadingMore(false);
      isFetchingRef.current = false;
    }
  }, [documentId]);

  // Preserve scroll position when prepending pages
  useLayoutEffect(() => {
    if (scrollAdjustRef.current !== null) {
      const scrollContainer = window.document.getElementById('document-scroll-container');
      if (scrollContainer) {
        const heightDiff = scrollContainer.scrollHeight - scrollAdjustRef.current;
        scrollContainer.scrollTop += heightDiff;
      }
      scrollAdjustRef.current = null;
    }
  }, [pages]);

  const searchAbortControllerRef = useRef<AbortController | null>(null);

  const performSearch = useCallback(
    async (query: string) => {
      if (searchAbortControllerRef.current) {
        searchAbortControllerRef.current.abort();
      }

      if (!query.trim()) {
        setSearchResults(null);
        setIsSearching(false);
        return;
      }

      const abortController = new AbortController();
      searchAbortControllerRef.current = abortController;

      setIsSearching(true);
      try {
        const results = await searchInDocument(documentId, query, abortController.signal);
        if (!abortController.signal.aborted) {
          setSearchResults(results);
        }
      } catch (searchError) {
        if (searchError instanceof Error && searchError.name === 'AbortError') return;
        if (abortController.signal.aborted) return;
        console.error('Search error:', searchError);
        setSearchResults({ matches: [], total_matches: 0, query });
      } finally {
        if (!abortController.signal.aborted) {
          setIsSearching(false);
        }
      }
    },
    [documentId]
  );

  useEffect(() => {
    if (!searchQuery.trim()) {
      performSearch('');
      return;
    }

    const timeout = window.setTimeout(() => {
      performSearch(searchQuery);
    }, 350);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [searchQuery, performSearch]);

  useEffect(() => {
    return () => {
      if (searchAbortControllerRef.current) {
        searchAbortControllerRef.current.abort();
      }
    };
  }, []);

  const handleGoToPage = useCallback(
    async (pageNumber: number) => {
      if (!pageNumber || Number.isNaN(pageNumber)) return;

      const existingPage = pages.find((page) => page.page_number === pageNumber);
      if (existingPage) {
        const element = window.document.querySelector(`[data-page="${pageNumber}"]`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth' });
          setVisiblePageNum(pageNumber);
        }
        return;
      }

      if (isFetchingRef.current) return;

      const targetBatch = Math.ceil(pageNumber / PAGE_BATCH_SIZE);
      setPages([]);
      isFetchingRef.current = true;
      setIsLoadingMore(true);

      try {
        const response = await getDocumentPages(documentId, targetBatch, PAGE_BATCH_SIZE);
        setPages(response.pages);
        setTotalPages(response.total_pages);
        setCurrentBatchPage(targetBatch);
        earliestBatchRef.current = targetBatch;
        setVisiblePageNum(pageNumber);

        if (response.pages.length > 0) {
          const lastPage = response.pages[response.pages.length - 1];
          setHasMore(lastPage.page_number < response.total_pages);
        } else {
          setHasMore(false);
        }

        window.setTimeout(() => {
          const element = window.document.querySelector(`[data-page="${pageNumber}"]`);
          element?.scrollIntoView({ behavior: 'auto' });
        }, 100);
      } catch (jumpError) {
        console.error('Failed to jump to page', jumpError);
      } finally {
        setIsLoadingMore(false);
        isFetchingRef.current = false;
      }
    },
    [documentId, pages]
  );

  const handleLoadMore = useCallback(() => {
    fetchPagesBatch(currentBatchPage + 1);
  }, [fetchPagesBatch, currentBatchPage]);

  const handleAddNote = useCallback(() => {
    if (!noteInput.trim()) return;
    const newNote: Note = {
      id: Date.now().toString(),
      page: visiblePageNum,
      content: noteInput.trim(),
      createdAt: Date.now(),
    };
    setNotes((prev) => [newNote, ...prev]);
    setNoteInput('');
  }, [noteInput, visiblePageNum]);

  const handleDeleteNote = useCallback((id: string) => {
    setNotes((prev) => prev.filter((note) => note.id !== id));
  }, []);

  const handleToggleCurrentBookmark = useCallback(() => {
    setBookmarks((prev) => {
      const exists = prev.some((bookmark) => bookmark.page === visiblePageNum);
      if (exists) {
        return prev.filter((bookmark) => bookmark.page !== visiblePageNum);
      }
      return [...prev, { page: visiblePageNum, createdAt: Date.now() }];
    });
  }, [visiblePageNum]);

  const handleRemoveBookmark = useCallback((page: number) => {
    setBookmarks((prev) => prev.filter((bookmark) => bookmark.page !== page));
  }, []);

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    setDocument(null);
    setPages([]);
    setTotalPages(0);
    setCurrentBatchPage(1);
    earliestBatchRef.current = 1;
    setHasMore(true);
    setVisiblePageNum(1);
    fetchDocument();
    fetchPagesBatch(1, true);
    setSearchQuery('');
    setSearchResults(null);
    setNotes([]);
    setBookmarks([]);
    setNoteInput('');
    setHasHydratedLocalData(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  useEffect(() => {
    const notesKey = `doc_${documentId}_notes`;
    const bookmarksKey = `doc_${documentId}_bookmarks`;

    try {
      const savedNotes = localStorage.getItem(notesKey);
      const savedBookmarks = localStorage.getItem(bookmarksKey);

      if (savedNotes) {
        const parsed = JSON.parse(savedNotes) as Note[];
        if (Array.isArray(parsed)) {
          setNotes(parsed);
        }
      }

      if (savedBookmarks) {
        const parsed = JSON.parse(savedBookmarks) as Bookmark[];
        if (Array.isArray(parsed)) {
          setBookmarks(parsed);
        }
      }
    } catch (storageError) {
      console.warn('Failed to parse reader local data', storageError);
      setNotes([]);
      setBookmarks([]);
    } finally {
      setHasHydratedLocalData(true);
    }
  }, [documentId]);

  useEffect(() => {
    if (!hasHydratedLocalData) return;
    const notesKey = `doc_${documentId}_notes`;
    localStorage.setItem(notesKey, JSON.stringify(notes));
  }, [documentId, hasHydratedLocalData, notes]);

  useEffect(() => {
    if (!hasHydratedLocalData) return;
    const bookmarksKey = `doc_${documentId}_bookmarks`;
    localStorage.setItem(bookmarksKey, JSON.stringify(bookmarks));
  }, [documentId, hasHydratedLocalData, bookmarks]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();

      if ((event.ctrlKey || event.metaKey) && key === 'f') {
        event.preventDefault();
        // Ctrl+F opens search - handled via bottom bar
        return;
      }

      if (event.key === 'Escape') {
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      if (event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      if (key === 't') {
        event.preventDefault();
        // Cycle through themes
        setReaderTheme((prev) => {
          const themes: ReaderTheme[] = ['light', 'sepia', 'dark'];
          const nextIndex = (themes.indexOf(prev) + 1) % themes.length;
          const next = themes[nextIndex];
          saveReaderPreferences({ fontSize, theme: next });
          return next;
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [fontSize]);

  // Apply font size CSS variable and theme attribute
  useEffect(() => {
    const container = window.document.getElementById('document-scroll-container');
    if (container) {
      container.style.setProperty('--reader-font-size', FONT_SIZE_VALUES[fontSize]);
      container.setAttribute('data-reader-theme', readerTheme);
    }
  }, [fontSize, readerTheme]);

  if (isLoading || !document) {
    return (
      <RequireAuth>
        <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
          <div className="flex flex-col items-center">
            <div className="mb-4 h-10 w-10 animate-spin rounded-full border-4 border-teal-600 border-t-transparent" />
            <p className="text-gray-500">{t('reader.loadingDocument', 'Loading document...')}</p>
          </div>
        </div>
      </RequireAuth>
    );
  }

  if (error) {
    return (
      <RequireAuth>
        <div className="flex min-h-screen items-center justify-center text-red-500">{error}</div>
      </RequireAuth>
    );
  }

  return (
    <RequireAuth>
      <div className="relative h-full min-h-0 flex flex-col overflow-hidden bg-gradient-to-b from-gray-100 to-slate-100">
        <ReadingProgressBar currentPage={visiblePageNum} totalPages={totalPages} />

        <div
          className="flex-1 min-h-0 overflow-y-auto pb-16"
          id="document-scroll-container"
          data-reader-theme={readerTheme}
          style={{ '--reader-font-size': FONT_SIZE_VALUES[fontSize] } as React.CSSProperties}
        >
          {/* Simplified header */}
          <div className="sticky top-0 z-20 border-b border-gray-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur md:px-6">
            <div className="flex items-center justify-between gap-3">
              <Link
                href={localizedPath('/documents')}
                className="inline-flex items-center gap-2 rounded-lg px-2 py-1 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-teal-700"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                {t('reader.library', 'Library')}
              </Link>

              <p className="mx-2 line-clamp-1 flex-1 text-center text-sm font-semibold text-gray-900 md:text-base">
                {document.title}
              </p>

              <span className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-600">
                {t('reader.pageOf', 'Page {current} of {total}', {
                  current: visiblePageNum,
                  total: totalPages,
                })}
              </span>
            </div>
          </div>

          <DocumentViewer
            pages={pages}
            isLoading={isLoadingMore}
            hasMore={hasMore}
            searchQuery={searchResults?.query || ''}
            onLoadMore={handleLoadMore}
            onPageVisible={setVisiblePageNum}
            onLoadFirstPage={fetchPreviousBatch}
            language={document.language}
          />
        </div>

        <ReaderBottomBar
          searchQuery={searchQuery}
          isSearching={isSearching}
          searchResults={searchResults}
          onSearchQueryChange={setSearchQuery}
          notes={notes}
          noteInput={noteInput}
          onNoteInputChange={setNoteInput}
          onAddNote={handleAddNote}
          onDeleteNote={handleDeleteNote}
          bookmarks={bookmarks}
          onToggleCurrentBookmark={handleToggleCurrentBookmark}
          onRemoveBookmark={handleRemoveBookmark}
          currentPage={visiblePageNum}
          totalPages={totalPages}
          onGoToPage={handleGoToPage}
          fontSize={fontSize}
          theme={readerTheme}
          onFontSizeChange={handleFontSizeChange}
          onThemeChange={handleThemeChange}
          document={document}
        />
      </div>
    </RequireAuth>
  );
}
