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
import { useI18n } from '@/components/i18n/I18nProvider';
import { useLanguageName } from '@/lib/i18n/languageName';
import { useLocalizedPath } from '@/lib/i18n/navigation';
import { useContinueReading } from '@/lib/reader/useContinueReading';
import { legendForDocuments } from '@/lib/coverPalettes';
import { toLocaleDigits } from '@/lib/utils';

const TOP_FACETS = 7;
const VIEW_KEY = 'ilm.documents.viewMode';
const PROGRESS_FETCH_LIMIT = 100;

type SortKey = 'relevance' | 'newest' | 'alphabetical' | 'shortest';
type ViewMode = 'grid' | 'list' | 'shelf';
type StatusSegment = 'all' | 'ready' | 'processing';

const SECTION_EYEBROW_CLASS =
  'text-[11px] tracking-[0.18em] uppercase text-accent font-medium';
const PILL_BASE =
  'inline-flex items-center justify-center gap-1.5 px-3 py-1 text-[11.5px] rounded-full border transition-all duration-200';
const PILL_ON = `${PILL_BASE} bg-accent-soft border-accent/40 text-accent-2`;
const PILL_OFF = `${PILL_BASE} bg-card border-border-strong text-text-2 hover:border-accent hover:text-accent-2`;
const SEARCH_INPUT_CLASS =
  'w-full ps-10 pe-3 py-2.5 rounded-[12px] text-[14px] font-fraunces outline-none transition-all bg-card text-text placeholder:text-text-3 focus:border-accent focus:bg-accent-soft/40 focus:shadow-[0_0_0_4px_rgba(185,115,64,0.08)] border border-border';
const DATE_INPUT_CLASS =
  'w-full px-3 py-2 rounded-[10px] text-[12.5px] font-fraunces outline-none transition-all bg-card text-text placeholder:text-text-3 focus:border-accent focus:bg-accent-soft/40 focus:shadow-[0_0_0_4px_rgba(185,115,64,0.08)] border border-border';

function UploadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function categoryName(c: unknown): string | null {
  if (!c) return null;
  if (typeof c === 'string') return c;
  if (typeof c === 'object' && c !== null && 'name' in c) {
    const n = (c as { name?: unknown }).name;
    return typeof n === 'string' ? n : null;
  }
  return null;
}

