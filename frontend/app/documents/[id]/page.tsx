'use client';

import { useState, useEffect, useCallback, useRef, useLayoutEffect, useMemo, type CSSProperties } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  getDocument,
  getDocumentPages,
  getDocumentsSearch,
  searchInDocument,
  QuotaExceededError,
  Document,
  DocumentPage as DocumentPageType,
  DocumentSearchMatch,
  DocumentSearchResponse,
  DocumentsListResponse,
} from '@/lib/api';
import DocumentViewer from '@/components/document/DocumentViewer';
import DocumentPdfViewer from '@/components/document/DocumentPdfViewer';
import DocumentPageSkeleton from '@/components/document/DocumentPageSkeleton';
import SelectionPopover from '@/components/document/SelectionPopover';
import SelectionContextMenu from '@/components/document/SelectionContextMenu';
import SimilarWordsModal from '@/components/document/SimilarWordsModal';
import AddNoteModal from '@/components/document/AddNoteModal';
import ReportErrorModal from '@/components/document/ReportErrorModal';
import HighlightTooltip from '@/components/document/HighlightTooltip';
import ReaderShell from '@/components/document/ReaderShell';
import ReaderHeader from '@/components/document/ReaderHeader';
import ReaderTOCColumn from '@/components/document/ReaderTOCColumn';
import ReaderAssistant from '@/components/document/ReaderAssistant';
import AdvancedSearchPanel from '@/components/document/AdvancedSearchPanel';
import ChapterTree from '@/components/document/ChapterTree';
import NotesToolPanel from '@/components/document/NotesToolPanel';
import ReadingStatsPanel from '@/components/document/ReadingStatsPanel';
import type { ReaderAssistantHandle } from '@/components/document/ReaderAssistant';
import { CopilotKit } from '@copilotkit/react-core';
import { useReaderCopilotSessions } from '@/lib/reader/useReaderCopilotSessions';
import { useChapters, findActiveChapter } from '@/lib/reader/useChapters';
import { useReadingStats } from '@/hooks/useReadingStats';
import { useReadingSession } from '@/hooks/useReadingSession';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import type { Bookmark, Note } from '@/components/document/readerToolsTypes';
import type { ReaderTheme, FontSizeKey } from '@/components/document/FontThemeControls';
import { FONT_SIZE_VALUES } from '@/components/document/FontThemeControls';
import RequireAuth from '@/components/RequireAuth';
import { useI18n } from '@/components/i18n/I18nProvider';
import { useBookmarks } from '@/lib/reader/useBookmarks';
import { useNotes } from '@/lib/reader/useNotes';
import { useHighlights } from '@/lib/reader/useHighlights';
import { useReaderPreferences } from '@/lib/reader/useReaderPreferences';
import { useReadingProgress } from '@/lib/reader/useReadingProgress';
import { migrateReaderLocalStorageForDocument } from '@/lib/reader/migrate';
import { computeSelectionPayload, type SelectionPayload } from '@/lib/reader/selection';
import { overlayMarking, resultKey, type SearchKindTab, type SearchScope, type SearchSort } from '@/lib/reader/searchPanelUtils';
import { useSearchTermStore } from '@/lib/reader/useSearchTermStore';
import { createCorrection, type HighlightColor } from '@/lib/api/reader';

const PAGE_BATCH_SIZE = 5;
const FONT_ORDER: FontSizeKey[] = ['small', 'medium', 'large'];
const THEME_CYCLE: ReaderTheme[] = ['light', 'sepia', 'dark'];

const AR_STOPWORDS = new Set([
  'على', 'من', 'في', 'عن', 'إلى', 'الذي', 'التي', 'وقد', 'هذا', 'هذه', 'ذلك',
  'كان', 'بين', 'كما', 'أن', 'إن', 'ما', 'لا', 'قد', 'هو', 'هي', 'به', 'له',
]);

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || element.isContentEditable;
}

