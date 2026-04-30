'use client';

import { useState, useEffect, useCallback, useRef, useLayoutEffect, useMemo } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
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
import DocumentHero from '@/components/document/DocumentHero';
import DocumentHeroSkeleton from '@/components/document/DocumentHeroSkeleton';
import DocumentPageSkeleton from '@/components/document/DocumentPageSkeleton';
import CompactReaderHeader from '@/components/document/CompactReaderHeader';
import SelectionPopover from '@/components/document/SelectionPopover';
import type { Bookmark, Note } from '@/components/document/readerToolsTypes';
import type { ReaderTheme, FontSizeKey, FontWeightKey } from '@/components/document/FontThemeControls';
import { FONT_SIZE_VALUES } from '@/components/document/FontThemeControls';
import RequireAuth from '@/components/RequireAuth';
import { useI18n } from '@/components/i18n/I18nProvider';
import { useBookmarks } from '@/lib/reader/useBookmarks';
import { useNotes } from '@/lib/reader/useNotes';
import { useHighlights } from '@/lib/reader/useHighlights';
import { useReaderPreferences } from '@/lib/reader/useReaderPreferences';
import { useReadingProgress } from '@/lib/reader/useReadingProgress';
import { migrateReaderLocalStorageForDocument } from '@/lib/reader/migrate';

const PAGE_BATCH_SIZE = 5;

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || element.isContentEditable;
}

type BottomBarPanel =
  | 'search'
  | 'notes'
  | 'bookmarks'
  | 'fontTheme'
  | 'info'
  | 'goToPage'
  | 'more'
  | null;

