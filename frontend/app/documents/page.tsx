'use client';

import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { CorpusSearchMode, Document, DocumentsListParams, getDocument, getDocuments, getDocumentsSearch, postDocumentsSearchQuery, type AssistFilters, type CorpusQueryRequest, type CorpusQueryResponse, type DocumentsListResponse } from '@/lib/api';
import BookCard from '@/components/BookCard';
import BookListRow from '@/components/BookListRow';
import BookCardSkeleton from '@/components/BookCardSkeleton';
import RequireAuth from '@/components/RequireAuth';
import { useAuth } from '@/lib/AuthContext';
import RecommendedShelf from '@/components/documents/RecommendedShelf';
import BookSpine from '@/components/documents/BookSpine';
import FilterSidebar from '@/components/documents/FilterSidebar';
import ReadingRoomTopicBar from '@/components/documents/ReadingRoomTopicBar';
import LibraryAssistant from '@/components/documents/LibraryAssistant';
import { useAssistantDock } from '@/lib/documents/useAssistantDock';
import { useCopilotAction, useCopilotReadable } from '@copilotkit/react-core';
import ReaderPanel from '@/components/document/ReaderPanel';
import ShellHeader from '@/components/ShellHeader';
import { type SelectedBook } from '@/components/search/NavSearchPopover';
import SearchCommandPalette from '@/components/documents/SearchCommandPalette';
import { buildDocumentsSearchParams, type DocumentFilterValues } from '@/lib/documentsSearchParams';
import {
  getDocumentFilterPreference,
  updateDocumentFilterPreference,
  type SavedFilterPreset,
} from '@/lib/api/documentFilters';
import useFilterPresets from '@/hooks/useFilterPresets';
import type { CorpusFilterHandlers, CorpusFilterState, SelectedEntity } from '@/lib/search/useCorpusSearchState';
import {
  createSearchTerm,
  deserializeSearchTerm,
  serializeSearchTerm,
  MAX_SEARCH_TERMS,
  type SearchScopeType,
  type SearchTerm,
} from '@/lib/search/terms';
import { parseTerms } from '@/lib/search/termsUrl';
import useMediaQuery from '@/hooks/useMediaQuery';
import useDebounce from '@/hooks/useDebounce';
import { useI18n } from '@/components/i18n/I18nProvider';
import { useLanguageName } from '@/lib/i18n/languageName';
import { formatHijriCentury } from '@/lib/i18n/hijriCentury';
import { useLocalizedPath } from '@/lib/i18n/navigation';
import { useContinueReading } from '@/lib/reader/useContinueReading';
import { legendForDocuments } from '@/lib/coverPalettes';
import { toLocaleDigits } from '@/lib/utils';

const VIEW_KEY = 'ilm.documents.viewMode';
const PROGRESS_FETCH_LIMIT = 100;

type SortKey = 'relevance' | 'newest' | 'alphabetical' | 'shortest';
type ViewMode = 'grid' | 'list' | 'shelf';
type StatusSegment = 'all' | 'ready' | 'processing';

const SEARCH_INPUT_CLASS =
  'w-full ps-11 pe-3 py-3 rounded-[12px] text-[14.5px] outline-none transition-all bg-[#fcf8ee] text-[#2c2620] placeholder:text-[#9a8b70] border border-[#e2d5ba] focus:border-[#b07d2b] focus:shadow-[0_0_0_4px_rgba(176,125,43,0.10)]';

function UploadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function isDocReady(d: Document): boolean {
  return d.processing_status ? d.processing_status === 'succeeded' : d.processed;
}

interface PillProps {
  label: string;
  value: string;
  onRemove: () => void;
}
function ActiveChip({ label, value, onRemove }: PillProps) {
  return (
    <button
      onClick={onRemove}
      className="inline-flex items-center gap-1.5 px-3 py-1 text-[12px] bg-[rgba(176,125,43,0.12)] border border-[rgba(176,125,43,0.35)] text-[#8a6a23] rounded-full hover:border-[#b07d2b] hover:bg-[rgba(176,125,43,0.18)] transition-colors"
    >
      <span className="text-[#9a8b70]">{label}:</span>
      <span>{value}</span>
      <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  );
}

