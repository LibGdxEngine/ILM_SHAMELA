'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Document, DocumentsListParams, getDocuments } from '@/lib/api';
import BookCard from '@/components/BookCard';
import BookListRow from '@/components/BookListRow';
import BookCardSkeleton from '@/components/BookCardSkeleton';
import RequireAuth from '@/components/RequireAuth';
import { useI18n } from '@/components/i18n/I18nProvider';

const PAGE_SIZE = 20;
const TOP_FACETS = 7;
const VIEW_KEY = 'ilm.documents.viewMode';

type SortKey = 'relevance' | 'newest' | 'alphabetical' | 'shortest';
type LengthFilter = '' | 'short' | 'medium' | 'long';

function categoryName(c: unknown): string | null {
  if (!c) return null;
  if (typeof c === 'string') return c;
  if (typeof c === 'object' && c !== null && 'name' in c) {
    const n = (c as { name?: unknown }).name;
    return typeof n === 'string' ? n : null;
  }
  return null;
}

function docLengthBucket(doc: Document): LengthFilter {
  const len = doc.content?.length ?? 0;
  if (!len) return '';
  if (len < 60_000) return 'short';
  if (len < 250_000) return 'medium';
  return 'long';
}

function decadeOf(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const y = Number(raw.slice(0, 4));
  if (!Number.isFinite(y)) return null;
  return Math.floor(y / 10) * 10;
}

function useRotatingIndex(length: number, intervalMs: number): number {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (length <= 1) return;
    const id = setInterval(() => setIdx((i) => (i + 1) % length), intervalMs);
    return () => clearInterval(id);
  }, [length, intervalMs]);
  return idx;
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
      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[12px] bg-warm-sand dark:bg-[#3d3d3a] text-charcoal-warm dark:text-warm-silver rounded-full ring-1 ring-ring-warm dark:ring-[#4d4c48] hover:bg-border-cream dark:hover:bg-dark-surface transition-colors"
    >
      <span className="text-stone-gray">{label}:</span>
      <span>{value}</span>
      <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  );
}