export default function DocumentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const documentId = parseInt(params.id as string, 10);

  const [document, setDocument] = useState<Document | null>(null);
  const [pages, setPages] = useState<DocumentPageType[]>([]);
  const [totalPages, setTotalPages] = useState(0);

  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quotaError, setQuotaError] = useState<QuotaExceededError | null>(null);
  const [currentBatchPage, setCurrentBatchPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const hasMoreRef = useRef(hasMore);
  const isLoadingMoreRef = useRef(isLoadingMore);
  const isFetchingRef = useRef(false);
  const earliestBatchRef = useRef(1);
  const scrollAdjustRef = useRef<number | null>(null);
  const assistantRef = useRef<ReaderAssistantHandle | null>(null);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  useEffect(() => {
    isLoadingMoreRef.current = isLoadingMore;
  }, [isLoadingMore]);

  const [visiblePageNum, setVisiblePageNum] = useState(1);

  // Search v2: one `mode=all` request per query in book scope; the kind tab
  // and sort order slice that single result set client-side (no re-fetch).
  // Library scope swaps in the corpus endpoint instead.
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<DocumentSearchResponse | null>(null);
  const [libraryResults, setLibraryResults] = useState<DocumentsListResponse | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchScope, setSearchScope] = useState<SearchScope>('book');
  const [searchTab, setSearchTab] = useState<SearchKindTab>('all');
  const [searchSort, setSearchSort] = useState<SearchSort>('relevance');
  const [threshold, setThreshold] = useState(0.5);
  const [ignoreDiacritics, setIgnoreDiacritics] = useState(true);
  const [searchError, setSearchError] = useState<string | null>(null);
  /** The query whose results are on screen — drives in-sheet token marking. */
  const [executedQuery, setExecutedQuery] = useState('');
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const [highlightedPage, setHighlightedPage] = useState<number | null>(null);

  // Right-click selection context menu + its action modals.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; selection: SelectionPayload } | null>(null);
  const [similarWordsQuery, setSimilarWordsQuery] = useState<string | null>(null);
  const [noteTarget, setNoteTarget] = useState<SelectionPayload | null>(null);
  const [correctionTarget, setCorrectionTarget] = useState<SelectionPayload | null>(null);

  // One dark toast pill (bottom of the reading area) for copy/save/pin/export
  // feedback, auto-dismissed after ~1.9s.
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((message: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = setTimeout(() => setToast(null), 1900);
  }, []);
  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  // Side-panel layout: each panel is open/closable and pinned (docked) or
  // floating. Both panels start closed; the reader opens on the text alone and
  // the user reveals search (button / Ctrl+F) or the assistant on demand.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchPinned, setSearchPinned] = useState(true);
  // The AI assistant is now a floating drawer (see ReaderAssistant), so it has
  // no docked/pinned mode. `assistantOpen` is lifted here (above the nested
  // <CopilotKit> provider) so a session-switch remount doesn't close it.
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [immersive, setImmersive] = useState(false);

  // Reader assistant chat sessions (durable list/scope/pins in Django). Lives
  // above the nested provider so the active session (→ thread id) survives the
  // provider remount a session switch triggers.
  const chat = useReaderCopilotSessions(documentId);
  const activeThreadId =
    chat.activeSessionId != null ? `reader-${documentId}-${chat.activeSessionId}` : null;

  // Persist search-pin preference across reloads.
  const PIN_KEY = 'reader:panels';
  const hasHydratedPinsRef = useRef(false);
  useEffect(() => {
    if (hasHydratedPinsRef.current || typeof window === 'undefined') return;
    hasHydratedPinsRef.current = true;
    try {
      const raw = window.localStorage.getItem(PIN_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { searchPinned?: boolean };
      if (typeof parsed.searchPinned === 'boolean') setSearchPinned(parsed.searchPinned);
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(PIN_KEY, JSON.stringify({ searchPinned }));
    } catch {
      /* ignore */
    }
  }, [searchPinned]);

  // Below 1200px the side panels float as overlays (ReaderShell). A panel that
  // is "open" there covers the text, so don't leave search open by default on
  // narrow viewports — close it when we drop below desktop width.
  const isDesktop = useIsDesktop();
  useEffect(() => {
    if (!isDesktop) setSearchOpen(false);
  }, [isDesktop]);

  // Open helpers that keep the two floating panels mutually exclusive: when one
  // opens as an overlay (not a docked desktop column), close the other so they
  // don't stack at the same inline-start edge.
  const openSearch = useCallback(() => {
    setSearchOpen(true);
  }, []);
  // The assistant floats on the inline-end edge (its own overlay), independent
  // of the inline-start search panel, so opening it needs no mutual exclusion.
  const openAssistant = useCallback(() => {
    setAssistantOpen(true);
  }, []);
  const toggleSearch = useCallback(() => {
    if (searchOpen) setSearchOpen(false);
    else openSearch();
  }, [searchOpen, openSearch]);

  // Full-screen reading mode (native fullscreen + chrome hidden). Keep the
  // `immersive` flag in sync if the user exits native fullscreen via Esc.
  const toggleFullscreen = useCallback(() => {
    setImmersive((prev) => {
      const next = !prev;
      // The Fullscreen API rejects asynchronously (e.g. permission denied), so
      // swallow with .catch — the CSS-only immersive mode still applies.
      try {
        if (next) {
          window.document.documentElement.requestFullscreen?.()?.catch(() => {});
        } else if (window.document.fullscreenElement) {
          window.document.exitFullscreen?.()?.catch(() => {});
        }
      } catch {
        /* fullscreen API unavailable — fall back to the CSS-only mode */
      }
      return next;
    });
  }, []);
  useEffect(() => {
    const onFsChange = () => {
      if (!window.document.fullscreenElement) setImmersive(false);
    };
    window.document.addEventListener('fullscreenchange', onFsChange);
    return () => window.document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // API-backed reader resources.
  const bookmarksHook = useBookmarks(documentId);
  const notesHook = useNotes(documentId);
  const highlightsHook = useHighlights(documentId);
  // Latest `remove` in a ref so the delegated contextmenu listener stays stable.
  const removeHighlightRef = useRef(highlightsHook.remove);
  removeHighlightRef.current = highlightsHook.remove;
  const preferencesHook = useReaderPreferences();
  const progressHook = useReadingProgress(documentId);
  const chaptersHook = useChapters(documentId);
  // Search-panel term memory: recents in localStorage, pins in
  // ReaderPreference.extra (cross-device).
  const termStore = useSearchTermStore(documentId, preferencesHook);

  // «حفظ» on a result card creates a real Note (visible in the Notes tab);
  // toggling it off deletes that note. Session-scoped map resultKey → note id
  // (matching notes by body across reloads would be fragile).
  const [savedResultNotes, setSavedResultNotes] = useState<ReadonlyMap<string, number>>(new Map());
  const savedResultKeys = useMemo(() => new Set(savedResultNotes.keys()), [savedResultNotes]);
  const handleToggleSaveResult = useCallback(
    async (match: DocumentSearchMatch, citation: string) => {
      const key = resultKey(match);
      const existingNoteId = savedResultNotes.get(key);
      if (existingNoteId != null) {
        setSavedResultNotes((prev) => {
          const next = new Map(prev);
          next.delete(key);
          return next;
        });
        void notesHook.remove(existingNoteId);
        showToast(t('reader.search.unsavedToast', 'أُزيل من ملاحظاتك'));
        return;
      }
      try {
        const note = await notesHook.add({
          document: documentId,
          page_number: match.page_number,
          paragraph_id: '',
          body: citation,
          tags: ['بحث'],
        });
        setSavedResultNotes((prev) => new Map(prev).set(key, note.id));
        showToast(t('reader.search.savedToast', 'حُفظ في ملاحظاتك'));
      } catch {
        showToast(t('reader.search.saveFailed', 'تعذّر الحفظ'));
      }
    },
    [savedResultNotes, notesHook, documentId, showToast, t]
  );
  // Behavioral telemetry: measure active reading time / dwell for this book and
  // flush `reading_session` events to the backend (opens/searches/annotations
  // are captured server-side). Runs for the whole reading lifetime.
  useReadingSession(documentId, visiblePageNum, totalPages);

  // Right-click behavior inside the reader (highlights are injected via
  // dangerouslySetInnerHTML, so we use a delegated listener):
  //   • an active text selection → open the selection context menu
  //   • on a highlight with no selection → delete it (legacy behavior)
  //   • a plain word / whitespace → suppress the native menu, do nothing
  useEffect(() => {
    const handleContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      // Only act within the reader scroll area; elsewhere leave the native menu.
      if (!target?.closest?.('#document-scroll-container')) return;

      const selection = window.getSelection();
      const hasSelection = !!selection && !selection.isCollapsed && !!selection.toString().trim();
      if (hasSelection) {
        const payload = computeSelectionPayload();
        if (payload) {
          event.preventDefault();
          setCtxMenu({ x: event.clientX, y: event.clientY, selection: payload });
          return;
        }
      }

      const mark = target.closest?.('mark[data-hid]') as HTMLElement | null;
      if (mark) {
        const id = parseInt(mark.getAttribute('data-hid') ?? '', 10);
        if (Number.isFinite(id) && id > 0) {
          event.preventDefault();
          void removeHighlightRef.current(id);
        }
        return;
      }

      // Plain word / whitespace: suppress the native menu without acting.
      event.preventDefault();
    };
    window.document.addEventListener('contextmenu', handleContextMenu);
    return () => window.document.removeEventListener('contextmenu', handleContextMenu);
  }, []);

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
  const [noteSelectedTags, setNoteSelectedTags] = useState<string[]>([]);

  // Font & theme preferences.
  const [fontSize, setFontSize] = useState<FontSizeKey>('medium');
  const [readerTheme, setReaderTheme] = useState<ReaderTheme>('light');
  const [tashkeelEnabled, setTashkeelEnabled] = useState<boolean>(true);
  const [letterSpacing, setLetterSpacing] = useState<number>(0);
  const [lineHeight, setLineHeight] = useState<number>(1.8);
  const [fontWeight, setFontWeight] = useState<number>(400);

  const hasSeededQueryFromUrlRef = useRef(false);

  // Hydrate from server-side preferences once the API responds.
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
    setFontWeight(data.font_weight);
  }, [preferencesHook.data]);

  // Trigger Tier-2 per-document migration on mount.
  useEffect(() => {
    if (!documentId || Number.isNaN(documentId)) return;
    void migrateReaderLocalStorageForDocument(documentId);
  }, [documentId]);

  // Seed query from URL on first mount so deep-links like `?q=foo` work. When a
  // query is present, reveal the search panel so the seeded results are visible
  // — otherwise the panel stays closed (the reader opens on the text alone).
  useEffect(() => {
    if (hasSeededQueryFromUrlRef.current) return;
    hasSeededQueryFromUrlRef.current = true;
    const initialQuery = searchParams?.get('q') ?? '';
    if (initialQuery.trim()) {
      setSearchQuery(initialQuery);
      setSearchOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleThemeChange = useCallback((theme: ReaderTheme) => {
    setReaderTheme(theme);
    void preferencesHook.update({ theme });
  }, [preferencesHook]);

  const stepFont = useCallback((dir: 1 | -1) => {
    setFontSize((prev) => {
      const i = FONT_ORDER.indexOf(prev);
      const next = FONT_ORDER[Math.min(FONT_ORDER.length - 1, Math.max(0, i + dir))];
      if (next !== prev) void preferencesHook.update({ font_size: next });
      return next;
    });
  }, [preferencesHook]);

  // Continuous slider prefs (letter-spacing / line-height) fire an onChange for
  // every drag tick; persist them on a trailing debounce so a single drag emits
  // one PATCH instead of dozens (which waste requests and can resolve out of
  // order). Local state still updates immediately for a responsive preview.
  const prefPersistTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const persistPrefDebounced = useCallback(
    (key: string, payload: Parameters<typeof preferencesHook.update>[0]) => {
      const timers = prefPersistTimers.current;
      if (timers[key]) clearTimeout(timers[key]);
      timers[key] = setTimeout(() => {
        delete timers[key];
        void preferencesHook.update(payload);
      }, 400);
    },
    [preferencesHook],
  );
  useEffect(() => {
    const timers = prefPersistTimers.current;
    return () => {
      Object.values(timers).forEach((tid) => clearTimeout(tid));
    };
  }, []);

  // Advanced typography (diacritics / spacing / line-height / weight): update
  // local state and persist to the server prefs, mirroring theme/font-size.
  const handleTashkeelChange = useCallback((enabled: boolean) => {
    setTashkeelEnabled(enabled);
    void preferencesHook.update({ tashkeel_enabled: enabled });
  }, [preferencesHook]);
  const handleLetterSpacingChange = useCallback((value: number) => {
    setLetterSpacing(value);
    persistPrefDebounced('letter_spacing', { letter_spacing: value });
  }, [persistPrefDebounced]);
  const handleLineHeightChange = useCallback((value: number) => {
    setLineHeight(value);
    persistPrefDebounced('line_height', { line_height: value });
  }, [persistPrefDebounced]);
  const handleFontWeightChange = useCallback((value: number) => {
    setFontWeight(value);
    void preferencesHook.update({ font_weight: value });
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
        if (fetchError instanceof QuotaExceededError) {
          // Daily reading limit — must surface even mid-scroll, not just on
          // the initial batch, so the reader sees why loading stopped.
          setQuotaError(fetchError);
        } else if (resetArgs) {
          // Initial batch — nothing to read, so surface it as a page-level error.
          setError(fetchError instanceof Error ? fetchError.message : t('docs.errorLoading', 'Failed to load document'));
        } else {
          console.error('Error fetching pages:', fetchError);
        }
      } finally {
        setIsLoadingMore(false);
        isFetchingRef.current = false;
      }
    },
    [documentId, t]
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
      if (err instanceof QuotaExceededError) {
        setQuotaError(err);
      } else {
        console.error('Error fetching previous pages:', err);
      }
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
    async (query: string, scope: SearchScope, thresh: number, diacritics: boolean) => {
      if (searchAbortControllerRef.current) {
        searchAbortControllerRef.current.abort();
      }

      if (!query.trim()) {
        setSearchResults(null);
        setLibraryResults(null);
        setExecutedQuery('');
        setSearchError(null);
        setIsSearching(false);
        return;
      }

      const abortController = new AbortController();
      searchAbortControllerRef.current = abortController;

      setIsSearching(true);
      setSearchError(null);
      try {
        if (scope === 'book') {
          const results = await searchInDocument(documentId, query, {
            mode: 'all',
            threshold: thresh,
            ignoreDiacritics: diacritics,
            signal: abortController.signal,
          });
          if (!abortController.signal.aborted) {
            setSearchResults(results);
            setExecutedQuery(query.trim());
          }
        } else {
          const results = await getDocumentsSearch({ q: query.trim() }, { signal: abortController.signal });
          if (!abortController.signal.aborted) {
            setLibraryResults(results);
            setExecutedQuery(query.trim());
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        if (abortController.signal.aborted) return;
        console.error('Search error:', err);
        if (scope === 'book') {
          setSearchResults({ matches: [], total_matches: 0, query, mode: 'all' });
        } else {
          setLibraryResults({ count: 0, next: null, previous: null, results: [] });
        }
        setSearchError(err instanceof Error ? err.message : t('reader.search.error', 'تعذّر البحث'));
      } finally {
        if (!abortController.signal.aborted) {
          setIsSearching(false);
        }
      }
    },
    [documentId, t]
  );

  useEffect(() => {
    if (!searchQuery.trim()) {
      performSearch('', searchScope, threshold, ignoreDiacritics);
      return;
    }
    const timeout = window.setTimeout(() => {
      performSearch(searchQuery, searchScope, threshold, ignoreDiacritics);
    }, 350);
    return () => window.clearTimeout(timeout);
    // Tab and sort are deliberately NOT deps — they slice client-side.
  }, [searchQuery, searchScope, threshold, ignoreDiacritics, performSearch]);

  // A new query text starts back on the الكل tab.
  useEffect(() => {
    setSearchTab('all');
  }, [searchQuery]);

  // What the PDF overlay marks follows the selected kind tab: تام → only the
  // exact phrase, لفظي → only the backend-matched lexical tokens, دلالي →
  // nothing, الكل → both.
  const overlayMarks = useMemo(
    () => overlayMarking(searchResults?.matches ?? [], searchTab, executedQuery),
    [searchResults, searchTab, executedQuery]
  );

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
        if (jumpError instanceof QuotaExceededError) {
          setQuotaError(jumpError);
        } else {
          console.error('Failed to jump to page', jumpError);
        }
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

  // Search-from-text: clicking a word or searching a selection sets the query.
  // These are deliberate searches, so they also enter the recents MRU.
  const searchFor = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSearchQuery(trimmed);
    termStore.addRecent(trimmed);
    openSearch(); // reveal the panel so results are visible
  }, [openSearch, termStore]);

  // --- Selection context-menu actions ---------------------------------------
  // Side effects stay OUT of the setCtxMenu updater (updaters must be pure —
  // StrictMode invokes them twice). `ctxMenu` is a dependency, so the closure
  // always sees the current selection.
  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);

  const handleCtxSimilarWords = useCallback(() => {
    if (ctxMenu) setSimilarWordsQuery(ctxMenu.selection.text);
    setCtxMenu(null);
  }, [ctxMenu]);

  const handleCtxAddNote = useCallback(() => {
    if (ctxMenu) setNoteTarget(ctxMenu.selection);
    setCtxMenu(null);
  }, [ctxMenu]);

  const handleCtxReportError = useCallback(() => {
    if (ctxMenu) setCorrectionTarget(ctxMenu.selection);
    setCtxMenu(null);
  }, [ctxMenu]);

  const handleCtxCopy = useCallback(() => {
    const text = ctxMenu?.selection.text ?? '';
    setCtxMenu(null);
    if (!text) return;
    void navigator.clipboard
      ?.writeText(text)
      .then(() => showToast(t('reader.menu.copied', 'تم نسخ النص')))
      .catch(() => {});
  }, [ctxMenu, showToast, t]);

  const handleCtxTranslate = useCallback(
    (langLabel: string) => {
      const text = ctxMenu?.selection.text ?? '';
      setCtxMenu(null);
      if (!text.trim()) return;
      assistantRef.current?.ask(
        t('reader.menu.translatePrompt', 'ترجم النص التالي إلى {lang}:\n\n«{text}»', {
          lang: langLabel,
          text,
        })
      );
    },
    [ctxMenu, t]
  );

  const handleCtxSummarize = useCallback(() => {
    const text = ctxMenu?.selection.text ?? '';
    setCtxMenu(null);
    if (!text.trim()) return;
    assistantRef.current?.ask(
      t('reader.menu.summarizePrompt', 'لخّص النص التالي وبيّن أهم أفكاره:\n\n«{text}»', { text })
    );
  }, [ctxMenu, t]);

  const handleSaveNote = useCallback(
    (noteText: string, color: HighlightColor) => {
      if (!noteTarget) return;
      void highlightsHook.add({
        document: documentId,
        page_number: noteTarget.page_number,
        paragraph_id: noteTarget.paragraph_id,
        char_start: noteTarget.char_start,
        char_end: noteTarget.char_end,
        color,
        note: noteText,
      });
      setNoteTarget(null);
    },
    [noteTarget, highlightsHook, documentId]
  );

  const handleSubmitCorrection = useCallback(
    async (description: string, suggestedCorrection: string) => {
      if (!correctionTarget) return;
      await createCorrection({
        document: documentId,
        page_number: correctionTarget.page_number,
        paragraph_id: correctionTarget.paragraph_id,
        char_start: correctionTarget.char_start,
        char_end: correctionTarget.char_end,
        selected_text: correctionTarget.text,
        description,
        suggested_correction: suggestedCorrection,
      });
      // The modal shows a "thanks" state, then calls onClose to clear the target.
    },
    [correctionTarget, documentId]
  );

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
    setNoteInput('');
    setPendingNoteTags([]);
    setNoteSelectedTags([]);
    // Don't reset search query here; it may have been seeded from `?q=`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  // A document that is still being OCR'd has no pages yet (the endpoint 404s),
  // so pages are only fetched once processing has succeeded.
  const isDocumentReady = document
    ? (document.processing_status ? document.processing_status === 'succeeded' : document.processed)
    : false;
  const isDocumentFailed = document?.processing_status === 'failed';
  const isDocumentProcessing = !!document && !isDocumentReady && !isDocumentFailed;

  useEffect(() => {
    if (!isDocumentReady) return;
    fetchPagesBatch(1, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, isDocumentReady]);

  // Poll while processing so the reader opens itself when extraction finishes.
  useEffect(() => {
    if (!isDocumentProcessing) return;
    const timer = window.setInterval(() => {
      getDocument(documentId)
        .then(setDocument)
        .catch(() => { /* transient poll failure — retry next tick */ });
    }, 4000);
    return () => window.clearInterval(timer);
  }, [isDocumentProcessing, documentId]);

  // Save reading progress.
  useEffect(() => {
    if (!visiblePageNum || !totalPages) return;
    progressHook.save({
      last_page: visiblePageNum,
      percent_complete: visiblePageNum / totalPages,
      scroll_ratio: 0,
      last_paragraph_id: '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visiblePageNum, totalPages]);

  // Resume on document open.
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

  // Deep-link scroll (#h-{id} / #p-{n}-{i}).
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

  // Keyboard shortcuts: `t` cycles theme; Ctrl/Cmd+F and Ctrl/Cmd+K open the
  // in-document search panel (instead of the browser's native find, which only
  // sees the lazily-rendered pages) and focus its input.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();

      if ((event.ctrlKey || event.metaKey) && (key === 'f' || key === 'k')) {
        event.preventDefault();
        openSearch();
        setSearchFocusToken((token) => token + 1);
        return;
      }

      if (isEditableTarget(event.target)) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;

      if (key === 't') {
        event.preventDefault();
        setReaderTheme((prev) => {
          const next = THEME_CYCLE[(THEME_CYCLE.indexOf(prev) + 1) % THEME_CYCLE.length];
          void preferencesHook.update({ theme: next });
          return next;
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [preferencesHook, openSearch]);

  // Apply font/theme CSS variables + theme attribute on the scroll container.
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

  // Clear highlighted page after the pulse so it can re-highlight on re-click.
  useEffect(() => {
    if (highlightedPage == null) return;
    const timer = window.setTimeout(() => setHighlightedPage(null), 1600);
    return () => window.clearTimeout(timer);
  }, [highlightedPage]);

  const activeChapter = useMemo(
    () => findActiveChapter(chaptersHook.data, visiblePageNum),
    [chaptersHook.data, visiblePageNum]
  );

  // Printed-edition display (موافقة المطبوع): the currently visible page's
  // printed (volume, page) ref, and whether the edition is single-volume.
  const singleVolume = document?.editions?.[0]?.volume_count === 1;
  const visiblePrintedRef = useMemo(
    () => pages.find((p) => p.page_number === visiblePageNum)?.printed_ref ?? null,
    [pages, visiblePageNum]
  );

  const chapterTitleForPage = useCallback(
    (page: number) => findActiveChapter(chaptersHook.data, page)?.title ?? null,
    [chaptersHook.data]
  );

  // Suggested search words from the loaded pages (frequent meaningful terms).
  const suggestions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of pages) {
      for (const raw of (p.content || '').split(/\s+/)) {
        const w = raw.replace(/[^ء-ي]/g, '');
        if (w.length >= 4 && !AR_STOPWORDS.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([w]) => w);
  }, [pages]);

  if (quotaError) {
    return (
      <RequireAuth>
        <div className="reader-room flex min-h-screen items-center justify-center px-6">
          <div className="rounded-[16px] p-8 max-w-md w-full text-center" style={{ background: 'var(--rr-surface)', border: '1px solid var(--rr-line)' }}>
            <span className="inline-flex items-center gap-2.5 text-[11.5px] tracking-[0.16em] uppercase font-medium" style={{ color: 'var(--rr-brand, #b07d2b)' }}>
              <span className="w-6 h-[1px]" style={{ background: 'var(--rr-brand, #b07d2b)' }} aria-hidden />
              {t('reader.quota.eyebrow', 'بلغت الحد اليومي')}
            </span>
            <p className="mt-4 text-[14px] leading-relaxed" style={{ color: 'var(--rr-ink-2)' }}>
              {quotaError.quota === 'pages'
                ? t('reader.quota.pagesBody', 'لقد بلغت الحد الأقصى لعدد الصفحات التي يمكنك قراءتها اليوم.')
                : t('reader.quota.docsBody', 'لقد بلغت الحد الأقصى لعدد الكتب التي يمكنك فتحها اليوم.')}
            </p>
            <p className="mt-3 text-[14px] leading-relaxed font-medium" style={{ color: 'var(--rr-ink)' }}>
              {t('reader.quota.comeBack', 'عُد غدًا لمواصلة القراءة.')}
            </p>
          </div>
        </div>
      </RequireAuth>
    );
  }

  if (error) {
    return (
      <RequireAuth>
        <div className="reader-room flex min-h-screen items-center justify-center px-6">
          <div className="rounded-[16px] p-8 max-w-md w-full text-center" style={{ background: 'var(--rr-surface)', border: '1px solid var(--rr-line)' }}>
            <span className="inline-flex items-center gap-2.5 text-[11.5px] tracking-[0.16em] uppercase font-medium" style={{ color: '#9a3b2e' }}>
              <span className="w-6 h-[1px]" style={{ background: '#9a3b2e' }} aria-hidden />
              {t('reader.errorEyebrow', 'تعذّر التحميل')}
            </span>
            <p className="mt-4 text-[14px] leading-relaxed" style={{ color: 'var(--rr-ink-2)' }}>{error}</p>
          </div>
        </div>
      </RequireAuth>
    );
  }

  if (isLoading || !document) {
    return (
      <RequireAuth>
        <div className="reader-room relative h-full min-h-0 flex flex-col overflow-hidden">
          <div className="flex-1 min-h-0 overflow-y-auto pb-16" style={{ background: 'var(--rr-bg)' }}>
            <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
              <DocumentPageSkeleton />
              <DocumentPageSkeleton />
              <DocumentPageSkeleton />
            </div>
          </div>
        </div>
      </RequireAuth>
    );
  }

  if (isDocumentFailed || isDocumentProcessing) {
    return (
      <RequireAuth>
        <div className="reader-room flex min-h-screen items-center justify-center px-6">
          <div className="rounded-[16px] p-8 max-w-md w-full text-center" style={{ background: 'var(--rr-surface)', border: '1px solid var(--rr-line)' }}>
            {isDocumentFailed ? (
              <>
                <span className="inline-flex items-center gap-2.5 text-[11.5px] tracking-[0.16em] uppercase font-medium" style={{ color: '#9a3b2e' }}>
                  <span className="w-6 h-[1px]" style={{ background: '#9a3b2e' }} aria-hidden />
                  {t('reader.processingFailedEyebrow', 'فشلت المعالجة')}
                </span>
                <h1 className="mt-4 text-[18px] font-semibold" style={{ color: 'var(--rr-ink)' }}>{document.title}</h1>
                <p className="mt-3 text-[14px] leading-relaxed" style={{ color: 'var(--rr-ink-2)' }}>
                  {document.processing_error || t('reader.processingFailedBody', 'تعذّرت معالجة هذا الكتاب. حاول رفعه من جديد، أو تواصل معنا إذا تكرّرت المشكلة.')}
                </p>
              </>
            ) : (
              <>
                <span className="mx-auto block h-8 w-8 animate-spin rounded-full border-2 border-[#b07d2b] border-t-transparent" aria-hidden />
                <span className="mt-5 inline-flex items-center gap-2.5 text-[11.5px] tracking-[0.16em] uppercase font-medium" style={{ color: 'var(--rr-brand, #b07d2b)' }}>
                  <span className="w-6 h-[1px]" style={{ background: 'var(--rr-brand, #b07d2b)' }} aria-hidden />
                  {t('reader.processingEyebrow', 'قيد المعالجة')}
                </span>
                <h1 className="mt-4 text-[18px] font-semibold" style={{ color: 'var(--rr-ink)' }}>{document.title}</h1>
                <p className="mt-3 text-[14px] leading-relaxed" style={{ color: 'var(--rr-ink-2)' }}>
                  {t('reader.processingBody', 'يجري الآن استخراج نصوص الكتاب وتجهيز صفحاته. ستُفتح الصفحات تلقائيًا فور اكتمال المعالجة.')}
                </p>
              </>
            )}
          </div>
        </div>
      </RequireAuth>
    );
  }

  const isCurrentBookmarked = bookmarks.some((b) => b.page === visiblePageNum);
  const sheetTitle = activeChapter?.title ?? null;
  const sheetEyebrow = sheetTitle ? (document.categories?.[0]?.name ?? null) : null;
  // PDF-overlay books (uploaded PDF + OCR bounding boxes): the text layer is
  // sized/positioned from the geometry, so typography controls have no effect,
  // and chapters are never indexed for them — hide both.
  const isOverlay = !!document.has_layout;

  return (
    <RequireAuth>
      <ReaderShell
        header={
          <ReaderHeader
            document={document}
            currentPage={visiblePageNum}
            totalPages={totalPages}
            currentChapterTitle={activeChapter?.title ?? null}
            isBookmarked={isCurrentBookmarked}
            theme={readerTheme}
            onSetTheme={handleThemeChange}
            onFontDec={() => stepFont(-1)}
            onFontInc={() => stepFont(1)}
            onToggleBookmark={handleToggleCurrentBookmark}
            onOpenAssistant={openAssistant}
            onToggleSearch={toggleSearch}
            searchOpen={searchOpen}
            tashkeelEnabled={tashkeelEnabled}
            onTashkeelChange={handleTashkeelChange}
            letterSpacing={letterSpacing}
            onLetterSpacingChange={handleLetterSpacingChange}
            lineHeight={lineHeight}
            onLineHeightChange={handleLineHeightChange}
            fontWeight={fontWeight}
            onFontWeightChange={handleFontWeightChange}
            showTypography={!isOverlay}
            isFullscreen={immersive}
            onToggleFullscreen={toggleFullscreen}
          />
        }
        tocColumn={
          isOverlay ? null : (
            <ReaderTOCColumn
              document={document}
              currentPage={visiblePageNum}
              totalPages={totalPages}
              printedRef={visiblePrintedRef}
              chaptersContent={
                chaptersHook.data.length > 0 ? (
                  <div className="py-2">
                    <ChapterTree
                      chapters={chaptersHook.data}
                      activeChapterId={activeChapter?.id ?? null}
                      onSelect={handleGoToPage}
                    />
                  </div>
                ) : (
                  <p className="p-4 text-[13px] text-text-3">
                    {t('reader.toc.empty', 'No chapters indexed for this document yet.')}
                  </p>
                )
              }
              notesContent={
                <NotesToolPanel
                  notes={notes}
                  noteInput={noteInput}
                  currentPage={visiblePageNum}
                  documentId={documentId}
                  pendingNoteTags={pendingNoteTags}
                  selectedTags={noteSelectedTags}
                  onPendingNoteTagsChange={setPendingNoteTags}
                  onSelectedTagsChange={setNoteSelectedTags}
                  onNoteInputChange={setNoteInput}
                  onAddNote={handleAddNote}
                  onDeleteNote={handleDeleteNote}
                  onGoToPage={handleGoToPage}
                />
              }
              statsContent={<ReadingStatsTab documentId={documentId} currentPage={visiblePageNum} />}
            />
          )
        }
        searchColumn={
          <AdvancedSearchPanel
            query={searchQuery}
            scope={searchScope}
            tab={searchTab}
            sort={searchSort}
            threshold={threshold}
            ignoreDiacritics={ignoreDiacritics}
            results={searchResults}
            libraryResults={libraryResults}
            isSearching={isSearching}
            error={searchError}
            suggestions={suggestions}
            recentTerms={termStore.recents}
            pinnedTerms={termStore.pinned}
            bookTitle={document.title}
            savedKeys={savedResultKeys}
            focusToken={searchFocusToken}
            onQueryChange={setSearchQuery}
            onCommitQuery={termStore.addRecent}
            onScopeChange={setSearchScope}
            onTabChange={setSearchTab}
            onSortChange={setSearchSort}
            onThresholdChange={setThreshold}
            onDiacriticsChange={setIgnoreDiacritics}
            onClear={() => setSearchQuery('')}
            onGoToPage={(page) => {
              termStore.addRecent(searchQuery);
              void handleGoToPage(page);
            }}
            onOpenLibraryResult={(docId) =>
              router.push(`/documents/${docId}?q=${encodeURIComponent(searchQuery.trim())}`)
            }
            onPinTerm={termStore.pinTerm}
            onToggleSaveResult={(match, citation) => void handleToggleSaveResult(match, citation)}
            onToast={showToast}
            chapterTitleForPage={chapterTitleForPage}
            pinned={searchPinned}
            onTogglePin={() => setSearchPinned((v) => !v)}
            onClose={() => setSearchOpen(false)}
          />
        }
        search={{ open: searchOpen, pinned: searchPinned }}
        onCloseSearch={() => setSearchOpen(false)}
        fullscreen={immersive}
      >
        <div
          data-reader-theme={readerTheme}
          className="min-h-full"
          style={{
            '--reader-font-size': FONT_SIZE_VALUES[fontSize],
            '--reader-letter-spacing': `${letterSpacing}em`,
            '--reader-line-height': String(lineHeight),
            '--reader-font-weight': String(fontWeight),
          } as CSSProperties}
        >
          {document.has_layout ? (
            <DocumentPdfViewer
              pages={pages}
              isLoading={isLoadingMore}
              hasMore={hasMore}
              searchQuery={overlayMarks.query}
              searchTokensByPage={overlayMarks.tokensByPage}
              onLoadMore={handleLoadMore}
              onPageVisible={setVisiblePageNum}
              onLoadFirstPage={fetchPreviousBatch}
              language={document.language}
              highlightedPage={highlightedPage}
              highlights={highlightsHook.data}
              sheetTitle={sheetTitle}
              sheetEyebrow={sheetEyebrow}
              bookTitle={document.title}
              totalPages={totalPages}
              onWordSearch={searchFor}
              singleVolume={singleVolume}
            />
          ) : (
            <DocumentViewer
              pages={pages}
              isLoading={isLoadingMore}
              hasMore={hasMore}
              searchQuery={executedQuery}
              onLoadMore={handleLoadMore}
              onPageVisible={setVisiblePageNum}
              onLoadFirstPage={fetchPreviousBatch}
              language={document.language}
              highlightedPage={highlightedPage}
              tashkeelEnabled={tashkeelEnabled}
              highlights={highlightsHook.data}
              sheetTitle={sheetTitle}
              sheetEyebrow={sheetEyebrow}
              bookTitle={document.title}
              onWordSearch={searchFor}
              singleVolume={singleVolume}
            />
          )}

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
            onSearchSelection={searchFor}
            onAskAssistant={(text) => {
              const quoted = `> ${text}\n\n`;
              assistantRef.current?.setDraft(quoted);
            }}
          />

          <HighlightTooltip enabled />

          {/* Book-scoped AI assistant on the CopilotKit stack. Nested provider
              (agent="readerAgent") isolates its thread from the library
              assistant; keyed on the thread id so a session switch remounts and
              re-hydrates the transcript cleanly. Hidden in immersive mode. */}
          {!immersive && activeThreadId && chat.activeSessionId != null && (
            <CopilotKit
              key={activeThreadId}
              runtimeUrl="/api/copilotkit"
              agent="readerAgent"
              threadId={activeThreadId}
              showDevConsole={false}
            >
              <ReaderAssistant
                ref={assistantRef}
                documentId={documentId}
                documentTitle={document.title}
                sessionId={chat.activeSessionId}
                currentPage={visiblePageNum}
                open={assistantOpen}
                onOpenChange={setAssistantOpen}
                onCitationClick={handleGoToPage}
                sessions={chat.sessions}
                onSwitchSession={chat.switchSession}
                onNewSession={chat.startNewSession}
                onRenameSession={chat.renameSession}
                onDeleteSession={chat.deleteSession}
                contextScope={chat.contextScope}
                onContextScopeChange={chat.setContextScope}
                pins={chat.pins}
                onAddPin={chat.addPin}
                onRemovePin={chat.removePin}
                onClearPins={chat.clearPins}
                onTurnPersisted={chat.refreshSessions}
              />
            </CopilotKit>
          )}

          {ctxMenu && (
            <SelectionContextMenu
              x={ctxMenu.x}
              y={ctxMenu.y}
              onSimilarWords={handleCtxSimilarWords}
              onAddNote={handleCtxAddNote}
              onCopy={handleCtxCopy}
              onTranslate={handleCtxTranslate}
              onSummarize={handleCtxSummarize}
              onReportError={handleCtxReportError}
              onClose={closeCtxMenu}
            />
          )}
          {similarWordsQuery !== null && (
            <SimilarWordsModal
              query={similarWordsQuery}
              currentDocumentId={documentId}
              onClose={() => setSimilarWordsQuery(null)}
            />
          )}
          {noteTarget && (
            <AddNoteModal
              selectedText={noteTarget.text}
              onSave={handleSaveNote}
              onClose={() => setNoteTarget(null)}
            />
          )}
          {correctionTarget && (
            <ReportErrorModal
              selectedText={correctionTarget.text}
              onSubmit={handleSubmitCorrection}
              onClose={() => setCorrectionTarget(null)}
            />
          )}
          {toast && (
            <div
              className="fixed bottom-24 start-1/2 z-[80] inline-flex -translate-x-1/2 items-center gap-[9px] whitespace-nowrap rounded-xl px-[18px] py-[11px] text-[13px] font-semibold rtl:translate-x-1/2"
              style={{ background: '#2c2620', color: '#f4ecda', boxShadow: '0 12px 30px rgba(44,38,32,.4)' }}
              role="status"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#e9c77a" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M20 6L9 17l-5-5" />
              </svg>
              {toast}
            </div>
          )}
        </div>

        {resumeToast && (
          <div className="fixed bottom-24 start-1/2 z-[60] -translate-x-1/2 inline-flex items-center gap-3 rounded-full border border-accent/40 bg-bg/90 px-4 py-2 text-[13px] text-text shadow-[0_10px_30px_-10px_rgba(0,0,0,0.55)] backdrop-blur-md rtl:translate-x-1/2">
            <span className="flex items-center gap-2">
              <span className="text-accent" aria-hidden>✦</span>
              {t('reader.resumedFromPage', 'Resumed from page {page}', { page: resumeToast.page })}
            </span>
            <button
              type="button"
              onClick={() => {
                handleGoToPage(1);
                setResumeToast(null);
              }}
              className="rounded-full bg-accent-soft border border-accent/30 px-2.5 py-1 text-[11.5px] font-medium text-accent-2 hover:bg-accent/15 transition-colors"
            >
              {t('reader.startOver', 'Start over')}
            </button>
          </div>
        )}
      </ReaderShell>
    </RequireAuth>
  );
}

function ReadingStatsTab({ documentId, currentPage }: { documentId: number; currentPage: number }) {
  const { stats, resetStats } = useReadingStats(documentId, currentPage);
  return <ReadingStatsPanel stats={stats} onReset={resetStats} />;
}
