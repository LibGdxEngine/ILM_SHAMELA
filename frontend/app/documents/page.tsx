'use client';

import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Document, DocumentsListParams, getDocuments } from '@/lib/api';
import BookCard from '@/components/BookCard';
import BookListRow from '@/components/BookListRow';
import BookCardSkeleton from '@/components/BookCardSkeleton';
import RequireAuth from '@/components/RequireAuth';
import ContinueShelf from '@/components/documents/ContinueShelf';
import BookSpine from '@/components/documents/BookSpine';
import FilterSidebar from '@/components/documents/FilterSidebar';
import ReadingRoomTopicBar from '@/components/documents/ReadingRoomTopicBar';
import LibraryAssistantPanel from '@/components/documents/LibraryAssistantPanel';
import ReaderPanel from '@/components/document/ReaderPanel';
import useMediaQuery from '@/hooks/useMediaQuery';
import useDebounce from '@/hooks/useDebounce';
import { useI18n } from '@/components/i18n/I18nProvider';
import { useLanguageName } from '@/lib/i18n/languageName';
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

  /* ─── Query state ─── */
  const [searchQuery, setSearchQuery] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [refineText, setRefineText] = useState('');
  const [refineDraft, setRefineDraft] = useState('');
  const [refineOpen, setRefineOpen] = useState(false);

  const [selectedAuthors, setSelectedAuthors] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [sort, setSort] = useState<SortKey>('relevance');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [statusSegment, setStatusSegment] = useState<StatusSegment>('all');

  /* ─── Layout state ─── */
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
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

  const applyFromUrl = useCallback((search: string) => {
    const p = new URLSearchParams(search);
    const parseList = (key: string) => {
      const v = p.get(key);
      return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
    };
    const q = p.get('q') ?? '';
    setSearchQuery(q);
    setSearchDraft(q);
    const refine = p.get('refine') ?? '';
    setRefineText(refine);
    setRefineDraft(refine);
    setSelectedAuthors(parseList('authors'));
    setSelectedCategories(parseList('categories'));
    setSelectedLanguages(parseList('languages'));
    setDateFrom(p.get('date_from') ?? '');
    setDateTo(p.get('date_to') ?? '');
    const s = p.get('sort');
    setSort(s === 'newest' || s === 'alphabetical' || s === 'shortest' ? s : 'relevance');
    const st = p.get('status');
    setStatusSegment(st === 'ready' || st === 'processing' ? st : 'all');
    const v = p.get('view');
    if (v === 'list' || v === 'grid' || v === 'shelf') setViewMode(v);
  }, []);

  // Restore state from URL (and view preference from localStorage) on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const savedView = window.localStorage.getItem(VIEW_KEY);
    if (savedView === 'list' || savedView === 'grid' || savedView === 'shelf') {
      setViewMode(savedView);
    }
    applyFromUrl(window.location.search);
    restoredRef.current = true;
  }, [applyFromUrl]);

  // Re-apply state on browser back/forward.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPop = () => applyFromUrl(window.location.search);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [applyFromUrl]);

  // Mirror all filter/view state into the URL (replaceState — no history spam).
  useEffect(() => {
    if (typeof window === 'undefined' || !restoredRef.current) return;
    const params = new URLSearchParams();
    if (searchQuery.trim()) params.set('q', searchQuery.trim());
    if (refineText.trim()) params.set('refine', refineText.trim());
    if (selectedAuthors.length) params.set('authors', selectedAuthors.join(','));
    if (selectedCategories.length) params.set('categories', selectedCategories.join(','));
    if (selectedLanguages.length) params.set('languages', selectedLanguages.join(','));
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    if (sort !== 'relevance') params.set('sort', sort);
    if (statusSegment !== 'all') params.set('status', statusSegment);
    if (viewMode !== 'grid') params.set('view', viewMode);
    const qs = params.toString();
    const url = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
    window.history.replaceState(null, '', url);
  }, [
    searchQuery,
    refineText,
    selectedAuthors,
    selectedCategories,
    selectedLanguages,
    dateFrom,
    dateTo,
    sort,
    statusSegment,
    viewMode,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(VIEW_KEY, viewMode);
  }, [viewMode]);

  const effectiveSearch = useMemo(() => {
    return [searchQuery, refineText].map((s) => s.trim()).filter(Boolean).join(' ');
  }, [searchQuery, refineText]);

  const debouncedEffective = useDebounce(effectiveSearch, 350);

  const resetKey = JSON.stringify({
    debouncedEffective,
    selectedAuthors,
    selectedCategories,
    selectedLanguages,
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

    const params: DocumentsListParams = { page: currentPage };
    if (debouncedEffective) params.search = debouncedEffective;
    if (selectedAuthors.length > 0) params.authors = selectedAuthors;
    if (selectedCategories.length > 0) params.categories = selectedCategories;
    if (selectedLanguages.length > 0) params.language = selectedLanguages[0];
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;

    getDocuments(params)
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
  }, [currentPage, debouncedEffective, selectedAuthors, selectedCategories, selectedLanguages, dateFrom, dateTo, t]);

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
  const grouped = statusSegment === 'all' && viewMode !== 'shelf';
  const flatDocs = useMemo(() => {
    if (statusSegment === 'all') return filteredSorted;
    const wantReady = statusSegment === 'ready';
    return filteredSorted.filter((d) => isDocReady(d) === wantReady);
  }, [filteredSorted, statusSegment]);
  const processingDocs = useMemo(() => filteredSorted.filter((d) => !isDocReady(d)), [filteredSorted]);
  const readyDocs = useMemo(() => filteredSorted.filter(isDocReady), [filteredSorted]);

  const shownCount = grouped ? filteredSorted.length : flatDocs.length;

  const toggleIn = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const clearFilters = () => {
    setSearchQuery('');
    setSearchDraft('');
    setRefineText('');
    setRefineDraft('');
    setSelectedAuthors([]);
    setSelectedCategories([]);
    setSelectedLanguages([]);
    setDateFrom('');
    setDateTo('');
  };

  const hasActiveFilters =
    Boolean(searchQuery) ||
    Boolean(refineText) ||
    selectedAuthors.length > 0 ||
    selectedCategories.length > 0 ||
    selectedLanguages.length > 0 ||
    Boolean(dateFrom) ||
    Boolean(dateTo);

  // Count of active filter *groups* — shown on the mobile "Filters (N)" trigger.
  const activeFilterCount =
    (searchQuery ? 1 : 0) +
    (refineText ? 1 : 0) +
    (selectedAuthors.length ? 1 : 0) +
    (selectedCategories.length ? 1 : 0) +
    (selectedLanguages.length ? 1 : 0) +
    (dateFrom || dateTo ? 1 : 0);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchQuery(searchDraft);
  };

  // Drive a real library search from the assistant panel.
  const askLibrary = useCallback((query: string) => {
    setSearchQuery(query);
    setSearchDraft(query);
    setAssistantOpen(false);
  }, []);

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
      onToggleCategory={(v) => setSelectedCategories((prev) => toggleIn(prev, v))}
      onToggleLanguage={(v) => setSelectedLanguages((prev) => toggleIn(prev, v))}
      onToggleAuthor={(v) => setSelectedAuthors((prev) => toggleIn(prev, v))}
      dateFrom={dateFrom}
      dateTo={dateTo}
      onDateFromChange={setDateFrom}
      onDateToChange={setDateTo}
      hasActiveFilters={hasActiveFilters}
      onClearAll={clearFilters}
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
        {selectedCategories.map((c) => (
          <ActiveChip key={c} label={t('docs.filter.category', 'تصنيف')} value={c} onRemove={() => setSelectedCategories((prev) => prev.filter((x) => x !== c))} />
        ))}
        {selectedLanguages.map((l) => (
          <ActiveChip key={l} label={t('docs.language', 'اللغة')} value={languageName(l)} onRemove={() => setSelectedLanguages((prev) => prev.filter((x) => x !== l))} />
        ))}
        {selectedAuthors.map((a) => (
          <ActiveChip key={a} label={t('docs.filter.author', 'مؤلف')} value={a} onRemove={() => setSelectedAuthors((prev) => prev.filter((x) => x !== a))} />
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

  return (
    <RequireAuth>
      <main className="reading-room min-h-screen">
        <div className="mx-auto max-w-[1400px] px-5 sm:px-9 lg:px-12 relative z-10">
          {/* ─── Header ─── */}
          <section className="pt-9 sm:pt-12 pb-5 border-b border-[#e2d5ba]">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
              <div className="min-w-0">
                <h1 className="rr-title leading-[1.05] tracking-tight" style={{ fontSize: 'clamp(26px, 2.8vw, 38px)' }}>
                  {t('nav.app.library', 'مكتبتي')}
                </h1>
                {initialLoading ? (
                  <div className="mt-3 h-4 w-72 max-w-full rounded-[6px] bg-[#fcf8ee] animate-pulse" />
                ) : totalCount > 0 ? (
                  <p className="mt-2 text-[13px] text-[#6e6354]">
                    {t('docs.header.counts', '{total} مستندات · {ready} جاهزة · {processing} قيد المعالجة', {
                      total: formatCount(totalCount),
                      ready: formatCount(statusCounts.ready),
                      processing: formatCount(statusCounts.processing),
                    })}
                  </p>
                ) : null}
              </div>

              <div className="flex-shrink-0">
                <Link
                  href={localizedPath('/upload')}
                  className="inline-flex items-center gap-2 rounded-full bg-[#b07d2b] text-[#fcf8ee] text-[13.5px] font-semibold px-5 h-11 shadow-[0_4px_18px_-6px_rgba(176,125,43,0.6)] hover:brightness-105 hover:-translate-y-[1px] transition-all"
                >
                  <UploadIcon />
                  {t('nav.app.uploadBook', 'رفع كتاب')}
                </Link>
              </div>
            </div>

            {/* Browse-by-topic chip bar (real category filter) */}
            {!emptyLibrary && (
              <div className="mt-5">
                <ReadingRoomTopicBar
                  selectedCategories={selectedCategories}
                  onToggleCategory={(v) => setSelectedCategories((prev) => toggleIn(prev, v))}
                  onClearCategories={() => setSelectedCategories([])}
                />
              </div>
            )}
          </section>

          {emptyLibrary ? (
            <div className="py-20 text-center">
              <h2 className="rr-title text-[clamp(22px,2.6vw,32px)] mb-3">
                {t('docs.hero.empty.headline', 'ابدأ مكتبتك.')}
              </h2>
              <p className="text-[14px] text-[#6e6354] mb-7 max-w-md mx-auto leading-[1.8]">
                {t('docs.hero.empty.subtext', 'ارفع كتابك الأوّل لتبدأ القراءة مع علم.')}
              </p>
              <Link
                href={localizedPath('/upload')}
                className="inline-flex items-center gap-2 rounded-full bg-[#b07d2b] text-[#fcf8ee] text-[13.5px] font-semibold px-5 h-11 shadow-[0_4px_18px_-6px_rgba(176,125,43,0.6)] hover:brightness-105 transition-all"
              >
                <UploadIcon />
                {t('docs.hero.empty.cta', 'ارفع كتابك الأوّل')}
              </Link>
            </div>
          ) : (
            <div className="pt-6 lg:grid lg:grid-cols-[272px_minmax(0,1fr)] lg:gap-8 xl:grid-cols-[272px_minmax(0,1fr)_340px] lg:items-start">
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
                {/* Mobile filter + assistant triggers */}
                <div className="flex items-center gap-2 mb-4 xl:hidden">
                  {!isDesktop && (
                    <button
                      type="button"
                      onClick={() => setFiltersOpen(true)}
                      className="lg:hidden inline-flex items-center gap-2 px-4 py-2 text-[12.5px] rounded-full border border-[#e2d5ba] bg-[#fcf8ee] text-[#2c2620] hover:border-[#b07d2b] transition-all"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M6 12h12M10 20h4" />
                      </svg>
                      {activeFilterCount > 0
                        ? t('docs.filters.open', 'تصفية ({count})', { count: formatCount(activeFilterCount) })
                        : t('docs.filters', 'المرشحات')}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setAssistantOpen(true)}
                    className="inline-flex items-center gap-2 px-4 py-2 text-[12.5px] rounded-full border border-[#e2d5ba] bg-[#fcf8ee] text-[#2c2620] hover:border-[#b07d2b] transition-all"
                  >
                    <span className="text-[#b07d2b]" aria-hidden>✦</span>
                    {t('docs.rr.assistant.open', 'اسأل المساعد')}
                  </button>
                </div>

                {/* Search */}
                <form onSubmit={submitSearch} className="mb-5 max-w-2xl">
                  <div className="relative">
                    <svg
                      className="absolute top-1/2 -translate-y-1/2 start-3.5 w-4 h-4 text-[#9a8b70] pointer-events-none"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      aria-hidden
                    >
                      <circle cx="11" cy="11" r="7" />
                      <path d="m21 21-4.3-4.3" />
                    </svg>
                    <input
                      type="text"
                      value={searchDraft}
                      onChange={(e) => setSearchDraft(e.target.value)}
                      placeholder={t('docs.zoneC.searchPlaceholder', 'ابحث في مكتبتك…')}
                      dir="auto"
                      aria-label={t('docs.zoneC.searchPlaceholder', 'ابحث في مكتبتك…')}
                      className={SEARCH_INPUT_CLASS}
                    />
                  </div>
                </form>

                {/* Active chips */}
                {renderActiveChips()}

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
                    <select
                      value={sort}
                      onChange={(e) => setSort(e.target.value as SortKey)}
                      className="px-3 py-2 text-[12.5px] bg-[#fcf8ee] border border-[#e2d5ba] rounded-[10px] focus:border-[#b07d2b] outline-none text-[#2c2620] cursor-pointer transition-all"
                    >
                      <option value="relevance">{t('docs.sort.relevance', 'الأكثر صلة')}</option>
                      <option value="newest">{t('docs.sort.newest', 'الأحدث')}</option>
                      <option value="alphabetical">{t('docs.sort.alphabetical', 'أبجدي')}</option>
                      <option value="shortest">{t('docs.sort.shortest', 'الأقصر أولًا')}</option>
                    </select>
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
                    {grouped ? (
                      <>
                        <ContinueShelf />
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

              {/* ─── AI assistant rail (xl and up) ─── */}
              <aside className="hidden xl:block xl:sticky xl:top-6 xl:h-[calc(100vh-3rem)]">
                <LibraryAssistantPanel onAsk={askLibrary} />
              </aside>

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

              {/* Assistant drawer (below xl) */}
              <div className="contents xl:hidden">
                <ReaderPanel
                  isOpen={assistantOpen}
                  onClose={() => setAssistantOpen(false)}
                  title={t('docs.rr.assistant.title', 'المساعد الذكي')}
                >
                  <div className="h-[70vh]">
                    <LibraryAssistantPanel onAsk={askLibrary} hideHeader />
                  </div>
                </ReaderPanel>
              </div>
            </div>
          )}
        </div>
      </main>
    </RequireAuth>
  );
}