function isDocReady(d: Document): boolean {
  return d.processing_status ? d.processing_status === 'succeeded' : d.processed;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const h = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(h);
  }, [value, delay]);
  return debounced;
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
      className="inline-flex items-center gap-1.5 px-3 py-1 text-[12px] bg-accent-soft border border-accent/30 text-accent-2 rounded-full hover:border-accent hover:bg-accent/15 transition-colors"
    >
      <span className="text-text-3">{label}:</span>
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

  /* ─── Data state ─── */
  const [accumulated, setAccumulated] = useState<Document[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    if (q) {
      setSearchQuery(q);
      setSearchDraft(q);
    }
    const savedView = window.localStorage.getItem(VIEW_KEY);
    if (savedView === 'list' || savedView === 'grid' || savedView === 'shelf') {
      setViewMode(savedView);
    }
  }, []);

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

  const facetValues = useMemo(() => {
    const authors = new Map<string, number>();
    const categories = new Map<string, number>();
    const languages = new Map<string, number>();
    for (const d of accumulated) {
      for (const a of d.authors ?? []) {
        authors.set(a.name, (authors.get(a.name) ?? 0) + 1);
      }
      for (const c of d.categories ?? []) {
        const name = categoryName(c);
        if (name) categories.set(name, (categories.get(name) ?? 0) + 1);
      }
      if (d.language) languages.set(d.language, (languages.get(d.language) ?? 0) + 1);
    }
    const byCount = (a: [string, number], b: [string, number]) => b[1] - a[1];
    return {
      authors: [...authors.entries()].sort(byCount).map(([k]) => k),
      categories: [...categories.entries()].sort(byCount).map(([k]) => k),
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

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchQuery(searchDraft);
  };

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

  const renderPillGroup = (
    values: string[],
    selected: string[],
    onToggle: (v: string) => void,
    displayFn?: (v: string) => string
  ) =>
    values.slice(0, TOP_FACETS).map((v) => {
      const on = selected.includes(v);
      return (
        <button key={v} onClick={() => onToggle(v)} className={on ? PILL_ON : PILL_OFF} title={v}>
          {displayFn ? displayFn(v) : v}
        </button>
      );
    });

  const renderFilterRow = () => {
    const hasAny =
      facetValues.languages.length > 0 ||
      facetValues.authors.length > 0 ||
      facetValues.categories.length > 0;
    if (!hasAny) return null;
    return (
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-[12px] text-text-3 me-0.5">{t('docs.filterLabel', 'تصفية')}:</span>

        {facetValues.categories.length > 0 &&
          renderPillGroup(facetValues.categories, selectedCategories, (v) =>
            setSelectedCategories((prev) => toggleIn(prev, v))
          )}

        {facetValues.languages.length > 0 && facetValues.categories.length > 0 && (
          <span className="w-px h-4 bg-border-strong" aria-hidden />
        )}
        {facetValues.languages.length > 0 &&
          renderPillGroup(
            facetValues.languages,
            selectedLanguages,
            (v) => setSelectedLanguages((prev) => toggleIn(prev, v)),
            (v) => languageName(v)
          )}

        {facetValues.authors.length > 0 && (
          <>
            <span className="w-px h-4 bg-border-strong" aria-hidden />
            {renderPillGroup(facetValues.authors, selectedAuthors, (v) =>
              setSelectedAuthors((prev) => toggleIn(prev, v))
            )}
          </>
        )}

        <details className="relative">
          <summary
            className={`${PILL_OFF} cursor-pointer list-none [&::-webkit-details-marker]:hidden ${
              dateFrom || dateTo ? '!border-accent/40 !text-accent-2 !bg-accent-soft' : ''
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M16 2v4M8 2v4M3 10h18" />
            </svg>
            {t('docs.uploadDate', 'تاريخ الرفع')}
          </summary>
          <div className="absolute z-20 mt-2 end-0 w-60 bg-card border border-border rounded-[14px] p-3 shadow-[0_12px_36px_-12px_rgba(0,0,0,0.5)] space-y-3">
            <label className="block">
              <span className="block text-[11px] text-text-3 mb-1.5">{t('docs.from', 'من')}</span>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={DATE_INPUT_CLASS} />
            </label>
            <label className="block">
              <span className="block text-[11px] text-text-3 mb-1.5">{t('docs.to', 'إلى')}</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={DATE_INPUT_CLASS} />
            </label>
          </div>
        </details>
      </div>
    );
  };

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
        <button onClick={clearFilters} className="text-[12px] text-accent-2 hover:text-text transition-colors px-2 py-1">
          {t('docs.clearAll', 'مسح الكل')}
        </button>
      </div>
    );
  };

  const renderLegend = () => {
    if (!showLegend) return null;
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-5 text-[11.5px] text-text-3">
        <span className="text-accent">{t('docs.legend.title', 'الألوان حسب الفئة')}:</span>
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
    <div className="bg-card border border-border rounded-[22px] p-10 text-center">
      <div className="flex items-center justify-center gap-3.5 text-accent mb-6">
        <div className="h-[1px] w-10 bg-gradient-to-r from-transparent to-accent" />
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" /></svg>
        <div className="h-[1px] w-10 bg-gradient-to-r from-accent to-transparent" />
      </div>
      <h3 className="font-reem-kufi font-semibold text-[clamp(20px,2.4vw,28px)] leading-[1.15] text-text mb-3">
        {t('docs.empty.didYouMean', 'هل تقصد…؟')}
      </h3>
      <p className="text-[14px] text-text-2 mb-7 max-w-md mx-auto leading-[1.8]">
        {t('docs.adjustFilters', 'جرّب تعديل المرشحات لعرض نتائج أكثر.')}
      </p>
      <button
        onClick={clearFilters}
        className="inline-flex items-center gap-2 text-[13px] text-accent-2 hover:text-text transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        {t('docs.empty.searchAll', 'ابحث في كامل المكتبة')}
      </button>
    </div>
  );

  const renderRefineBar = () => (
    <div className="mb-5 bg-card border border-border rounded-[18px] overflow-hidden">
      {refineOpen ? (
        <div className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-accent" aria-hidden>✦</span>
            <span className="font-fraunces text-[14.5px] text-text">
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
            className="w-full px-3 py-2 rounded-[10px] text-[14px] font-fraunces outline-none transition-all bg-bg-2 text-text placeholder:text-text-3 focus:border-accent focus:shadow-[0_0_0_4px_rgba(185,115,64,0.08)] border border-border resize-none leading-[1.7]"
          />
          <div className="mt-3 flex items-center justify-end gap-2">
            <button onClick={closeRefine} className="px-3 py-1.5 text-[12.5px] text-text-3 hover:text-text transition-colors">
              {t('docs.refine.cancel', 'إلغاء')}
            </button>
            <button onClick={applyRefine} className="btn-primary !text-[12.5px] !px-4 !py-1.5">
              {t('docs.refine.apply', 'تطبيق')}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setRefineOpen(true)}
          className="w-full text-start p-4 flex items-start gap-3 hover:bg-accent-soft/30 transition-colors"
        >
          <span className="mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full bg-accent/15 text-accent flex-shrink-0">✦</span>
          <span className="flex-1 min-w-0">
            <span className="block font-fraunces text-[14.5px] text-text">
              {t('docs.refine.inline.title', 'نقّح هذه النتائج بالذكاء الاصطناعي')}
            </span>
            <span className="block mt-0.5 text-[12.5px] text-text-3 line-clamp-1">
              {t('docs.refine.inline.hint', 'اجعلها أقصر، استبعد الروايات، ركّز على القرن العاشر…')}
            </span>
          </span>
          <svg className="w-4 h-4 text-text-3 mt-1 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
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
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {docs.map((doc) => (
          <BookCard key={doc.id} document={doc} progressPercent={progressByDoc.get(doc.id)} />
        ))}
      </div>
    );
  };

  const renderGroup = (title: string, docs: Document[]) => {
    if (docs.length === 0) return null;
    return (
      <section className="mb-10">
        <div className="mb-4 flex items-baseline gap-2.5">
          <h2 className="font-reem-kufi font-semibold text-[clamp(18px,2vw,22px)] leading-[1.15] text-text">{title}</h2>
          <span className="text-[12px] text-text-3">{formatCount(docs.length)}</span>
        </div>
        {renderDocs(docs)}
      </section>
    );
  };

  const renderShelf = (docs: Document[]) => (
    <div className="pb-1">
      <div className="flex flex-wrap items-end gap-1.5 pb-3 border-b-[3px] border-[var(--warm-deep)]/40 shadow-[0_10px_20px_-16px_rgba(0,0,0,0.7)]">
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
          className="inline-flex items-center gap-2 px-6 py-3 text-[13.5px] rounded-full border border-border-strong text-text bg-card hover:bg-bg-2 hover:border-accent transition-all disabled:opacity-60"
        >
          {isLoadingMore ? (
            <span className="inline-block w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          )}
          {t('docs.loadMore', 'عرض المزيد')}
        </button>
      ) : (
        <span className="text-[12px] text-text-3">{t('docs.endOfResults', 'انتهت النتائج')}</span>
      )}
      <span className="text-[11.5px] text-text-3 tracking-wide">
        {t('docs.loadMoreProgress', '{shown} من {total}', {
          shown: formatCount(accumulated.length),
          total: formatCount(totalCount),
        })}
      </span>
    </div>
  );

  const segments: { key: StatusSegment; label: string; count: number }[] = [
    { key: 'all', label: t('docs.segment.all', 'الكل'), count: totalCount },
    { key: 'ready', label: t('docs.segment.ready', 'جاهزة'), count: statusCounts.ready },
    { key: 'processing', label: t('docs.segment.processing', 'قيد المعالجة'), count: statusCounts.processing },
  ];

  const emptyLibrary = !isLoading && !error && totalCount === 0 && !hasActiveFilters;

  return (
    <RequireAuth>
      <main className="landing-shell min-h-screen">
        <div className="mx-auto max-w-[1280px] px-6 sm:px-10 lg:px-16 relative z-10">
          {/* ─── Slim header ─── */}
          <section className="pt-10 sm:pt-14 pb-6 border-b border-border">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
              <div className="min-w-0">
                <h1
                  className="font-reem-kufi font-semibold text-text leading-[1.05] tracking-tight"
                  style={{ fontSize: 'clamp(26px, 2.8vw, 38px)' }}
                >
                  {t('nav.app.library', 'مكتبتي')}
                </h1>
                {initialLoading ? (
                  <div className="mt-3 h-4 w-72 max-w-full rounded-[6px] bg-card animate-pulse" />
                ) : totalCount > 0 ? (
                  <p className="mt-2 text-[13px] text-text-2">
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
                  className="inline-flex items-center gap-2 rounded-full bg-gradient-to-b from-accent-2 to-accent text-white text-[13.5px] font-medium px-5 h-11 shadow-[0_4px_20px_-4px_rgba(185,115,64,0.45),inset_0_1px_0_rgba(255,255,255,0.22)] hover:-translate-y-[1px] hover:shadow-[0_10px_30px_-6px_rgba(185,115,64,0.6),inset_0_1px_0_rgba(255,255,255,0.28)] transition-all"
                >
                  <UploadIcon />
                  {t('nav.app.uploadBook', 'رفع كتاب')}
                </Link>
              </div>
            </div>
          </section>

          {emptyLibrary ? (
            <div className="py-20 text-center">
              <h2 className="font-reem-kufi font-semibold text-[clamp(22px,2.6vw,32px)] text-text mb-3">
                {t('docs.hero.empty.headline', 'ابدأ مكتبتك.')}
              </h2>
              <p className="text-[14px] text-text-2 mb-7 max-w-md mx-auto leading-[1.8]">
                {t('docs.hero.empty.subtext', 'ارفع كتابك الأوّل لتبدأ القراءة مع علم.')}
              </p>
              <Link
                href={localizedPath('/upload')}
                className="inline-flex items-center gap-2 rounded-full bg-gradient-to-b from-accent-2 to-accent text-white text-[13.5px] font-medium px-5 h-11 shadow-[0_4px_20px_-4px_rgba(185,115,64,0.45)] transition-all"
              >
                <UploadIcon />
                {t('docs.hero.empty.cta', 'ارفع كتابك الأوّل')}
              </Link>
            </div>
          ) : (
            <div className="pt-8">
              {/* Search */}
              <form onSubmit={submitSearch} className="mb-5 max-w-xl">
                <div className="relative">
                  <svg
                    className="absolute top-1/2 -translate-y-1/2 start-3 w-4 h-4 text-text-3 pointer-events-none"
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

              {/* Status segments */}
              <div className="flex flex-wrap items-center gap-2 mb-4">
                {segments.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => setStatusSegment(s.key)}
                    aria-pressed={statusSegment === s.key}
                    className={statusSegment === s.key ? PILL_ON : PILL_OFF}
                  >
                    {s.label}
                    <span className="text-text-3">{formatCount(s.count)}</span>
                  </button>
                ))}
              </div>

              {/* Inline filters */}
              {renderFilterRow()}

              {/* Active chips */}
              {renderActiveChips()}

              {/* Legend */}
              {renderLegend()}

              {/* AI refine */}
              {!isLoading && !error && shownCount > 0 && effectiveSearch && renderRefineBar()}

              {/* Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                <div className="flex items-center gap-2">
                  <label className="text-[11.5px] tracking-[0.12em] uppercase text-text-3">
                    {t('docs.sort.label', 'الترتيب')}
                  </label>
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as SortKey)}
                    className="px-3 py-2 text-[12.5px] font-fraunces bg-card border border-border-strong rounded-[10px] focus:border-accent outline-none text-text cursor-pointer transition-all"
                  >
                    <option value="relevance">{t('docs.sort.relevance', 'الأكثر صلة')}</option>
                    <option value="newest">{t('docs.sort.newest', 'الأحدث')}</option>
                    <option value="alphabetical">{t('docs.sort.alphabetical', 'أبجدي')}</option>
                    <option value="shortest">{t('docs.sort.shortest', 'الأقصر أولًا')}</option>
                  </select>
                </div>

                <div className="flex items-center gap-3">
                  {!isLoading && !error && (
                    <span className="text-[11.5px] tracking-wide text-text-3">
                      {t('docs.loadMoreProgress', '{shown} من {total}', {
                        shown: formatCount(accumulated.length),
                        total: formatCount(totalCount),
                      })}
                    </span>
                  )}
                  <div className="flex items-center gap-1 p-1 bg-card border border-border rounded-[12px]">
                    <button
                      onClick={() => setViewMode('grid')}
                      aria-pressed={viewMode === 'grid'}
                      aria-label={t('docs.grid', 'عرض شبكي')}
                      title={t('docs.grid', 'عرض شبكي')}
                      className={`p-1.5 rounded-[8px] transition-all ${
                        viewMode === 'grid'
                          ? 'bg-accent-soft text-accent-2 shadow-[inset_0_0_0_1px_rgba(185,115,64,0.25)]'
                          : 'text-text-3 hover:text-text'
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
                          ? 'bg-accent-soft text-accent-2 shadow-[inset_0_0_0_1px_rgba(185,115,64,0.25)]'
                          : 'text-text-3 hover:text-text'
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
                          ? 'bg-accent-soft text-accent-2 shadow-[inset_0_0_0_1px_rgba(185,115,64,0.25)]'
                          : 'text-text-3 hover:text-text'
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
                <div className="bg-card border border-red-500/30 rounded-[22px] p-8 text-center">
                  <p className="text-red-700 mb-4 text-[14px]">{error}</p>
                  <button onClick={retry} className="btn-primary !text-[13px]">
                    {t('docs.tryAgain', 'إعادة المحاولة')}
                  </button>
                </div>
              ) : isLoading ? (
                <div
                  className={
                    viewMode === 'list'
                      ? 'flex flex-col gap-3'
                      : 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4'
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
                      {renderGroup(t('docs.group.all', t('docs.zoneC.title', 'كامل مكتبتك')), readyDocs)}
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
          )}
        </div>
      </main>
    </RequireAuth>
  );
}