export default function DocumentDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const { t } = useI18n();
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
  const [highlightedPage, setHighlightedPage] = useState<number | null>(null);

  // API-backed reader resources (Block C/F).
  const bookmarksHook = useBookmarks(documentId);
  const notesHook = useNotes(documentId);
  const highlightsHook = useHighlights(documentId);
  const preferencesHook = useReaderPreferences();
  const progressHook = useReadingProgress(documentId);

  // Map API shapes to legacy panel shapes used by Bookmarks/Notes panels.
  const bookmarks: Bookmark[] = useMemo(
    () =>
      bookmarksHook.data.map((b) => ({
        id: b.id,
        page: b.page_number,
        createdAt: Date.parse(b.created_at) || Date.now(),
        tags: b.tags ?? [],
        label: b.label,
      })),
    [bookmarksHook.data]
  );

  const notes: Note[] = useMemo(
    () =>
      notesHook.data.map((n) => ({
        id: n.id,
        page: n.page_number,
        content: n.body,
        createdAt: Date.parse(n.created_at) || Date.now(),
        tags: n.tags ?? [],
      })),
    [notesHook.data]
  );

  const [noteInput, setNoteInput] = useState('');
  const [pendingNoteTags, setPendingNoteTags] = useState<string[]>([]);
  const [bookmarkSelectedTags, setBookmarkSelectedTags] = useState<string[]>([]);
  const [noteSelectedTags, setNoteSelectedTags] = useState<string[]>([]);

  // Font & theme preferences (with advanced controls).
  const [fontSize, setFontSize] = useState<FontSizeKey>('medium');
  const [readerTheme, setReaderTheme] = useState<ReaderTheme>('light');
  const [tashkeelEnabled, setTashkeelEnabled] = useState<boolean>(true);
  const [letterSpacing, setLetterSpacing] = useState<number>(0);
  const [lineHeight, setLineHeight] = useState<number>(1.8);
  const [fontWeight, setFontWeight] = useState<FontWeightKey>(400);

  // Hero collapse state driven by IntersectionObserver on the sentinel below the hero.
  const [isHeroCollapsed, setIsHeroCollapsed] = useState(false);
  const heroSentinelRef = useRef<HTMLDivElement | null>(null);

  // Controlled bottom-bar panel so we can auto-open search from URL `?q=`.
  const [openBottomPanel, setOpenBottomPanel] = useState<BottomBarPanel>(null);
  const hasSeededQueryFromUrlRef = useRef(false);

  // Hydrate from server-side preferences once the API responds. The hook is
  // gated on auth, so unauthenticated readers stay on the local defaults
  // declared above (medium / light / 1.8 / 400 / spacing 0).
  const hasHydratedPrefsRef = useRef(false);
  useEffect(() => {
    if (hasHydratedPrefsRef.current) return;
    const data = preferencesHook.data;
    if (!data) return;
    hasHydratedPrefsRef.current = true;
    setFontSize(data.font_size);
    setReaderTheme(data.theme);
    setTashkeelEnabled(data.tashkeel_enabled);
    setLetterSpacing(data.letter_spacing);
    setLineHeight(data.line_height);
    setFontWeight(data.font_weight as FontWeightKey);
  }, [preferencesHook.data]);

  // Trigger Tier-2 per-document migration on mount.
  useEffect(() => {
    if (!documentId || Number.isNaN(documentId)) return;
    void migrateReaderLocalStorageForDocument(documentId);
  }, [documentId]);

  // Seed query from URL on first mount so deep-links like `?q=foo` work.
  useEffect(() => {
    if (hasSeededQueryFromUrlRef.current) return;
    hasSeededQueryFromUrlRef.current = true;
    const initialQuery = searchParams?.get('q') ?? '';
    if (initialQuery.trim()) {
      setSearchQuery(initialQuery);
      setOpenBottomPanel('search');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFontSizeChange = useCallback((size: FontSizeKey) => {
    setFontSize(size);
    void preferencesHook.update({ font_size: size });
  }, [preferencesHook]);

  const handleThemeChange = useCallback((theme: ReaderTheme) => {
    setReaderTheme(theme);
    void preferencesHook.update({ theme });
  }, [preferencesHook]);

  const handleTashkeelChange = useCallback((next: boolean) => {
    setTashkeelEnabled(next);
    void preferencesHook.update({ tashkeel_enabled: next });
  }, [preferencesHook]);

  const handleLetterSpacingChange = useCallback((value: number) => {
    setLetterSpacing(value);
    void preferencesHook.update({ letter_spacing: value });
  }, [preferencesHook]);

  const handleLineHeightChange = useCallback((value: number) => {
    setLineHeight(value);
    void preferencesHook.update({ line_height: value });
  }, [preferencesHook]);

  const handleFontWeightChange = useCallback((weight: FontWeightKey) => {
    setFontWeight(weight);
    void preferencesHook.update({ font_weight: weight });
  }, [preferencesHook]);

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
          setHighlightedPage(pageNumber);
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
          setHighlightedPage(pageNumber);
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
    void notesHook.add({
      document: documentId,
      page_number: visiblePageNum,
      paragraph_id: '',
      body: noteInput.trim(),
      tags: pendingNoteTags,
    });
    setNoteInput('');
    setPendingNoteTags([]);
  }, [noteInput, visiblePageNum, documentId, pendingNoteTags, notesHook]);

  const handleDeleteNote = useCallback(
    (id: string | number) => {
      // Only API-backed (numeric) IDs can be deleted server-side. Optimistic
      // entries created with negative temp IDs are also numeric, so this
      // catches both. Legacy string IDs from localStorage are no longer
      // present in the new data path.
      const numeric = typeof id === 'number' ? id : Number(id);
      if (Number.isNaN(numeric)) return;
      void notesHook.remove(numeric);
    },
    [notesHook]
  );

  const handleToggleCurrentBookmark = useCallback(() => {
    const existing = bookmarksHook.data.find((b) => b.page_number === visiblePageNum);
    if (existing) {
      void bookmarksHook.remove(existing.id);
    } else {
      void bookmarksHook.add({
        document: documentId,
        page_number: visiblePageNum,
        paragraph_id: '',
        label: '',
        tags: [],
      });
    }
  }, [bookmarksHook, documentId, visiblePageNum]);

  const handleRemoveBookmark = useCallback(
    (page: number) => {
      const target = bookmarksHook.data.find((b) => b.page_number === page);
      if (target) {
        void bookmarksHook.remove(target.id);
      }
    },
    [bookmarksHook]
  );

  const handleShareFromHero = useCallback(() => {
    const url = `${window.location.href.split('?')[0]}?page=${visiblePageNum}`;
    navigator.clipboard.writeText(url).catch(() => {
      // ignore clipboard failure silently
    });
  }, [visiblePageNum]);

  const handleStartReading = useCallback(() => {
    // Prefer the current page (from any previous session) if known; otherwise page 1.
    const target = visiblePageNum > 0 ? visiblePageNum : 1;
    const element = window.document.querySelector(`[data-page="${target}"]`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [visiblePageNum]);

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
    setNoteInput('');
    setPendingNoteTags([]);
    setBookmarkSelectedTags([]);
    setNoteSelectedTags([]);
    // Don't reset search query here; it may have been seeded from `?q=`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  // Save reading progress (Block D.1). The hook itself debounces 5s with
  // leading + trailing edges so we can fire eagerly on every visible-page
  // change without spamming the dedicated `reader_progress` throttle.
  useEffect(() => {
    if (!visiblePageNum || !totalPages) return;
    progressHook.save({
      last_page: visiblePageNum,
      percent_complete: visiblePageNum / totalPages,
      scroll_ratio: 0,
      last_paragraph_id: '',
    });
    // progressHook.save is a stable callback from the hook.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visiblePageNum, totalPages]);

  // Resume on document open (Block D.2). Fires once per document when pages
  // are loaded, no `?page=` URL override, and there is a saved last_page > 1.
  const [resumeToast, setResumeToast] = useState<{ page: number } | null>(null);
  const hasResumedRef = useRef(false);
  useEffect(() => {
    if (hasResumedRef.current) return;
    if (pages.length === 0) return;
    if (searchParams?.get('page')) {
      hasResumedRef.current = true;
      return;
    }
    const lastPage = progressHook.data?.last_page;
    if (!lastPage || lastPage <= 1) return;
    if (!pages.some((p) => p.page_number === lastPage)) return;
    hasResumedRef.current = true;
    handleGoToPage(lastPage);
    setResumeToast({ page: lastPage });
    const timer = window.setTimeout(() => setResumeToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [pages, progressHook.data, handleGoToPage, searchParams]);

  // Deep-link scroll (Block F.3). On first mount, parse `#h-{id}` or
  // `#p-{n}-{i}` and scroll the matching element into view once it renders.
  const hasDeepLinkedRef = useRef(false);
  useEffect(() => {
    if (hasDeepLinkedRef.current) return;
    if (pages.length === 0) return;
    const hash = window.location.hash;
    if (!hash) return;

    const highlightMatch = /^#h-(\d+)$/.exec(hash);
    const paragraphMatch = /^#p-(\d+)-(\d+)$/.exec(hash);

    let targetEl: HTMLElement | null = null;
    if (highlightMatch) {
      targetEl = window.document.querySelector<HTMLElement>(`mark[data-hid="${highlightMatch[1]}"]`);
    } else if (paragraphMatch) {
      const targetPage = parseInt(paragraphMatch[1], 10);
      if (pages.some((p) => p.page_number === targetPage)) {
        targetEl = window.document.querySelector<HTMLElement>(`[data-page="${targetPage}"]`);
      } else {
        // Page not loaded yet; jump there first and let the next render handle the pulse.
        handleGoToPage(targetPage);
        return;
      }
    } else {
      hasDeepLinkedRef.current = true;
      return;
    }

    if (targetEl) {
      hasDeepLinkedRef.current = true;
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      targetEl.classList.add('deep-link-pulse');
      window.setTimeout(() => targetEl?.classList.remove('deep-link-pulse'), 1500);
    }
  }, [pages, handleGoToPage]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();

      if ((event.ctrlKey || event.metaKey) && key === 'f') {
        event.preventDefault();
        setOpenBottomPanel('search');
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
          void preferencesHook.update({ theme: next });
          return next;
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [preferencesHook]);

  // Apply font size CSS variable and theme attribute
  useEffect(() => {
    const container = window.document.getElementById('document-scroll-container');
    if (container) {
      container.style.setProperty('--reader-font-size', FONT_SIZE_VALUES[fontSize]);
      container.style.setProperty('--reader-letter-spacing', `${letterSpacing}em`);
      container.style.setProperty('--reader-line-height', String(lineHeight));
      container.style.setProperty('--reader-font-weight', String(fontWeight));
      container.setAttribute('data-reader-theme', readerTheme);
    }
  }, [fontSize, readerTheme, letterSpacing, lineHeight, fontWeight]);

  // IntersectionObserver sentinel drives the hero -> compact header transition.
  useEffect(() => {
    if (isLoading || !document) return;
    const sentinel = heroSentinelRef.current;
    const scrollContainer = window.document.getElementById('document-scroll-container');
    if (!sentinel || !scrollContainer) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          // When sentinel leaves the viewport (scrolled past), collapse the hero.
          setIsHeroCollapsed(!entry.isIntersecting);
        });
      },
      {
        root: scrollContainer,
        threshold: 0,
      }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [isLoading, document]);

  // Clear highlighted page after the pulse animation duration so the same page
  // can be re-highlighted on a second click.
  useEffect(() => {
    if (highlightedPage == null) return;
    const timer = window.setTimeout(() => setHighlightedPage(null), 1600);
    return () => window.clearTimeout(timer);
  }, [highlightedPage]);

  if (isLoading || !document) {
    return (
      <RequireAuth>
        <div className="relative h-full min-h-0 flex flex-col overflow-hidden bg-gradient-to-b from-gray-100 to-slate-100">
          <div className="flex-1 min-h-0 overflow-y-auto pb-16">
            <DocumentHeroSkeleton />
            <div className="mx-auto max-w-5xl px-4 py-8 xl:max-w-6xl space-y-6">
              <DocumentPageSkeleton />
              <DocumentPageSkeleton />
              <DocumentPageSkeleton />
            </div>
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

  const isCurrentBookmarked = bookmarks.some((b) => b.page === visiblePageNum);

  return (
    <RequireAuth>
      <div className="relative h-full min-h-0 flex flex-col overflow-hidden bg-gradient-to-b from-gray-100 to-slate-100">
        <ReadingProgressBar currentPage={visiblePageNum} totalPages={totalPages} />

        <CompactReaderHeader
          document={document}
          currentPage={visiblePageNum}
          totalPages={totalPages}
          isVisible={isHeroCollapsed}
        />

        {resumeToast && (
          <div className="fixed bottom-24 start-1/2 z-[60] -translate-x-1/2 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white shadow-lg rtl:translate-x-1/2">
            <span className="me-3">
              {t('reader.resumedFromPage', 'Resumed from page {page}', { page: resumeToast.page })}
            </span>
            <button
              type="button"
              onClick={() => {
                handleGoToPage(1);
                setResumeToast(null);
              }}
              className="rounded-md bg-white/15 px-2 py-1 text-xs font-medium text-white hover:bg-white/25"
            >
              {t('reader.startOver', 'Start over')}
            </button>
          </div>
        )}

        <div
          className="flex-1 min-h-0 overflow-y-auto pb-16 relative"
          id="document-scroll-container"
          data-reader-theme={readerTheme}
          style={{
            '--reader-font-size': FONT_SIZE_VALUES[fontSize],
            '--reader-letter-spacing': `${letterSpacing}em`,
            '--reader-line-height': String(lineHeight),
            '--reader-font-weight': String(fontWeight),
          } as React.CSSProperties}
        >
          <DocumentHero
            document={document}
            currentPage={visiblePageNum}
            totalPages={totalPages}
            isBookmarked={isCurrentBookmarked}
            onStartReading={handleStartReading}
            onToggleBookmark={handleToggleCurrentBookmark}
            onShare={handleShareFromHero}
            onOpenInfo={() => setOpenBottomPanel('info')}
          />

          {/* Sentinel below the hero; IO watches this to flip the compact header. */}
          <div ref={heroSentinelRef} aria-hidden="true" className="h-px w-full" />

          <DocumentViewer
            pages={pages}
            isLoading={isLoadingMore}
            hasMore={hasMore}
            searchQuery={searchResults?.query || ''}
            onLoadMore={handleLoadMore}
            onPageVisible={setVisiblePageNum}
            onLoadFirstPage={fetchPreviousBatch}
            language={document.language}
            highlightedPage={highlightedPage}
            tashkeelEnabled={tashkeelEnabled}
            highlights={highlightsHook.data}
          />

          <SelectionPopover
            enabled
            onCreateHighlight={(payload) => {
              void highlightsHook.add({
                document: documentId,
                page_number: payload.page_number,
                paragraph_id: payload.paragraph_id,
                char_start: payload.char_start,
                char_end: payload.char_end,
                color: payload.color,
                note: '',
              });
            }}
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
          documentId={documentId}
          pendingNoteTags={pendingNoteTags}
          onPendingNoteTagsChange={setPendingNoteTags}
          noteSelectedTags={noteSelectedTags}
          onNoteSelectedTagsChange={setNoteSelectedTags}
          bookmarks={bookmarks}
          bookmarkSelectedTags={bookmarkSelectedTags}
          onBookmarkSelectedTagsChange={setBookmarkSelectedTags}
          onToggleCurrentBookmark={handleToggleCurrentBookmark}
          onRemoveBookmark={handleRemoveBookmark}
          currentPage={visiblePageNum}
          totalPages={totalPages}
          onGoToPage={handleGoToPage}
          fontSize={fontSize}
          theme={readerTheme}
          onFontSizeChange={handleFontSizeChange}
          onThemeChange={handleThemeChange}
          tashkeelEnabled={tashkeelEnabled}
          onTashkeelChange={handleTashkeelChange}
          letterSpacing={letterSpacing}
          onLetterSpacingChange={handleLetterSpacingChange}
          lineHeight={lineHeight}
          onLineHeightChange={handleLineHeightChange}
          fontWeight={fontWeight}
          onFontWeightChange={handleFontWeightChange}
          language={document.language}
          document={document}
          openPanel={openBottomPanel}
          onOpenPanelChange={setOpenBottomPanel}
        />
      </div>
    </RequireAuth>
  );
}