export default function DocumentsPage() {
  const { t, locale } = useI18n();
  const languageName = useLanguageName();
  const localizedPath = useLocalizedPath();
  const { user, isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const canUpload = !!user?.can_upload;

  // Library-assistant drawer layout (open / pinned / edge), persisted per user.
  // Owned here so the page can reflow its content when the panel is docked.
  const dock = useAssistantDock();
  // Below this width the 400px panel is effectively full-width, so docking has
  // no room — treat pinned as floating (no reflow) there.
  const canDock = useMediaQuery('(min-width: 768px)', false);
  const docked = dock.pinned && dock.open && canDock;

  /* ─── Query state ─── */
  const [searchQuery, setSearchQuery] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [refineText, setRefineText] = useState('');
  const [refineDraft, setRefineDraft] = useState('');
  const [refineOpen, setRefineOpen] = useState(false);

  const [selectedAuthors, setSelectedAuthors] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const [selectedDeathCenturies, setSelectedDeathCenturies] = useState<number[]>([]);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [selectedMadhhabs, setSelectedMadhhabs] = useState<string[]>([]);
  const [selectedEraCenturies, setSelectedEraCenturies] = useState<number[]>([]);
  const [selectedPhysicalClasses, setSelectedPhysicalClasses] = useState<string[]>([]);
  const [selectedPersons, setSelectedPersons] = useState<SelectedEntity[]>([]);
  const [selectedPlaces, setSelectedPlaces] = useState<SelectedEntity[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [sort, setSort] = useState<SortKey>('relevance');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [statusSegment, setStatusSegment] = useState<StatusSegment>('all');

  /* ─── Corpus search (mode + scope + book scope + term rows) + popover ─── */
  const [searchMode, setSearchMode] = useState<CorpusSearchMode>('hybrid');
  const [searchScope, setSearchScope] = useState<SearchScopeType>('all');
  const [searchTerms, setSearchTerms] = useState<SearchTerm[]>([]);
  const [selectedBooks, setSelectedBooks] = useState<SelectedBook[]>([]);
  const [popoverOpen, setPopoverOpen] = useState(false);
  // The AI's one-line reading of the last natural-language query, shown as a
  // dismissible chip above the results until the filters change by any other
  // path (manual search, sidebar edit, preset, chip removal, clear).
  const [assistInterpretation, setAssistInterpretation] = useState<string | null>(null);
  // Set by applyAssistFilters so its own filter mutation doesn't trip the
  // "filters changed → drop the stale interpretation" effect below.
  const assistJustAppliedRef = useRef(false);

  /* ─── Layout state ─── */
  const [filtersOpen, setFiltersOpen] = useState(false);
  const isDesktop = useMediaQuery('(min-width: 1024px)', true);

  /* ─── Data state ─── */
  const [accumulated, setAccumulated] = useState<Document[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ─── URL state sync (search, filters, sort, status, view) ─── */
  const restoredRef = useRef(false);
  // Did the URL carry any *filter* param at mount? If so it wins over the
  // backend-saved preference (deep links / shared URLs stay authoritative).
  const hadUrlFiltersRef = useRef(false);

  // Apply a bag of filter values — from the URL, the saved preference, or a
  // named preset — to the live filter state. Deliberately excludes
  // sort/status/view, which stay display-only prefs owned by the URL.
  const applyFilterState = useCallback((state: DocumentFilterValues) => {
    const q = state.q ?? '';
    setSearchQuery(q);
    setSearchDraft(q);
    const refine = state.refine ?? '';
    setRefineText(refine);
    setRefineDraft(refine);
    setSelectedAuthors(state.authors ?? []);
    setSelectedCategories(state.categories ?? []);
    setSelectedLanguages(state.languages ?? []);
    // Newer keys — old presets/preferences/URLs may lack them entirely.
    setSelectedCountries(state.countries ?? []);
    setSelectedDeathCenturies(
      (state.deathCenturies ?? []).filter((c) => Number.isInteger(c) && c > 0),
    );
    setSelectedGenres(state.genres ?? []);
    setSelectedMadhhabs(state.madhhabs ?? []);
    setSelectedEraCenturies(
      (state.eraCenturies ?? []).filter((c) => Number.isInteger(c) && c >= 1 && c <= 15),
    );
    setSelectedPhysicalClasses(state.physicalClasses ?? []);
    setSelectedPersons(
      (state.persons ?? []).filter((n) => Number.isInteger(n) && n > 0).map((id) => ({ id, label: '#' + id })),
    );
    setSelectedPlaces(
      (state.places ?? []).filter((n) => Number.isInteger(n) && n > 0).map((id) => ({ id, label: '#' + id })),
    );
    setDateFrom(state.dateFrom ?? '');
    setDateTo(state.dateTo ?? '');
    const m = state.mode;
    setSearchMode(m === 'exact' || m === 'semantic' || m === 'hybrid' ? m : 'hybrid');
    setSearchTerms(
      (state.terms ?? [])
        .map(deserializeSearchTerm)
        .filter((term): term is SearchTerm => term !== null),
    );
    // `documents` is id-based: resolve each id to its title via getDocument().
    // allSettled so one deleted/invalid id doesn't drop the rest; result order
    // follows the input order.
    const docIds = (state.documents ?? []).filter((n) => Number.isInteger(n) && n > 0);
    // Scope: an explicit book set implies `selected` (v1 blobs lack `scope`);
    // otherwise honor a persisted `mine`, defaulting to `all`.
    setSearchScope(docIds.length > 0 ? 'selected' : state.scope === 'mine' ? 'mine' : 'all');
    if (docIds.length === 0) {
      setSelectedBooks([]);
    } else {
      Promise.allSettled(docIds.map((id) => getDocument(id))).then((settled) => {
        const books: SelectedBook[] = [];
        for (const r of settled) {
          if (r.status === 'fulfilled') books.push({ id: r.value.id, title: r.value.title });
        }
        setSelectedBooks(books);
      });
    }
  }, []);

  // Apply the AI-parsed natural-language filters (replace semantics — a fresh
  // query defines the whole filter set) and surface the assistant's one-line
  // interpretation. Reuses applyFilterState (the same path presets / URL-restore
  // use). AssistFilters date bounds are string|null; applyFilterState expects
  // string|undefined, so normalise here.
  const applyAssistFilters = useCallback(
    (filters: AssistFilters, interpretation: string | null) => {
      assistJustAppliedRef.current = true;
      const preservedBooks = selectedBooks;
      const preservedScope = searchScope;
      applyFilterState({
        ...filters,
        terms: filters.terms?.map((row) => ({ ...row, diacritics: 'ignore' as const })),
        dateFrom: filters.dateFrom ?? undefined,
        dateTo: filters.dateTo ?? undefined,
      });
      // The assistant parses corpus filters only and can't express an explicit
      // book/ownership scope, so applyFilterState would clear them — restore
      // the user's selection (same array ref, so no refetch). `refine`
      // intentionally resets: a fresh natural-language query supersedes the
      // old refinement.
      if (preservedBooks.length) setSelectedBooks(preservedBooks);
      // An explicit assist «كتبي» wins; otherwise the user's scope survives.
      if (filters.scope !== 'mine' && preservedScope !== 'all') {
        setSearchScope(preservedBooks.length ? 'selected' : preservedScope);
      }
      setAssistInterpretation(interpretation);
    },
    [applyFilterState, selectedBooks, searchScope],
  );

  const applyFromUrl = useCallback((search: string) => {
    const p = new URLSearchParams(search);
    const parseList = (key: string) => {
      const v = p.get(key);
      return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
    };
    // Filter fields are shared with saved preferences/presets, so route them
    // through applyFilterState. `documents=` is id-based, so parse to numbers.
    const m = p.get('mode');
    applyFilterState({
      q: p.get('q') ?? '',
      refine: p.get('refine') ?? '',
      mode: m === 'exact' || m === 'semantic' || m === 'hybrid' ? m : undefined,
      scope: p.get('scope') === 'mine' ? 'mine' : undefined,
      terms: parseTerms(p.getAll('t')),
      documents: parseList('documents').map((s) => Number(s)),
      authors: parseList('authors'),
      categories: parseList('categories'),
      languages: parseList('languages'),
      countries: parseList('countries'),
      deathCenturies: parseList('death_centuries').map((s) => Number(s)),
      genres: parseList('genre'),
      madhhabs: parseList('madhhab'),
      eraCenturies: parseList('era_centuries').map((s) => Number(s)),
      physicalClasses: parseList('physical_class'),
      persons: parseList('persons').map((s) => Number(s)),
      places: parseList('places').map((s) => Number(s)),
      dateFrom: p.get('date_from') ?? '',
      dateTo: p.get('date_to') ?? '',
    });
    // sort / status / view are display-only prefs, handled directly here.
    const s = p.get('sort');
    setSort(s === 'newest' || s === 'alphabetical' || s === 'shortest' ? s : 'relevance');
    const st = p.get('status');
    setStatusSegment(st === 'ready' || st === 'processing' ? st : 'all');
    const v = p.get('view');
    if (v === 'list' || v === 'grid' || v === 'shelf') setViewMode(v);
  }, [applyFilterState]);

  // Restore state from URL (and view preference from localStorage) on mount.
  // `restoredRef` is intentionally NOT flipped here — the backend-restore
  // effect below owns that, so the URL-mirror/PATCH effect stays gated until
  // the saved preference has had its chance to load (see that effect).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const savedView = window.localStorage.getItem(VIEW_KEY);
    if (savedView === 'list' || savedView === 'grid' || savedView === 'shelf') {
      setViewMode(savedView);
    }
    // Record whether the URL specified any *filter* param (sort/status/view
    // don't count) — if so it takes precedence over the saved preference.
    const p = new URLSearchParams(window.location.search);
    const FILTER_PARAMS = ['q', 'refine', 'authors', 'categories', 'languages', 'countries', 'death_centuries', 'genre', 'madhhab', 'era_centuries', 'physical_class', 'persons', 'places', 'date_from', 'date_to', 'documents', 'mode', 'scope', 't'];
    hadUrlFiltersRef.current = FILTER_PARAMS.some((key) => p.has(key));
    applyFromUrl(window.location.search);
  }, [applyFromUrl]);

  // Re-apply state on browser back/forward.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPop = () => applyFromUrl(window.location.search);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [applyFromUrl]);

  // One-time restore of the user's backend-saved filter preference. It waits
  // for auth to resolve, then either applies the fetched preference or bails
  // (unauthenticated, or the URL already carried filters). Crucially it only
  // flips `restoredRef` AFTER that resolves — this is what un-gates the
  // URL-mirror/PATCH effect below, so an empty pre-restore state can never be
  // PATCHed over the preference we just fetched.
  const backendRestoreAttemptedRef = useRef(false);
  useEffect(() => {
    if (typeof window === 'undefined' || backendRestoreAttemptedRef.current) return;
    if (isAuthLoading) return;
    backendRestoreAttemptedRef.current = true;
    if (!isAuthenticated || hadUrlFiltersRef.current) {
      restoredRef.current = true;
      return;
    }
    getDocumentFilterPreference()
      .then((filters) => { if (filters) applyFilterState(filters); })
      .catch(() => {})
      .finally(() => { restoredRef.current = true; });
  }, [isAuthLoading, isAuthenticated, applyFilterState]);

  // Mirror all filter/view state into the URL (replaceState — no history spam)
  // and, when authenticated, debounce-PATCH the filter subset to the backend.
  useEffect(() => {
    if (typeof window === 'undefined' || !restoredRef.current) return;
    const params = buildDocumentsSearchParams({
      q: searchQuery,
      refine: refineText,
      mode: searchMode,
      scope: searchScope,
      terms: searchTerms.map(serializeSearchTerm),
      documents: selectedBooks.map((b) => b.id),
      authors: selectedAuthors,
      categories: selectedCategories,
      languages: selectedLanguages,
      countries: selectedCountries,
      deathCenturies: selectedDeathCenturies,
      genres: selectedGenres,
      madhhabs: selectedMadhhabs,
      eraCenturies: selectedEraCenturies,
      physicalClasses: selectedPhysicalClasses,
      persons: selectedPersons.map((p) => p.id),
      places: selectedPlaces.map((p) => p.id),
      dateFrom,
      dateTo,
      sort,
      status: statusSegment,
      view: viewMode,
    });
    const qs = params.toString();
    const url = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
    window.history.replaceState(null, '', url);

    // Persist the filter subset (never sort/status/view) for signed-in users,
    // debounced so rapid edits collapse into a single PATCH.
    if (!isAuthenticated) return;
    const filterValues: DocumentFilterValues = {
      version: 2,
      q: searchQuery,
      refine: refineText,
      mode: searchMode,
      scope: searchScope,
      terms: searchTerms.map(serializeSearchTerm),
      documents: selectedBooks.map((b) => b.id),
      authors: selectedAuthors,
      categories: selectedCategories,
      languages: selectedLanguages,
      countries: selectedCountries,
      deathCenturies: selectedDeathCenturies,
      genres: selectedGenres,
      madhhabs: selectedMadhhabs,
      eraCenturies: selectedEraCenturies,
      physicalClasses: selectedPhysicalClasses,
      persons: selectedPersons.map((p) => p.id),
      places: selectedPlaces.map((p) => p.id),
      dateFrom,
      dateTo,
    };
    const timer = window.setTimeout(() => {
      updateDocumentFilterPreference(filterValues).catch(() => {});
    }, 600);
    return () => window.clearTimeout(timer);
  }, [
    searchQuery,
    refineText,
    searchMode,
    searchScope,
    searchTerms,
    selectedBooks,
    selectedAuthors,
    selectedCategories,
    selectedLanguages,
    selectedCountries,
    selectedDeathCenturies,
    selectedGenres,
    selectedMadhhabs,
    selectedEraCenturies,
    selectedPhysicalClasses,
    selectedPersons,
    selectedPlaces,
    dateFrom,
    dateTo,
    sort,
    statusSegment,
    viewMode,
    isAuthenticated,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(VIEW_KEY, viewMode);
  }, [viewMode]);

  const effectiveSearch = useMemo(() => {
    return [searchQuery, refineText].map((s) => s.trim()).filter(Boolean).join(' ');
  }, [searchQuery, refineText]);

  // An active query (free text or term rows) keeps the reader on this same
  // Reading Room page and simply filters the grid in place (rather than
  // swapping in a separate layout).
  const isSearching =
    Boolean(effectiveSearch.trim()) || searchTerms.some((t) => t.text.trim());

  const debouncedEffective = useDebounce(effectiveSearch, 350);

  const resetKey = JSON.stringify({
    debouncedEffective,
    searchMode,
    searchScope,
    searchTerms: searchTerms.map(serializeSearchTerm),
    selectedBooks,
    selectedAuthors,
    selectedCategories,
    selectedLanguages,
    selectedCountries,
    selectedDeathCenturies,
    selectedGenres,
    selectedMadhhabs,
    selectedEraCenturies,
    selectedPhysicalClasses,
    selectedPersons,
    selectedPlaces,
    dateFrom,
    dateTo,
  });

  const requestSeq = useRef(0);
  useEffect(() => {
    const seq = ++requestSeq.current;
    const append = currentPage > 1;
    if (append) setIsLoadingMore(true);
    else setIsLoading(true);
    setError(null);

    // Routing: term rows (with ≥1 positive condition) → the structured POST
    // executor; a plain query → the ES-backed GET corpus search; nothing →
    // plain browsing (getDocuments).
    const validTerms = searchTerms.filter((t) => t.text.trim());
    const hasPositiveTerm =
      validTerms.some((t) => t.op !== 'must_not') || Boolean(debouncedEffective);
    let request: Promise<DocumentsListResponse | CorpusQueryResponse>;
    if (validTerms.length > 0 && hasPositiveTerm) {
      const bodyTerms = validTerms.map(serializeSearchTerm) as CorpusQueryRequest['terms'];
      // The header input stays live alongside the builder: its text joins as
      // an implicit must/fuzzy row (the same shape the plain GET search runs).
      if (debouncedEffective && bodyTerms.length < MAX_SEARCH_TERMS) {
        bodyTerms.push({
          text: debouncedEffective,
          match: 'fuzzy',
          fuzziness: 'AUTO',
          diacritics: 'ignore',
          op: 'must',
        });
      }
      request = postDocumentsSearchQuery({
        version: 1,
        terms: bodyTerms,
        scope:
          searchScope === 'mine'
            ? { type: 'mine' }
            : selectedBooks.length > 0
              ? { type: 'selected', ids: selectedBooks.map((b) => b.id) }
              : { type: 'all' },
        filters: {
          authors: selectedAuthors,
          categories: selectedCategories,
          languages: selectedLanguages,
          countries: selectedCountries,
          death_centuries: selectedDeathCenturies,
          genre: selectedGenres.length > 0 ? selectedGenres : undefined,
          madhhab: selectedMadhhabs.length > 0 ? selectedMadhhabs : undefined,
          era_centuries: selectedEraCenturies.length > 0 ? selectedEraCenturies : undefined,
          physical_class: selectedPhysicalClasses.length > 0 ? selectedPhysicalClasses : undefined,
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          ...(selectedPersons.length > 0 || selectedPlaces.length > 0 ? {
            facets: {
              ...(selectedPersons.length > 0 && { person_keys: selectedPersons.map((p) => 'p:' + p.id) }),
              ...(selectedPlaces.length > 0 && { place_keys: selectedPlaces.map((p) => 'pl:' + p.id) }),
            },
          } : {}),
        },
        mode: searchMode,
        page: currentPage,
      });
    } else if (debouncedEffective) {
      request = getDocumentsSearch({
        q: debouncedEffective,
        mode: searchMode,
        scope: searchScope,
        documents: selectedBooks.map((b) => b.id),
        authors: selectedAuthors,
        categories: selectedCategories,
        languages: selectedLanguages,
        countries: selectedCountries,
        death_centuries: selectedDeathCenturies,
        genre: selectedGenres,
        madhhab: selectedMadhhabs,
        era_centuries: selectedEraCenturies,
        physical_class: selectedPhysicalClasses,
        persons: selectedPersons.map((p) => p.id),
        places: selectedPlaces.map((p) => p.id),
        date_from: dateFrom,
        date_to: dateTo,
        page: currentPage,
      });
    } else {
      const params: DocumentsListParams = { page: currentPage };
      if (searchScope === 'mine') params.scope = 'mine';
      if (selectedAuthors.length > 0) params.authors = selectedAuthors;
      if (selectedCategories.length > 0) params.categories = selectedCategories;
      if (selectedBooks.length > 0) params.documents = selectedBooks.map((b) => b.id);
      if (selectedLanguages.length > 0) params.languages = selectedLanguages;
      if (selectedCountries.length > 0) params.countries = selectedCountries;
      if (selectedDeathCenturies.length > 0) params.death_centuries = selectedDeathCenturies;
      if (selectedGenres.length > 0) params.genre = selectedGenres;
      if (selectedMadhhabs.length > 0) params.madhhab = selectedMadhhabs;
      if (selectedEraCenturies.length > 0) params.era_centuries = selectedEraCenturies;
      if (selectedPhysicalClasses.length > 0) params.physical_class = selectedPhysicalClasses;
      if (selectedPersons.length > 0) params.persons = selectedPersons.map((p) => p.id);
      if (selectedPlaces.length > 0) params.places = selectedPlaces.map((p) => p.id);
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      request = getDocuments(params);
    }

    request
      .then((response) => {
        if (seq !== requestSeq.current) return;
        setTotalCount(response.count);
        setHasNext(Boolean(response.next));
        setAccumulated((prev) => (append ? [...prev, ...response.results] : response.results));
      })
      .catch((err: unknown) => {
        if (seq !== requestSeq.current) return;
        setError(err instanceof Error ? err.message : t('docs.errorLoading', 'حدث خطأ أثناء تحميل الكتب'));
        if (!append) setAccumulated([]);
      })
      .finally(() => {
        if (seq !== requestSeq.current) return;
        setIsLoading(false);
        setIsLoadingMore(false);
      });
  }, [currentPage, debouncedEffective, searchMode, searchScope, searchTerms, selectedBooks, selectedAuthors, selectedCategories, selectedLanguages, selectedCountries, selectedDeathCenturies, selectedGenres, selectedMadhhabs, selectedEraCenturies, selectedPhysicalClasses, selectedPersons, selectedPlaces, dateFrom, dateTo, t]);

  useEffect(() => {
    setCurrentPage(1);
  }, [resetKey]);

  const retry = useCallback(() => {
    requestSeq.current++;
    setCurrentPage(1);
  }, []);

  /* ─── Reading progress map (only docs with progress are returned) ─── */
  const { data: continueData } = useContinueReading(PROGRESS_FETCH_LIMIT);
  const progressByDoc = useMemo(() => {
    const m = new Map<number, number>();
    for (const it of continueData ?? []) {
      m.set(it.document, Math.max(0, Math.min(100, Math.round((it.percent_complete ?? 0) * 100))));
    }
    return m;
  }, [continueData]);

  // Languages are still derived locally from loaded documents. Authors and
  // categories are handled by FacetTypeahead, which queries the whole DB
  // server-side (so options aren't limited to the loaded pages).
  const facetValues = useMemo(() => {
    const languages = new Map<string, number>();
    for (const d of accumulated) {
      if (d.language) languages.set(d.language, (languages.get(d.language) ?? 0) + 1);
    }
    const byCount = (a: [string, number], b: [string, number]) => b[1] - a[1];
    return {
      languages: [...languages.entries()].sort(byCount).map(([k]) => k),
    };
  }, [accumulated]);

  const legend = useMemo(() => legendForDocuments(accumulated), [accumulated]);

  const statusCounts = useMemo(() => {
    let ready = 0;
    let processing = 0;
    for (const d of accumulated) {
      if (isDocReady(d)) ready++;
      else processing++;
    }
    return { ready, processing };
  }, [accumulated]);

  const filteredSorted = useMemo(() => {
    const sorted = [...accumulated];
    switch (sort) {
      case 'newest':
        sorted.sort((a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime());
        break;
      case 'alphabetical':
        sorted.sort((a, b) => a.title.localeCompare(b.title, locale));
        break;
      case 'shortest':
        sorted.sort((a, b) => (a.content?.length ?? Infinity) - (b.content?.length ?? Infinity));
        break;
      case 'relevance':
      default:
        break;
    }
    return sorted;
  }, [accumulated, sort, locale]);

  /* ─── Grouping / segment derivation ─── */
  // A search shows a single flat "results" list — no Continue shelf / picks framing.
  const grouped = statusSegment === 'all' && viewMode !== 'shelf' && !isSearching;
  const flatDocs = useMemo(() => {
    if (statusSegment === 'all') return filteredSorted;
    const wantReady = statusSegment === 'ready';
    return filteredSorted.filter((d) => isDocReady(d) === wantReady);
  }, [filteredSorted, statusSegment]);
  const processingDocs = useMemo(() => filteredSorted.filter((d) => !isDocReady(d)), [filteredSorted]);
  const readyDocs = useMemo(() => filteredSorted.filter(isDocReady), [filteredSorted]);

  const shownCount = grouped ? filteredSorted.length : flatDocs.length;

  const toggleIn = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  // Shared toggle callbacks, reused by both FilterSidebar and NavSearchPopover.
  const handleToggleCategory = (v: string) => setSelectedCategories((prev) => toggleIn(prev, v));
  const handleToggleAuthor = (v: string) => setSelectedAuthors((prev) => toggleIn(prev, v));
  const handleToggleBook = (book: SelectedBook) =>
    setSelectedBooks((prev) =>
      prev.some((b) => b.id === book.id) ? prev.filter((b) => b.id !== book.id) : [...prev, book],
    );

  const clearFilters = () => {
    setSearchQuery('');
    setSearchDraft('');
    setRefineText('');
    setRefineDraft('');
    setSearchMode('hybrid');
    setSearchScope('all');
    setSearchTerms([]);
    setSelectedBooks([]);
    setSelectedAuthors([]);
    setSelectedCategories([]);
    setSelectedLanguages([]);
    setSelectedCountries([]);
    setSelectedDeathCenturies([]);
    setSelectedGenres([]);
    setSelectedMadhhabs([]);
    setSelectedEraCenturies([]);
    setSelectedPhysicalClasses([]);
    setSelectedPersons([]);
    setSelectedPlaces([]);
    setDateFrom('');
    setDateTo('');
    setAssistInterpretation(null);
  };

  // Books ⇄ scope invariant: an explicit book selection means `selected`;
  // losing the last book leaves `selected` meaningless, so fall back to `all`.
  // Runs regardless of which path mutated the books (console toggle, chip
  // removal, async id→title resolution in applyFilterState).
  useEffect(() => {
    if (selectedBooks.length > 0 && searchScope !== 'selected') {
      setSearchScope('selected');
    } else if (selectedBooks.length === 0 && searchScope === 'selected') {
      setSearchScope('all');
    }
  }, [selectedBooks, searchScope]);

  // Adapt this page's lifted filter state onto the search console's
  // `{filters, handlers}` contract — the page stays the single state owner
  // (URL mirror / preference PATCH / popstate all untouched).
  const consoleFilters = useMemo<CorpusFilterState>(() => ({
    mode: searchMode,
    scope: searchScope,
    terms: searchTerms,
    categories: selectedCategories,
    authors: selectedAuthors,
    books: selectedBooks,
    languages: selectedLanguages,
    countries: selectedCountries,
    deathCenturies: selectedDeathCenturies,
    genres: selectedGenres,
    madhhabs: selectedMadhhabs,
    eraCenturies: selectedEraCenturies,
    physicalClasses: selectedPhysicalClasses,
    persons: selectedPersons,
    places: selectedPlaces,
    dateFrom,
    dateTo,
  }), [searchMode, searchScope, searchTerms, selectedCategories, selectedAuthors, selectedBooks, selectedLanguages, selectedCountries, selectedDeathCenturies, selectedGenres, selectedMadhhabs, selectedEraCenturies, selectedPhysicalClasses, selectedPersons, selectedPlaces, dateFrom, dateTo]);

  const consoleHandlers = useMemo<CorpusFilterHandlers>(() => ({
    setMode: setSearchMode,
    setScope: (scope) => {
      setSearchScope(scope);
      // mine/all never carry an explicit book set (the sync effect below
      // enforces the reverse direction: books ⇒ selected).
      if (scope !== 'selected') setSelectedBooks([]);
    },
    addTerm: (partial) => setSearchTerms((prev) => [...prev, createSearchTerm(partial)]),
    updateTerm: (id, patch) =>
      setSearchTerms((prev) => prev.map((term) => (term.id === id ? { ...term, ...patch } : term))),
    removeTerm: (id) => setSearchTerms((prev) => prev.filter((term) => term.id !== id)),
    setTerms: setSearchTerms,
    toggleCategory: (v) => setSelectedCategories((prev) => toggleIn(prev, v)),
    toggleAuthor: (v) => setSelectedAuthors((prev) => toggleIn(prev, v)),
    toggleBook: (book) =>
      setSelectedBooks((prev) =>
        prev.some((b) => b.id === book.id) ? prev.filter((b) => b.id !== book.id) : [...prev, book],
      ),
    toggleLanguage: (v) => setSelectedLanguages((prev) => toggleIn(prev, v)),
    toggleCountry: (v) => setSelectedCountries((prev) => toggleIn(prev, v)),
    toggleDeathCentury: (c) =>
      setSelectedDeathCenturies((prev) =>
        prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
      ),
    toggleGenre: (v) => setSelectedGenres((prev) => toggleIn(prev, v)),
    toggleMadhhab: (v) => setSelectedMadhhabs((prev) => toggleIn(prev, v)),
    toggleEraCentury: (c) =>
      setSelectedEraCenturies((prev) =>
        prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
      ),
    togglePhysicalClass: (v) => setSelectedPhysicalClasses((prev) => toggleIn(prev, v)),
    togglePerson: (entity) =>
      setSelectedPersons((prev) =>
        prev.some((p) => p.id === entity.id) ? prev.filter((p) => p.id !== entity.id) : [...prev, entity],
      ),
    togglePlace: (entity) =>
      setSelectedPlaces((prev) =>
        prev.some((p) => p.id === entity.id) ? prev.filter((p) => p.id !== entity.id) : [...prev, entity],
      ),
    setDateFrom,
    setDateTo,
    clearAll: clearFilters,
    applyFilterValues: (values) => applyFilterState(values),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setters are stable; clearFilters/applyFilterState identities are stable enough for the console
  }), [applyFilterState]);

  /* ─── Named saved filter presets + the current-filters snapshot ─── */
  // Shared TanStack Query cache: the sidebar and the search console (on every
  // surface) see the same preset list and stay in sync through mutations.
  const { presets, savePreset, deletePreset } = useFilterPresets(isAuthenticated);

  const currentFilterValues = useMemo((): DocumentFilterValues => ({
    version: 2,
    q: searchQuery,
    refine: refineText,
    mode: searchMode,
    scope: searchScope,
    terms: searchTerms.map(serializeSearchTerm),
    documents: selectedBooks.map((b) => b.id),
    authors: selectedAuthors,
    categories: selectedCategories,
    languages: selectedLanguages,
    countries: selectedCountries,
    deathCenturies: selectedDeathCenturies,
    genres: selectedGenres,
    madhhabs: selectedMadhhabs,
    eraCenturies: selectedEraCenturies,
    physicalClasses: selectedPhysicalClasses,
    persons: selectedPersons.map((p) => p.id),
    places: selectedPlaces.map((p) => p.id),
    dateFrom,
    dateTo,
  }), [searchQuery, refineText, searchMode, searchScope, searchTerms, selectedBooks, selectedAuthors, selectedCategories, selectedLanguages, selectedCountries, selectedDeathCenturies, selectedGenres, selectedMadhhabs, selectedEraCenturies, selectedPhysicalClasses, selectedPersons, selectedPlaces, dateFrom, dateTo]);

  // Drop the AI "Interpreted as" chip whenever the filters change through any
  // path other than the AI apply itself (manual search, sidebar toggle, chip
  // removal, preset, topic bar, URL restore). applyAssistFilters sets the ref
  // so its own mutation is exempt; every other filter change clears the chip so
  // it never describes a filter set the user has since edited.
  useEffect(() => {
    if (assistJustAppliedRef.current) {
      assistJustAppliedRef.current = false;
      return;
    }
    setAssistInterpretation(null);
  }, [currentFilterValues]);

  const handleSavePreset = async (name: string) => {
    // Let a duplicate-name (400) rejection propagate so the caller can show it.
    await savePreset(name, currentFilterValues);
  };
  const handleApplyPreset = (preset: SavedFilterPreset) => applyFilterState(preset.filters);
  const handleDeletePreset = async (id: number) => {
    await deletePreset(id);
  };

  const hasActiveFilters =
    Boolean(searchQuery) ||
    Boolean(refineText) ||
    searchMode !== 'hybrid' ||
    selectedBooks.length > 0 ||
    selectedAuthors.length > 0 ||
    selectedCategories.length > 0 ||
    selectedLanguages.length > 0 ||
    selectedCountries.length > 0 ||
    selectedDeathCenturies.length > 0 ||
    selectedGenres.length > 0 ||
    selectedMadhhabs.length > 0 ||
    selectedEraCenturies.length > 0 ||
    selectedPhysicalClasses.length > 0 ||
    selectedPersons.length > 0 ||
    selectedPlaces.length > 0 ||
    Boolean(dateFrom) ||
    Boolean(dateTo);

  // Count of active filter *groups* — shown on the mobile "Filters (N)" trigger.
  const activeFilterCount =
    (searchQuery ? 1 : 0) +
    (refineText ? 1 : 0) +
    (searchMode !== 'hybrid' ? 1 : 0) +
    (selectedBooks.length ? 1 : 0) +
    (selectedAuthors.length ? 1 : 0) +
    (selectedCategories.length ? 1 : 0) +
    (selectedLanguages.length ? 1 : 0) +
    (selectedCountries.length ? 1 : 0) +
    (selectedDeathCenturies.length ? 1 : 0) +
    (selectedGenres.length ? 1 : 0) +
    (selectedMadhhabs.length ? 1 : 0) +
    (selectedEraCenturies.length ? 1 : 0) +
    (selectedPhysicalClasses.length ? 1 : 0) +
    (selectedPersons.length ? 1 : 0) +
    (selectedPlaces.length ? 1 : 0) +
    (dateFrom || dateTo ? 1 : 0);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchQuery(searchDraft);
    setPopoverOpen(false);
    setAssistInterpretation(null);
  };

  // Expose the active filters + saved presets to the library agent as read-only
  // context (it can factor them into searches but can't mutate them directly).
  useCopilotReadable({
    description:
      "The user's currently active library filters and their saved named filter presets on this page. Use this to answer questions about what filters are applied, or take it into account when running searches — you cannot change it directly.",
    value: {
      activeFilters: currentFilterValues,
      savedPresets: presets.map((p) => ({ name: p.name, filters: p.filters })),
    },
  });

  // Expose the page's controls to the CopilotKit library agent so it can drive
  // the grid (run searches / apply filters) in addition to answering in chat.
  useCopilotAction({
    name: 'runLibrarySearch',
    description:
      'Search the library and show the matching books on the page. Use this when the user asks to find or search for books, authors, or topics.',
    parameters: [
      { name: 'query', type: 'string', description: 'The search text to run.', required: true },
    ],
    handler: async ({ query }: { query: string }) => {
      setSearchQuery(query);
      setSearchDraft(query);
      return `Searching the library for "${query}".`;
    },
  });

  useCopilotAction({
    name: 'applyFilters',
    description:
      'Add filters to the library grid (authors, categories, languages, and an uploaded-date range). Facet values are ADDED to the current selection, not replaced, so existing filters are preserved; the user removes filters via the on-screen chips. Pass only the facets you want to add.',
    parameters: [
      { name: 'authors', type: 'string[]', description: 'Author names to filter by.', required: false },
      { name: 'categories', type: 'string[]', description: 'Category names to filter by.', required: false },
      { name: 'languages', type: 'string[]', description: 'Language codes to filter by, e.g. "ar".', required: false },
      { name: 'dateFrom', type: 'string', description: 'Uploaded-after date, YYYY-MM-DD.', required: false },
      { name: 'dateTo', type: 'string', description: 'Uploaded-before date, YYYY-MM-DD.', required: false },
    ],
    handler: async ({
      authors,
      categories,
      languages,
      dateFrom,
      dateTo,
    }: {
      authors?: string[];
      categories?: string[];
      languages?: string[];
      dateFrom?: string;
      dateTo?: string;
    }) => {
      // Additive union so "also filter by X" preserves existing selections
      // rather than replacing them; an empty array is a no-op, not a clear.
      const addUnique = (prev: string[], next?: string[]) =>
        next?.length ? Array.from(new Set([...prev, ...next])) : prev;
      if (authors?.length) setSelectedAuthors((prev) => addUnique(prev, authors));
      if (categories?.length) setSelectedCategories((prev) => addUnique(prev, categories));
      if (languages?.length) setSelectedLanguages((prev) => addUnique(prev, languages));
      if (dateFrom !== undefined) setDateFrom(dateFrom);
      if (dateTo !== undefined) setDateTo(dateTo);
      return 'Updated the library filters.';
    },
  });

  const applyRefine = () => {
    setRefineText(refineDraft);
    setRefineOpen(false);
  };

  const closeRefine = useCallback(() => {
    setRefineOpen(false);
    setRefineDraft(refineText);
  }, [refineText]);

  const loadMore = () => {
    if (!hasNext || isLoadingMore) return;
    setCurrentPage((p) => p + 1);
  };

  const formatCount = (n: number) => toLocaleDigits(n, locale);
  const initialLoading = isLoading && accumulated.length === 0;
  const showLegend = legend.length > 1 || (legend.length === 1 && Boolean(legend[0].label));

  /* ─── Sub-renderers ─── */

  const segments: { key: StatusSegment; label: string; count: number }[] = [
    { key: 'all', label: t('docs.segment.all', 'الكل'), count: totalCount },
    { key: 'ready', label: t('docs.segment.ready', 'جاهزة'), count: statusCounts.ready },
    { key: 'processing', label: t('docs.segment.processing', 'قيد المعالجة'), count: statusCounts.processing },
  ];

  const filterSidebar = (
    <FilterSidebar
      segments={segments}
      statusSegment={statusSegment}
      onStatusChange={(key) => setStatusSegment(key as StatusSegment)}
      facetValues={facetValues}
      selectedCategories={selectedCategories}
      selectedLanguages={selectedLanguages}
      selectedAuthors={selectedAuthors}
      onToggleCategory={handleToggleCategory}
      onToggleLanguage={(v) => setSelectedLanguages((prev) => toggleIn(prev, v))}
      onToggleAuthor={handleToggleAuthor}
      dateFrom={dateFrom}
      dateTo={dateTo}
      onDateFromChange={setDateFrom}
      onDateToChange={setDateTo}
      hasActiveFilters={hasActiveFilters}
      onClearAll={clearFilters}
      presets={presets}
      onSavePreset={handleSavePreset}
      onApplyPreset={handleApplyPreset}
      onDeletePreset={handleDeletePreset}
    />
  );

  // Green "explore on the map" promo — links to the existing /map atlas.
  const mapPromo = (
    <Link
      href={localizedPath('/map')}
      className="relative block mt-5 rounded-[13px] overflow-hidden p-[18px] text-[#efe7d2] group"
      style={{ background: 'linear-gradient(150deg,#2e5347,#24433a)' }}
    >
      <span
        className="absolute inset-0 opacity-[0.13] pointer-events-none"
        style={{ backgroundImage: 'url(/images/landing/star-tile.svg)', backgroundSize: '90px 90px' }}
        aria-hidden
      />
      <span className="relative block">
        <span className="flex items-center gap-2 mb-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e9c77a" strokeWidth="2" aria-hidden>
            <path d="M12 21 C12 21 5 14.5 5 9.2 a7 7 0 0 1 14 0 c0 5.3 -7 11.8 -7 11.8 Z" />
            <circle cx="12" cy="9.2" r="2.4" />
          </svg>
          <span className="font-reem-kufi font-semibold text-[15px]">{t('docs.rr.map.title', 'استكشف على الخريطة')}</span>
        </span>
        <span className="block text-[12.5px] leading-[1.7] text-[#cbd8cc]">
          {t('docs.rr.map.desc', 'تصفّح المؤلفين حسب موطنهم عبر الأقاليم من الأندلس إلى الهند.')}
        </span>
        <span className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#e9c77a]">
          {t('docs.rr.map.cta', 'افتح الأطلس')}
          <span className="text-[15px] transition-transform group-hover:-translate-x-0.5 rtl:group-hover:translate-x-0.5">‹</span>
        </span>
      </span>
    </Link>
  );

  const railContent = (
    <>
      <div className="flex items-center justify-between mb-4">
        <span className="rr-title text-[16px]">{t('docs.rr.filtersTitle', 'تصفية النتائج')}</span>
        {hasActiveFilters && (
          <button onClick={clearFilters} className="text-[12px] text-[#b07d2b] hover:text-[#2c2620] transition-colors">
            {t('docs.clearAll', 'مسح الكل')}
          </button>
        )}
      </div>
      {filterSidebar}
      {mapPromo}
    </>
  );

  const renderActiveChips = () => {
    if (!hasActiveFilters) return null;
    return (
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {searchQuery && (
          <ActiveChip label={t('docs.search', 'بحث')} value={searchQuery} onRemove={() => { setSearchQuery(''); setSearchDraft(''); }} />
        )}
        {refineText && (
          <ActiveChip label={t('docs.refine.button', 'تنقيح')} value={refineText} onRemove={() => { setRefineText(''); setRefineDraft(''); }} />
        )}
        {searchMode !== 'hybrid' && (
          <ActiveChip
            label={t('nav.search.modeLabel', 'نوع البحث')}
            value={t(`nav.search.mode.${searchMode}`, searchMode === 'exact' ? 'تام' : 'دلالي')}
            onRemove={() => setSearchMode('hybrid')}
          />
        )}
        {selectedCategories.map((c) => (
          <ActiveChip key={c} label={t('docs.filter.category', 'تصنيف')} value={c} onRemove={() => setSelectedCategories((prev) => prev.filter((x) => x !== c))} />
        ))}
        {selectedLanguages.map((l) => (
          <ActiveChip key={l} label={t('docs.language', 'اللغة')} value={languageName(l)} onRemove={() => setSelectedLanguages((prev) => prev.filter((x) => x !== l))} />
        ))}
        {selectedAuthors.map((a) => (
          <ActiveChip key={a} label={t('docs.filter.author', 'مؤلف')} value={a} onRemove={() => setSelectedAuthors((prev) => prev.filter((x) => x !== a))} />
        ))}
        {selectedCountries.map((c) => (
          <ActiveChip key={c} label={t('docs.country', 'البلد')} value={c} onRemove={() => setSelectedCountries((prev) => prev.filter((x) => x !== c))} />
        ))}
        {selectedDeathCenturies.map((c) => (
          <ActiveChip
            key={c}
            label={t('docs.deathCentury', 'قرن الوفاة')}
            value={formatHijriCentury(c, locale)}
            onRemove={() => setSelectedDeathCenturies((prev) => prev.filter((x) => x !== c))}
          />
        ))}
        {selectedBooks.map((b) => (
          <ActiveChip
            key={b.id}
            label={t('nav.search.books', 'الكتب')}
            value={b.title}
            onRemove={() => setSelectedBooks((prev) => prev.filter((x) => x.id !== b.id))}
          />
        ))}
        {(dateFrom || dateTo) && (
          <ActiveChip label={t('docs.filter.date', 'تاريخ')} value={`${dateFrom || '…'} — ${dateTo || '…'}`} onRemove={() => { setDateFrom(''); setDateTo(''); }} />
        )}
        <button onClick={clearFilters} className="text-[12px] text-[#b07d2b] hover:text-[#2c2620] transition-colors px-2 py-1">
          {t('docs.clearAll', 'مسح الكل')}
        </button>
      </div>
    );
  };

  const renderLegend = () => {
    if (!showLegend) return null;
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-5 text-[11.5px] text-[#9a8b70]">
        <span className="text-[#b07d2b]">{t('docs.legend.title', 'الألوان حسب الفئة')}:</span>
        {legend.map((e) => (
          <span key={e.key} className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: e.color }} aria-hidden />
            <span dir="auto">{e.label || t('docs.legend.other', 'غير مصنّف')}</span>
          </span>
        ))}
      </div>
    );
  };

  const renderEmptyResults = () => (
    <div className="rr-card p-10 text-center">
      <div className="flex items-center justify-center gap-3.5 text-[#b07d2b] mb-6">
        <div className="h-[1px] w-10 bg-gradient-to-r from-transparent to-[#b07d2b]" />
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" /></svg>
        <div className="h-[1px] w-10 bg-gradient-to-r from-[#b07d2b] to-transparent" />
      </div>
      <h3 className="rr-title text-[clamp(20px,2.4vw,28px)] mb-3">
        {t('docs.empty.didYouMean', 'هل تقصد…؟')}
      </h3>
      <p className="text-[14px] text-[#6e6354] mb-7 max-w-md mx-auto leading-[1.8]">
        {t('docs.adjustFilters', 'جرّب تعديل المرشحات لعرض نتائج أكثر.')}
      </p>
      <button
        onClick={clearFilters}
        className="inline-flex items-center gap-2 text-[13px] text-[#b07d2b] hover:text-[#2c2620] transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        {t('docs.empty.searchAll', 'ابحث في كامل المكتبة')}
      </button>
    </div>
  );

  const renderRefineBar = () => (
    <div className="mb-5 rr-card overflow-hidden">
      {refineOpen ? (
        <div className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[#b07d2b]" aria-hidden>✦</span>
            <span className="text-[14.5px] text-[#2c2620]">
              {t('docs.refine.inline.title', 'نقّح هذه النتائج بالذكاء الاصطناعي')}
            </span>
          </div>
          <textarea
            value={refineDraft}
            onChange={(e) => setRefineDraft(e.target.value)}
            placeholder={t('docs.refine.inline.hint', 'اجعلها أقصر، استبعد الروايات، ركّز على القرن العاشر…')}
            rows={2}
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Escape') closeRefine(); }}
            className="w-full px-3 py-2 rounded-[10px] text-[14px] outline-none transition-all bg-[#f7efdc] text-[#2c2620] placeholder:text-[#9a8b70] focus:border-[#b07d2b] focus:shadow-[0_0_0_4px_rgba(176,125,43,0.10)] border border-[#e2d5ba] resize-none leading-[1.7]"
          />
          <div className="mt-3 flex items-center justify-end gap-2">
            <button onClick={closeRefine} className="px-3 py-1.5 text-[12.5px] text-[#9a8b70] hover:text-[#2c2620] transition-colors">
              {t('docs.refine.cancel', 'إلغاء')}
            </button>
            <button onClick={applyRefine} className="rr-brand-btn text-[12.5px] px-4 py-1.5">
              {t('docs.refine.apply', 'تطبيق')}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setRefineOpen(true)}
          className="w-full text-start p-4 flex items-start gap-3 hover:bg-[rgba(176,125,43,0.06)] transition-colors"
        >
          <span className="mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full bg-[rgba(176,125,43,0.15)] text-[#b07d2b] flex-shrink-0">✦</span>
          <span className="flex-1 min-w-0">
            <span className="block text-[14.5px] text-[#2c2620]">
              {t('docs.refine.inline.title', 'نقّح هذه النتائج بالذكاء الاصطناعي')}
            </span>
            <span className="block mt-0.5 text-[12.5px] text-[#9a8b70] line-clamp-1">
              {t('docs.refine.inline.hint', 'اجعلها أقصر، استبعد الروايات، ركّز على القرن العاشر…')}
            </span>
          </span>
          <svg className="w-4 h-4 text-[#9a8b70] mt-1 flex-shrink-0 rtl:rotate-180" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}
    </div>
  );

  const renderDocs = (docs: Document[]): ReactNode => {
    if (viewMode === 'list') {
      return (
        <div className="flex flex-col gap-3">
          {docs.map((doc) => (
            <BookListRow key={doc.id} document={doc} />
          ))}
        </div>
      );
    }
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 2xl:grid-cols-4 gap-4">
        {docs.map((doc) => (
          <BookCard key={doc.id} document={doc} progressPercent={progressByDoc.get(doc.id)} />
        ))}
      </div>
    );
  };

  const renderGroup = (title: string, docs: Document[], action?: ReactNode) => {
    if (docs.length === 0) return null;
    return (
      <section className="mb-9">
        <div className="mb-4 flex items-baseline justify-between gap-2.5">
          <h2 className="rr-title text-[clamp(18px,2vw,19px)] flex items-baseline gap-2.5">
            {title}
            <span className="text-[13px] text-[#9a8b70] font-normal">{formatCount(docs.length)}</span>
          </h2>
          {action}
        </div>
        {renderDocs(docs)}
      </section>
    );
  };

  const renderShelf = (docs: Document[]) => (
    <div className="pb-1">
      <div className="flex flex-wrap items-end gap-1.5 pb-3 border-b-[3px] border-[#b07d2b]/40 shadow-[0_10px_20px_-16px_rgba(0,0,0,0.5)]">
        {docs.map((doc) => (
          <BookSpine key={doc.id} document={doc} progressPercent={progressByDoc.get(doc.id)} />
        ))}
      </div>
    </div>
  );

  const renderLoadMore = () => (
    <div className="mt-10 flex flex-col items-center gap-2.5">
      {hasNext ? (
        <button
          onClick={loadMore}
          disabled={isLoadingMore}
          className="inline-flex items-center gap-2 px-6 py-3 text-[13.5px] rounded-full border border-[#e2d5ba] text-[#2c2620] bg-[#fcf8ee] hover:border-[#b07d2b] transition-all disabled:opacity-60"
        >
          {isLoadingMore ? (
            <span className="inline-block w-4 h-4 border-2 border-[#b07d2b] border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          )}
          {t('docs.loadMore', 'عرض المزيد')}
        </button>
      ) : (
        <span className="text-[12px] text-[#9a8b70]">{t('docs.endOfResults', 'انتهت النتائج')}</span>
      )}
      <span className="text-[11.5px] text-[#9a8b70] tracking-wide">
        {t('docs.loadMoreProgress', '{shown} من {total}', {
          shown: formatCount(accumulated.length),
          total: formatCount(totalCount),
        })}
      </span>
    </div>
  );

  const emptyLibrary = !isLoading && !error && totalCount === 0 && !hasActiveFilters;

  const showAll = (
    <button
      type="button"
      onClick={clearFilters}
      className="text-[12.5px] text-[#b07d2b] hover:text-[#2c2620] transition-colors"
    >
      {t('docs.rr.showAll', 'عرض الكل')}
    </button>
  );

  const librarySearchEl = (
    <div className="relative w-full max-w-[540px]">
      <form onSubmit={submitSearch} className="w-full">
        <div
          className="flex items-center gap-[11px] rounded-[12px] border px-4 py-[11px]"
          style={{ background: 'var(--rr-surface)', borderColor: 'var(--rr-line)' }}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#9a8b70" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.5" y2="16.5" />
          </svg>
          <input
            type="text"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            onFocus={() => setPopoverOpen(true)}
            placeholder={t('docs.rr.searchPlaceholder', 'ابحث في الكتب والمؤلفين والمواضيع…')}
            dir="auto"
            aria-label={t('docs.rr.searchPlaceholder', 'ابحث في الكتب والمؤلفين والمواضيع…')}
            className="min-w-0 flex-1 bg-transparent text-[14.5px] outline-none placeholder:text-[#9a8b70]"
            style={{ color: 'var(--rr-ink)' }}
          />
        </div>
      </form>
      <SearchCommandPalette
        open={popoverOpen}
        onOpenChange={setPopoverOpen}
        initialQuery={searchDraft}
        filters={consoleFilters}
        handlers={consoleHandlers}
        isAuthenticated={isAuthenticated}
        canUpload={canUpload}
        analyticsSurface="documents"
        onAssistApply={applyAssistFilters}
        onPlainSubmit={(q) => {
          setSearchDraft(q);
          setSearchQuery(q);
          setAssistInterpretation(null);
        }}
        presets={
          isAuthenticated
            ? {
                list: presets,
                onApply: handleApplyPreset,
                onSave: (name, values) => savePreset(name, values),
                onDelete: handleDeletePreset,
              }
            : undefined
        }
      />
    </div>
  );

  return (
    <RequireAuth>
      <main
        className="reading-room min-h-screen"
        style={{
          transition: 'padding 0.42s cubic-bezier(0.2,0.8,0.2,1)',
          paddingLeft: docked && dock.edge === 'left' ? 400 : undefined,
          paddingRight: docked && dock.edge === 'right' ? 400 : undefined,
          paddingBottom: docked && dock.edge === 'bottom' ? 'min(60vh, 420px)' : undefined,
        }}
      >
        <ShellHeader contained showThemeToggle search={librarySearchEl} />
        <div className="mx-auto max-w-[1400px] px-5 sm:px-9 lg:px-12 relative z-10">
          {/* ─── Topic bar + upload ─── */}
          <section className="pt-6 pb-4 border-b border-[#e2d5ba]">
            <div className="flex items-center justify-between gap-4">
              {!emptyLibrary ? (
                <div className="min-w-0 flex-1">
                  <ReadingRoomTopicBar
                    selectedCategories={selectedCategories}
                    onToggleCategory={(v) => setSelectedCategories((prev) => toggleIn(prev, v))}
                    onClearCategories={() => setSelectedCategories([])}
                  />
                </div>
              ) : (
                <div className="flex-1" />
              )}
              {canUpload && (
                <Link
                  href={localizedPath('/upload')}
                  className="flex-shrink-0 inline-flex items-center gap-2 rounded-full bg-[#b07d2b] text-[#fcf8ee] text-[12.5px] font-semibold px-4 h-9 shadow-[0_4px_18px_-6px_rgba(176,125,43,0.6)] hover:brightness-105 hover:-translate-y-[1px] transition-all"
                >
                  <UploadIcon />
                  <span className="hidden sm:inline">{t('nav.app.uploadBook', 'رفع كتاب')}</span>
                </Link>
              )}
            </div>
          </section>

          {emptyLibrary ? (
            <div className="py-20 text-center">
              <h2 className="rr-title text-[clamp(22px,2.6vw,32px)] mb-3">
                {canUpload
                  ? t('docs.hero.empty.headline', 'ابدأ مكتبتك.')
                  : t('docs.hero.empty.readerHeadline', 'المكتبة فارغة حاليًا.')}
              </h2>
              <p className="text-[14px] text-[#6e6354] mb-7 max-w-md mx-auto leading-[1.8]">
                {canUpload
                  ? t('docs.hero.empty.subtext', 'ارفع كتابك الأوّل لتبدأ القراءة مع علم.')
                  : t('docs.hero.empty.readerSubtext', 'لم تتم إضافة أي كتب بعد. تحقّق مرة أخرى قريبًا.')}
              </p>
              {canUpload && (
                <Link
                  href={localizedPath('/upload')}
                  className="inline-flex items-center gap-2 rounded-full bg-[#b07d2b] text-[#fcf8ee] text-[13.5px] font-semibold px-5 h-11 shadow-[0_4px_18px_-6px_rgba(176,125,43,0.6)] hover:brightness-105 transition-all"
                >
                  <UploadIcon />
                  {t('docs.hero.empty.cta', 'ارفع كتابك الأوّل')}
                </Link>
              )}
            </div>
          ) : (
            <div className="pt-6 lg:grid lg:grid-cols-[272px_minmax(0,1fr)] lg:gap-8 lg:items-start">
              {/* ─── Filter rail ─── */}
              {isDesktop && (
                <aside className="hidden lg:block lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto custom-scrollbar pe-1">
                  <div className="rounded-[14px] border border-[#e7dbc1] bg-[#f4ecd8] p-5">
                    {railContent}
                  </div>
                </aside>
              )}

              {/* ─── Main column ─── */}
              <div className="min-w-0">
                {/* Mobile filter trigger (the assistant opens from the floating bubble) */}
                {!isDesktop && (
                  <div className="flex items-center gap-2 mb-4 lg:hidden">
                    <button
                      type="button"
                      onClick={() => setFiltersOpen(true)}
                      className="inline-flex items-center gap-2 px-4 py-2 text-[12.5px] rounded-full border border-[#e2d5ba] bg-[#fcf8ee] text-[#2c2620] hover:border-[#b07d2b] transition-all"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M6 12h12M10 20h4" />
                      </svg>
                      {activeFilterCount > 0
                        ? t('docs.filters.open', 'تصفية ({count})', { count: formatCount(activeFilterCount) })
                        : t('docs.filters', 'المرشحات')}
                    </button>
                  </div>
                )}

                {/* Active chips */}
                {renderActiveChips()}

                {/* AI interpretation of the last natural-language query */}
                {assistInterpretation && (
                  <div className="mb-4 flex items-start gap-2.5 rounded-[12px] border border-[#e3cfa3] bg-[#faf3e2] px-4 py-3">
                    <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#b07d2b]" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <path d="M12 2l1.9 4.8L18.7 8.7 13.9 10.6 12 15.4 10.1 10.6 5.3 8.7 10.1 6.8z" />
                    </svg>
                    <p className="flex-1 text-[13px] leading-[1.6] text-[#6e6354]">
                      <span className="font-semibold text-[#b07d2b]">{t('docs.palette.interpretedAs', 'فُسِّر كـ')}: </span>
                      <bdi>{assistInterpretation}</bdi>
                    </p>
                    <button
                      type="button"
                      onClick={() => setAssistInterpretation(null)}
                      aria-label={t('reader.closePanel', 'إغلاق')}
                      className="flex-shrink-0 rounded-full p-0.5 text-[#9a8b70] hover:text-[#2c2620] transition-colors"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                )}

                {/* Legend */}
                {renderLegend()}

                {/* AI refine */}
                {!isLoading && !error && shownCount > 0 && effectiveSearch && renderRefineBar()}

                {/* Toolbar: sort + count + view */}
                <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                  <div className="flex items-center gap-2">
                    <label className="text-[11.5px] tracking-[0.12em] uppercase text-[#9a8b70]">
                      {t('docs.sort.label', 'الترتيب')}
                    </label>
                    <div className="relative">
                      <select
                        value={sort}
                        onChange={(e) => setSort(e.target.value as SortKey)}
                        className="appearance-none ps-3 pe-9 py-2 text-[12.5px] bg-[#fcf8ee] border border-[#e2d5ba] rounded-[10px] focus:border-[#b07d2b] focus:shadow-[0_0_0_4px_rgba(176,125,43,0.10)] outline-none text-[#2c2620] cursor-pointer transition-all"
                      >
                        <option value="relevance">{t('docs.sort.relevance', 'الأكثر صلة')}</option>
                        <option value="newest">{t('docs.sort.newest', 'الأحدث')}</option>
                        <option value="alphabetical">{t('docs.sort.alphabetical', 'أبجدي')}</option>
                        <option value="shortest">{t('docs.sort.shortest', 'الأقصر أولًا')}</option>
                      </select>
                      <svg
                        className="pointer-events-none absolute top-1/2 end-3 -translate-y-1/2 w-3.5 h-3.5 text-[#b07d2b]"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2.2}
                        aria-hidden
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
                      </svg>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {!isLoading && !error && (
                      <span className="text-[11.5px] tracking-wide text-[#9a8b70]">
                        {t('docs.loadMoreProgress', '{shown} من {total}', {
                          shown: formatCount(accumulated.length),
                          total: formatCount(totalCount),
                        })}
                      </span>
                    )}
                    <div className="flex items-center gap-1 p-1 bg-[#fcf8ee] border border-[#e2d5ba] rounded-[12px]">
                      <button
                        onClick={() => setViewMode('grid')}
                        aria-pressed={viewMode === 'grid'}
                        aria-label={t('docs.grid', 'عرض شبكي')}
                        title={t('docs.grid', 'عرض شبكي')}
                        className={`p-1.5 rounded-[8px] transition-all ${
                          viewMode === 'grid'
                            ? 'bg-[rgba(176,125,43,0.14)] text-[#8a6a23] shadow-[inset_0_0_0_1px_rgba(176,125,43,0.25)]'
                            : 'text-[#9a8b70] hover:text-[#2c2620]'
                        }`}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h6v6H4zM14 6h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => setViewMode('list')}
                        aria-pressed={viewMode === 'list'}
                        aria-label={t('docs.list', 'عرض قائمة')}
                        title={t('docs.list', 'عرض قائمة')}
                        className={`p-1.5 rounded-[8px] transition-all ${
                          viewMode === 'list'
                            ? 'bg-[rgba(176,125,43,0.14)] text-[#8a6a23] shadow-[inset_0_0_0_1px_rgba(176,125,43,0.25)]'
                            : 'text-[#9a8b70] hover:text-[#2c2620]'
                        }`}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                        </svg>
                      </button>
                      <button
                        onClick={() => setViewMode('shelf')}
                        aria-pressed={viewMode === 'shelf'}
                        aria-label={t('docs.view.shelf', 'عرض الرف')}
                        title={t('docs.view.shelf', 'عرض الرف')}
                        className={`p-1.5 rounded-[8px] transition-all ${
                          viewMode === 'shelf'
                            ? 'bg-[rgba(176,125,43,0.14)] text-[#8a6a23] shadow-[inset_0_0_0_1px_rgba(176,125,43,0.25)]'
                            : 'text-[#9a8b70] hover:text-[#2c2620]'
                        }`}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v16M9 4v16M14 5l3 15M19 4v16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Body */}
                {error ? (
                  <div className="rr-card !border-red-500/30 p-8 text-center">
                    <p className="text-red-700 mb-4 text-[14px]">{error}</p>
                    <button onClick={retry} className="rr-brand-btn text-[13px] px-4 py-2">
                      {t('docs.tryAgain', 'إعادة المحاولة')}
                    </button>
                  </div>
                ) : isLoading ? (
                  <div
                    className={
                      viewMode === 'list'
                        ? 'flex flex-col gap-3'
                        : 'grid grid-cols-2 sm:grid-cols-3 2xl:grid-cols-4 gap-4'
                    }
                  >
                    {Array.from({ length: 8 }).map((_, i) => (
                      <BookCardSkeleton key={i} variant={viewMode === 'list' ? 'list' : 'grid'} />
                    ))}
                  </div>
                ) : shownCount === 0 ? (
                  renderEmptyResults()
                ) : (
                  <>
                    {isSearching ? (
                      viewMode === 'shelf' ? (
                        renderShelf(flatDocs)
                      ) : (
                        renderGroup(t('docs.search.resultsHeading', 'نتائج البحث'), flatDocs)
                      )
                    ) : grouped ? (
                      <>
                        <RecommendedShelf />
                        {renderGroup(t('docs.group.processing', 'قيد المعالجة'), processingDocs)}
                        {renderGroup(t('docs.rr.picks', 'مختارات المكتبة'), readyDocs, showAll)}
                      </>
                    ) : viewMode === 'shelf' ? (
                      renderShelf(flatDocs)
                    ) : (
                      renderDocs(flatDocs)
                    )}

                    {renderLoadMore()}
                  </>
                )}
              </div>

              {/* Mobile filter drawer */}
              {!isDesktop && (
                <ReaderPanel
                  isOpen={filtersOpen}
                  onClose={() => setFiltersOpen(false)}
                  title={t('docs.filters', 'المرشحات')}
                >
                  {filterSidebar}
                  {mapPromo}
                </ReaderPanel>
              )}

              {/* ─── AI library assistant (bespoke Reading Room edge drawer) ─── */}
              <LibraryAssistant dock={dock} />
            </div>
          )}
        </div>
      </main>
    </RequireAuth>
  );
}