interface FacetListProps {
  label: string;
  values: string[];
  selected: string[];
  onToggle: (v: string) => void;
}
function FacetList({ label, values, selected, onToggle }: FacetListProps) {
  if (values.length === 0) return null;
  return (
    <div>
      <div className="text-[12px] uppercase tracking-wider text-stone-gray mb-2">{label}</div>
      <div className="flex flex-col gap-1">
        {values.slice(0, TOP_FACETS).map((v) => {
          const isOn = selected.includes(v);
          return (
            <label key={v} className="flex items-center gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={isOn}
                onChange={() => onToggle(v)}
                className="w-4 h-4 rounded border-ring-warm accent-terracotta"
              />
              <span className={`text-[13px] truncate ${isOn ? 'text-terracotta' : 'text-charcoal-warm dark:text-warm-silver group-hover:text-near-black dark:group-hover:text-ivory'} transition-colors`}>
                {v}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export default function DocumentsPage() {
  const { t, locale } = useI18n();

  /* ─── Core query state ─── */
  const [searchQuery, setSearchQuery] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [moodText, setMoodText] = useState('');
  const [refineText, setRefineText] = useState('');
  const [refineDraft, setRefineDraft] = useState('');
  const [refineOpen, setRefineOpen] = useState(false);

  const [selectedAuthors, setSelectedAuthors] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);
  const [lengthFilter, setLengthFilter] = useState<LengthFilter>('');
  const [selectedDecade, setSelectedDecade] = useState<number | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [sort, setSort] = useState<SortKey>('relevance');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  /* ─── Data state ─── */
  const [accumulated, setAccumulated] = useState<Document[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMobileFilters, setShowMobileFilters] = useState(false);

  /* ─── Hydrate from URL (?q=) and localStorage (viewMode) ─── */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    if (q) {
      setSearchQuery(q);
      setSearchDraft(q);
    }
    const savedView = window.localStorage.getItem(VIEW_KEY);
    if (savedView === 'list' || savedView === 'grid') setViewMode(savedView);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(VIEW_KEY, viewMode);
  }, [viewMode]);

  /* ─── Build effective search string ─── */
  const effectiveSearch = useMemo(() => {
    return [searchQuery, moodText, refineText]
      .map((s) => s.trim())
      .filter(Boolean)
      .join(' ');
  }, [searchQuery, moodText, refineText]);

  const debouncedEffective = useDebounce(effectiveSearch, 350);

  /* ─── Fetch when filters change (reset) or currentPage changes (append) ─── */
  const resetKey = JSON.stringify({
    debouncedEffective,
    selectedAuthors,
    selectedCategories,
    selectedLanguages,
    dateFrom,
    dateTo,
  });

  // Unified fetch controller: resetKey changes reset page+accumulated; currentPage>1 appends.
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
        if (seq !== requestSeq.current) return; // superseded
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

  // Reset to page 1 whenever filters change (but not on currentPage changes)
  useEffect(() => {
    setCurrentPage(1);
  }, [resetKey]);

  const retry = useCallback(() => {
    requestSeq.current++;
    setCurrentPage(1);
  }, []);

  /* ─── Derived: available facet values, scanned from what we've loaded ─── */
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

  /* ─── Client-side filter (length, decade) + sort ─── */
  const filteredSorted = useMemo(() => {
    let list = accumulated;
    if (lengthFilter) list = list.filter((d) => docLengthBucket(d) === lengthFilter);
    if (selectedDecade !== null) list = list.filter((d) => decadeOf(d.written_date) === selectedDecade);

    const sorted = [...list];
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
  }, [accumulated, lengthFilter, selectedDecade, sort, locale]);

  const shownCount = filteredSorted.length;
  const decades = useMemo(() => {
    const set = new Set<number>();
    for (const d of accumulated) {
      const decade = decadeOf(d.written_date);
      if (decade !== null) set.add(decade);
    }
    return [...set].sort((a, b) => b - a);
  }, [accumulated]);

  /* ─── Results summary (single-sentence shape description) ─── */
  const summarySentence = useMemo(() => {
    if (accumulated.length === 0) return '';
    const topCats = facetValues.categories.slice(0, 2);
    const topLang = facetValues.languages[0];
    if (topCats.length > 0) {
      return t('docs.results.summaryWithCats', 'Mostly in {categories}.', {
        categories: topCats.join('، '),
      });
    }
    if (topLang) {
      return t('docs.results.summaryWithLang', 'Most in {language}.', { language: topLang });
    }
    return t('docs.results.summaryFallback', 'A mixed selection across topics.');
  }, [accumulated.length, facetValues, t]);

  /* ─── Rotating AI search placeholder ─── */
  const placeholders = useMemo(
    () => [
      t('docs.ai.searchPlaceholder1', 'روايات قصيرة تشبه مئة عام من العزلة'),
      t('docs.ai.searchPlaceholder2', 'كتب عن الفلسفة الإسلامية للمبتدئين'),
      t('docs.ai.searchPlaceholder3', 'سير ذاتية لكتّاب من القرن العشرين'),
      t('docs.ai.searchPlaceholder4', 'كتب تراث مختصرة في علم النحو'),
    ],
    [t]
  );
  const placeholderIdx = useRotatingIndex(placeholders.length, 3800);

  /* ─── Handlers ─── */
  const toggleIn = (arr: string[], v: string) =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  const clearFilters = () => {
    setSearchQuery('');
    setSearchDraft('');
    setMoodText('');
    setRefineText('');
    setRefineDraft('');
    setSelectedAuthors([]);
    setSelectedCategories([]);
    setSelectedLanguages([]);
    setLengthFilter('');
    setSelectedDecade(null);
    setDateFrom('');
    setDateTo('');
  };

  const hasActiveFilters =
    Boolean(searchQuery) ||
    Boolean(moodText) ||
    Boolean(refineText) ||
    selectedAuthors.length > 0 ||
    selectedCategories.length > 0 ||
    selectedLanguages.length > 0 ||
    Boolean(lengthFilter) ||
    selectedDecade !== null ||
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

  const refinePopoverRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!refineOpen) return;
    const handler = (e: MouseEvent) => {
      if (!refinePopoverRef.current) return;
      const target = e.target as Node;
      if (!refinePopoverRef.current.contains(target)) closeRefine();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [refineOpen, closeRefine]);

  const loadMore = () => {
    if (!hasNext || isLoadingMore) return;
    setCurrentPage((p) => p + 1);
  };

  /* ─── Render pieces ─── */
  const renderFacetSection = () => (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-[1.15rem] text-near-black dark:text-ivory">
          {t('docs.filters', 'المرشحات')}
        </h2>
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="text-[12.5px] text-terracotta hover:underline"
          >
            {t('docs.clearAll', 'مسح الكل')}
          </button>
        )}
      </div>

      <FacetList
        label={t('docs.categories', 'التصنيفات')}
        values={facetValues.categories}
        selected={selectedCategories}
        onToggle={(v) => setSelectedCategories((prev) => toggleIn(prev, v))}
      />

      {facetValues.languages.length > 0 && (
        <div>
          <div className="text-[12px] uppercase tracking-wider text-stone-gray mb-2">
            {t('docs.language', 'اللغة')}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {facetValues.languages.slice(0, TOP_FACETS).map((lang) => {
              const on = selectedLanguages.includes(lang);
              return (
                <button
                  key={lang}
                  onClick={() => setSelectedLanguages((prev) => toggleIn(prev, lang))}
                  className={`px-2.5 py-0.5 text-[11.5px] rounded-full ring-1 transition-colors ${
                    on
                      ? 'bg-terracotta text-ivory ring-terracotta'
                      : 'bg-ivory dark:bg-dark-surface text-charcoal-warm dark:text-warm-silver ring-ring-warm dark:ring-[#4d4c48] hover:ring-terracotta'
                  }`}
                >
                  {lang.toUpperCase()}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <div className="text-[12px] uppercase tracking-wider text-stone-gray mb-2">
          {t('docs.meta.length', 'طول القراءة')}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(['short', 'medium', 'long'] as const).map((len) => {
            const labels: Record<typeof len, string> = {
              short: t('docs.meta.short', 'قراءة قصيرة'),
              medium: t('docs.meta.medium', 'قراءة متوسطة'),
              long: t('docs.meta.long', 'قراءة طويلة'),
            };
            const on = lengthFilter === len;
            return (
              <button
                key={len}
                onClick={() => setLengthFilter(on ? '' : len)}
                className={`px-2.5 py-0.5 text-[11.5px] rounded-full ring-1 transition-colors ${
                  on
                    ? 'bg-terracotta text-ivory ring-terracotta'
                    : 'bg-ivory dark:bg-dark-surface text-charcoal-warm dark:text-warm-silver ring-ring-warm dark:ring-[#4d4c48] hover:ring-terracotta'
                }`}
              >
                {labels[len]}
              </button>
            );
          })}
        </div>
      </div>

      {decades.length > 0 && (
        <div>
          <div className="text-[12px] uppercase tracking-wider text-stone-gray mb-2">
            {t('docs.meta.era', 'الحقبة')}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {decades.slice(0, TOP_FACETS).map((d) => {
              const on = selectedDecade === d;
              return (
                <button
                  key={d}
                  onClick={() => setSelectedDecade(on ? null : d)}
                  className={`px-2.5 py-0.5 text-[11.5px] rounded-full ring-1 transition-colors ${
                    on
                      ? 'bg-terracotta text-ivory ring-terracotta'
                      : 'bg-ivory dark:bg-dark-surface text-charcoal-warm dark:text-warm-silver ring-ring-warm dark:ring-[#4d4c48] hover:ring-terracotta'
                  }`}
                >
                  {d}s
                </button>
              );
            })}
          </div>
        </div>
      )}

      <FacetList
        label={t('docs.authors', 'المؤلفون')}
        values={facetValues.authors}
        selected={selectedAuthors}
        onToggle={(v) => setSelectedAuthors((prev) => toggleIn(prev, v))}
      />

      {/* Mood/theme AI input */}
      <div className="pt-2 border-t border-border-cream dark:border-[#3d3d3a]">
        <div className="text-[12px] uppercase tracking-wider text-stone-gray mb-2">
          {t('docs.mood.title', 'الموضوع أو الإحساس')}
        </div>
        <textarea
          value={moodText}
          onChange={(e) => setMoodText(e.target.value)}
          placeholder={t('docs.mood.placeholder', 'اكتب ما تبحث عنه…')}
          rows={2}
          className="w-full px-3 py-2 text-[13px] bg-parchment dark:bg-near-black border border-border-cream dark:border-[#3d3d3a] rounded-lg focus:border-terracotta focus:ring-1 focus:ring-terracotta outline-none text-charcoal-warm dark:text-warm-silver placeholder:text-stone-gray resize-none leading-[1.7]"
        />
        <p className="mt-1 text-[11px] text-stone-gray">
          {t('docs.mood.hint', 'مثلاً: كتب هادئة للقراءة قبل النوم')}
        </p>
      </div>

      {/* Date range */}
      <details className="group">
        <summary className="list-none [&::-webkit-details-marker]:hidden flex items-center justify-between cursor-pointer text-[12px] uppercase tracking-wider text-stone-gray">
          <span>{t('docs.uploadDate', 'تاريخ الرفع')}</span>
          <svg className="w-3 h-3 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </summary>
        <div className="mt-3 space-y-2">
          <label className="block">
            <span className="block text-[11px] text-stone-gray mb-1">{t('docs.from', 'من')}</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full px-2 py-1.5 text-[12.5px] bg-parchment dark:bg-near-black border border-border-cream dark:border-[#3d3d3a] rounded-md focus:border-terracotta focus:ring-1 focus:ring-terracotta outline-none text-charcoal-warm dark:text-warm-silver"
            />
          </label>
          <label className="block">
            <span className="block text-[11px] text-stone-gray mb-1">{t('docs.to', 'إلى')}</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full px-2 py-1.5 text-[12.5px] bg-parchment dark:bg-near-black border border-border-cream dark:border-[#3d3d3a] rounded-md focus:border-terracotta focus:ring-1 focus:ring-terracotta outline-none text-charcoal-warm dark:text-warm-silver"
            />
          </label>
        </div>
      </details>
    </div>
  );

  const renderActiveChips = () => {
    if (!hasActiveFilters) return null;
    return (
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {searchQuery && (
          <ActiveChip label={t('docs.search', 'بحث')} value={searchQuery} onRemove={() => { setSearchQuery(''); setSearchDraft(''); }} />
        )}
        {moodText && (
          <ActiveChip label={t('docs.mood.title', 'الموضوع')} value={moodText} onRemove={() => setMoodText('')} />
        )}
        {refineText && (
          <ActiveChip label={t('docs.refine.button', 'تنقيح')} value={refineText} onRemove={() => { setRefineText(''); setRefineDraft(''); }} />
        )}
        {selectedCategories.map((c) => (
          <ActiveChip key={c} label={t('docs.filter.category', 'تصنيف')} value={c} onRemove={() => setSelectedCategories((prev) => prev.filter((x) => x !== c))} />
        ))}
        {selectedLanguages.map((l) => (
          <ActiveChip key={l} label={t('docs.language', 'اللغة')} value={l.toUpperCase()} onRemove={() => setSelectedLanguages((prev) => prev.filter((x) => x !== l))} />
        ))}
        {selectedAuthors.map((a) => (
          <ActiveChip key={a} label={t('docs.filter.author', 'مؤلف')} value={a} onRemove={() => setSelectedAuthors((prev) => prev.filter((x) => x !== a))} />
        ))}
        {lengthFilter && (
          <ActiveChip
            label={t('docs.meta.length', 'الطول')}
            value={
              lengthFilter === 'short'
                ? t('docs.meta.short', 'قراءة قصيرة')
                : lengthFilter === 'medium'
                ? t('docs.meta.medium', 'قراءة متوسطة')
                : t('docs.meta.long', 'قراءة طويلة')
            }
            onRemove={() => setLengthFilter('')}
          />
        )}
        {selectedDecade !== null && (
          <ActiveChip label={t('docs.meta.era', 'حقبة')} value={`${selectedDecade}s`} onRemove={() => setSelectedDecade(null)} />
        )}
        {(dateFrom || dateTo) && (
          <ActiveChip label={t('docs.filter.date', 'تاريخ')} value={`${dateFrom || '…'} — ${dateTo || '…'}`} onRemove={() => { setDateFrom(''); setDateTo(''); }} />
        )}
        <button onClick={clearFilters} className="text-[12px] text-terracotta hover:underline px-2 py-1">
          {t('docs.clearAll', 'مسح الكل')}
        </button>
      </div>
    );
  };

  const renderEmpty = () => (
    <div className="rounded-2xl border border-border-cream dark:border-[#3d3d3a] bg-ivory dark:bg-dark-surface p-10 text-center">
      <h3 className="font-serif text-[1.4rem] text-near-black dark:text-ivory mb-2">
        {t('docs.empty.didYouMean', 'هل تقصد…؟')}
      </h3>
      <p className="text-[13px] text-olive-gray dark:text-warm-silver mb-6 max-w-md mx-auto leading-[1.8]">
        {t('docs.adjustFilters', 'جرّب تعديل المرشحات لعرض نتائج أكثر.')}
      </p>
      <div className="flex flex-wrap justify-center gap-2 mb-6">
        {[
          t('docs.empty.suggest1', 'تصفّح حسب التصنيف'),
          t('docs.empty.suggest2', 'أحدث الإضافات'),
          t('docs.empty.suggest3', 'الأكثر قراءة'),
        ].map((s, i) => (
          <button
            key={i}
            onClick={() => {
              if (i === 1) { setSort('newest'); clearFilters(); }
              else if (i === 2) { setSort('newest'); clearFilters(); }
              else { clearFilters(); }
            }}
            className="px-3 py-1.5 text-[12.5px] rounded-full bg-warm-sand dark:bg-[#3d3d3a] text-charcoal-warm dark:text-warm-silver ring-1 ring-ring-warm dark:ring-[#4d4c48] hover:ring-terracotta transition-colors"
          >
            {s}
          </button>
        ))}
      </div>
      <button
        onClick={clearFilters}
        className="inline-flex items-center gap-2 text-[13px] text-terracotta hover:text-terracotta/80"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        {t('docs.empty.searchAll', 'ابحث في كامل المكتبة')}
      </button>
    </div>
  );

  const currentPlaceholder = placeholders[placeholderIdx] ?? placeholders[0];

  return (
    <RequireAuth>
      <main className="min-h-screen bg-parchment dark:bg-near-black">
        {/* Sticky AI search bar */}
        <div className="sticky top-0 z-30 bg-parchment/90 dark:bg-near-black/90 backdrop-blur-md border-b border-border-cream dark:border-[#3d3d3a]">
          <div className="max-w-[1280px] mx-auto px-4 py-3">
            <form onSubmit={submitSearch} className="relative">
              <svg className="absolute start-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-stone-gray pointer-events-none" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                placeholder={currentPlaceholder}
                aria-label={t('docs.ai.searchAria', 'بحث بالذكاء الاصطناعي')}
                dir="auto"
                className="w-full ps-12 pe-28 py-3.5 text-[15px] bg-ivory dark:bg-dark-surface border border-border-cream dark:border-[#3d3d3a] rounded-full shadow-whisper focus:border-terracotta focus:ring-2 focus:ring-terracotta/30 outline-none text-near-black dark:text-ivory placeholder:text-stone-gray leading-[1.7] transition-all"
              />
              <button
                type="submit"
                className="absolute end-2 top-1/2 -translate-y-1/2 px-4 py-2 text-[13px] rounded-full bg-terracotta text-ivory hover:bg-terracotta/90 transition-colors"
              >
                {t('docs.ai.searchSubmit', 'ابحث')}
              </button>
            </form>
          </div>
        </div>

        <div className="max-w-[1280px] mx-auto px-4 py-6">
          {/* Page title (compact, not hero) */}
          <div className="mb-5">
            <h1 className="font-serif text-[1.7rem] leading-[1.3] text-near-black dark:text-ivory">
              {t('docs.title', 'المكتبة')}
            </h1>
            <p className="text-[13px] text-olive-gray dark:text-warm-silver mt-0.5">
              {t('docs.subtitle', 'تصفّح كتبك والنتائج بسهولة.')}
            </p>
          </div>

          <div className="flex flex-col lg:flex-row gap-6">
            {/* Mobile filter toggle */}
            <button
              onClick={() => setShowMobileFilters((v) => !v)}
              className="lg:hidden flex items-center justify-center gap-2 px-4 py-2.5 bg-ivory dark:bg-dark-surface border border-border-cream dark:border-[#3d3d3a] rounded-lg text-[13px] text-charcoal-warm dark:text-warm-silver"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              {showMobileFilters
                ? t('docs.hideFilters', 'إخفاء المرشحات')
                : t('docs.showFilters', 'إظهار المرشحات')}
              {hasActiveFilters && (
                <span className="w-2 h-2 rounded-full bg-terracotta" aria-hidden />
              )}
            </button>

            {/* Filter rail — logical-start side (right in RTL) */}
            <aside
              className={`lg:w-72 flex-shrink-0 ${
                showMobileFilters ? 'block' : 'hidden lg:block'
              }`}
            >
              <div className="bg-ivory dark:bg-dark-surface rounded-xl border border-border-cream dark:border-[#3d3d3a] p-5 lg:sticky lg:top-[84px]">
                {renderFacetSection()}
              </div>
            </aside>

            {/* Main results area */}
            <section className="flex-1 min-w-0">
              {renderActiveChips()}

              {/* Results summary strip */}
              {!isLoading && accumulated.length > 0 && (
                <div className="mb-4 flex items-start gap-2 p-3 rounded-lg bg-ivory/60 dark:bg-dark-surface/60 border border-border-cream dark:border-[#3d3d3a]">
                  <span className="mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-terracotta/10 text-terracotta text-[10px] flex-shrink-0">
                    ✦
                  </span>
                  <p className="text-[13px] leading-[1.7] text-charcoal-warm dark:text-warm-silver">
                    {summarySentence}
                  </p>
                </div>
              )}

              {/* Sort + refine + view toggle */}
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2">
                  <label className="text-[12px] text-stone-gray">{t('docs.sort.label', 'الترتيب')}</label>
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as SortKey)}
                    className="px-3 py-1.5 text-[12.5px] bg-ivory dark:bg-dark-surface border border-border-cream dark:border-[#3d3d3a] rounded-md focus:border-terracotta outline-none text-charcoal-warm dark:text-warm-silver"
                  >
                    <option value="relevance">{t('docs.sort.relevance', 'الأكثر صلة')}</option>
                    <option value="newest">{t('docs.sort.newest', 'الأحدث')}</option>
                    <option value="alphabetical">{t('docs.sort.alphabetical', 'أبجدي')}</option>
                    <option value="shortest">{t('docs.sort.shortest', 'الأقصر أولًا')}</option>
                  </select>

                  <div className="relative" ref={refinePopoverRef}>
                    <button
                      onClick={() => setRefineOpen((v) => !v)}
                      aria-haspopup="dialog"
                      aria-expanded={refineOpen}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] rounded-md ring-1 transition-colors ${
                        refineText
                          ? 'bg-terracotta text-ivory ring-terracotta'
                          : 'bg-ivory dark:bg-dark-surface text-charcoal-warm dark:text-warm-silver ring-ring-warm dark:ring-[#4d4c48] hover:ring-terracotta'
                      }`}
                    >
                      <span aria-hidden>✦</span>
                      {t('docs.refine.button', 'نقّح بالذكاء الاصطناعي')}
                    </button>
                    {refineOpen && (
                      <div
                        role="dialog"
                        aria-label={t('docs.refine.button', 'نقّح بالذكاء الاصطناعي')}
                        onKeyDown={(e) => { if (e.key === 'Escape') closeRefine(); }}
                        className="absolute top-full mt-2 start-0 z-20 w-[320px] p-3 bg-ivory dark:bg-dark-surface border border-border-cream dark:border-[#3d3d3a] rounded-xl shadow-whisper"
                      >
                        <textarea
                          value={refineDraft}
                          onChange={(e) => setRefineDraft(e.target.value)}
                          placeholder={t('docs.refine.placeholder', 'اجعل النتائج أقصر، استبعد الروايات…')}
                          rows={2}
                          autoFocus
                          className="w-full px-3 py-2 text-[13px] bg-parchment dark:bg-near-black border border-border-cream dark:border-[#3d3d3a] rounded-md focus:border-terracotta outline-none text-charcoal-warm dark:text-warm-silver placeholder:text-stone-gray resize-none leading-[1.7]"
                        />
                        <div className="mt-2 flex items-center justify-end gap-2">
                          <button
                            onClick={closeRefine}
                            className="px-3 py-1 text-[12px] text-stone-gray hover:text-charcoal-warm"
                          >
                            {t('docs.refine.cancel', 'إلغاء')}
                          </button>
                          <button
                            onClick={applyRefine}
                            className="px-3 py-1 text-[12px] rounded-md bg-terracotta text-ivory hover:bg-terracotta/90"
                          >
                            {t('docs.refine.apply', 'تطبيق')}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {!isLoading && !error && (
                    <span className="text-[12.5px] text-stone-gray">
                      {t('docs.loadMoreProgress', '{shown} من {total}', {
                        shown: accumulated.length,
                        total: totalCount,
                      })}
                    </span>
                  )}
                  <div className="flex items-center gap-1 p-0.5 bg-warm-sand dark:bg-[#3d3d3a] rounded-md">
                    <button
                      onClick={() => setViewMode('grid')}
                      aria-pressed={viewMode === 'grid'}
                      aria-label={t('docs.grid', 'عرض شبكي')}
                      className={`p-1.5 rounded transition-colors ${
                        viewMode === 'grid'
                          ? 'bg-ivory dark:bg-near-black text-terracotta shadow-whisper'
                          : 'text-stone-gray hover:text-charcoal-warm'
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
                      className={`p-1.5 rounded transition-colors ${
                        viewMode === 'list'
                          ? 'bg-ivory dark:bg-near-black text-terracotta shadow-whisper'
                          : 'text-stone-gray hover:text-charcoal-warm'
                      }`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>

              {/* Content area */}
              {error ? (
                <div className="rounded-xl border border-border-cream dark:border-[#3d3d3a] bg-ivory dark:bg-dark-surface p-8 text-center">
                  <p className="text-error-crimson mb-4">{error}</p>
                  <button
                    onClick={retry}
                    className="px-4 py-2 text-[13px] rounded-full bg-terracotta text-ivory hover:bg-terracotta/90"
                  >
                    {t('docs.tryAgain', 'إعادة المحاولة')}
                  </button>
                </div>
              ) : isLoading ? (
                <div
                  className={
                    viewMode === 'grid'
                      ? 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4'
                      : 'flex flex-col gap-3'
                  }
                >
                  {Array.from({ length: 8 }).map((_, i) => (
                    <BookCardSkeleton key={i} variant={viewMode} />
                  ))}
                </div>
              ) : shownCount === 0 ? (
                renderEmpty()
              ) : (
                <>
                  {viewMode === 'grid' ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                      {filteredSorted.map((doc) => (
                        <BookCard key={doc.id} document={doc} />
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {filteredSorted.map((doc) => (
                        <BookListRow key={doc.id} document={doc} />
                      ))}
                    </div>
                  )}

                  {/* Load more */}
                  <div className="mt-8 flex flex-col items-center gap-2">
                    {hasNext ? (
                      <button
                        onClick={loadMore}
                        disabled={isLoadingMore}
                        className="inline-flex items-center gap-2 px-6 py-3 text-[13.5px] rounded-full bg-ivory dark:bg-dark-surface border border-border-cream dark:border-[#3d3d3a] hover:border-terracotta text-charcoal-warm dark:text-warm-silver transition-colors disabled:opacity-60"
                      >
                        {isLoadingMore ? (
                          <span className="inline-block w-4 h-4 border-2 border-terracotta border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                          </svg>
                        )}
                        {t('docs.loadMore', 'عرض المزيد')}
                      </button>
                    ) : (
                      <span className="text-[12px] text-stone-gray">
                        {t('docs.endOfResults', 'انتهت النتائج')}
                      </span>
                    )}
                    <span className="text-[11.5px] text-stone-gray">
                      {t('docs.loadMoreProgress', '{shown} من {total}', {
                        shown: accumulated.length,
                        total: totalCount,
                      })}
                    </span>
                  </div>
                </>
              )}
            </section>
          </div>
        </div>
      </main>
    </RequireAuth>
  );
}
