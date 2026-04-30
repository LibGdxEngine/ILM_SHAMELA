'use client';

import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Document, DocumentsListParams, getDocuments } from '@/lib/api';
import BookCard from '@/components/BookCard';
import BookListRow from '@/components/BookListRow';
import BookCardSkeleton from '@/components/BookCardSkeleton';
import RequireAuth from '@/components/RequireAuth';
import LanguageSwitcher from '@/components/i18n/LanguageSwitcher';
import { useI18n } from '@/components/i18n/I18nProvider';
import { useLocalizedPath } from '@/lib/i18n/navigation';

const PAGE_SIZE = 20;
const TOP_FACETS = 7;
const VIEW_KEY = 'ilm.documents.viewMode';

type SortKey = 'relevance' | 'newest' | 'alphabetical' | 'shortest';
type LengthFilter = '' | 'short' | 'medium' | 'long';

const INPUT_BASE =
  'w-full px-4 py-3 rounded-[12px] text-[14px] font-fraunces outline-none transition-all bg-white/[0.02] text-text placeholder:text-text-3 focus:border-accent focus:bg-accent-soft focus:shadow-[0_0_0_4px_rgba(192,133,82,0.08)] disabled:opacity-60 disabled:cursor-not-allowed border border-border';
const SECTION_EYEBROW_CLASS =
  'text-[11px] tracking-[0.18em] uppercase text-accent font-medium';
const PILL_BASE =
  'inline-flex items-center justify-center px-3 py-1 text-[11.5px] rounded-full border transition-all duration-200';
const PILL_ON = `${PILL_BASE} bg-accent-soft border-accent/40 text-accent-2`;
const PILL_OFF = `${PILL_BASE} bg-white/[0.03] border-border-strong text-text-2 hover:border-accent hover:text-accent-2`;

function FadeIn({
  children,
  delay = 0,
  className = '',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1], delay }}
      className={className}
    >
      {children}
    </motion.div>
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
      <div className={`${SECTION_EYEBROW_CLASS} mb-3`}>{label}</div>
      <div className="flex flex-col gap-1.5">
        {values.slice(0, TOP_FACETS).map((v) => {
          const isOn = selected.includes(v);
          return (
            <label key={v} className="flex items-center gap-2.5 cursor-pointer group">
              <input
                type="checkbox"
                checked={isOn}
                onChange={() => onToggle(v)}
                className="w-4 h-4 rounded border-border-strong bg-white/[0.04] accent-[var(--accent,#c08552)]"
              />
              <span
                className={`text-[13px] truncate transition-colors ${
                  isOn
                    ? 'text-accent-2'
                    : 'text-text-2 group-hover:text-text'
                }`}
              >
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
  const localizedPath = useLocalizedPath();

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
    <div className="flex flex-col gap-7">
      <div className="flex items-center justify-between">
        <h2 className="font-fraunces text-[18px] text-text">
          {t('docs.filters', 'المرشحات')}
        </h2>
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="text-[12.5px] text-accent-2 hover:text-text transition-colors"
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
          <div className={`${SECTION_EYEBROW_CLASS} mb-3`}>
            {t('docs.language', 'اللغة')}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {facetValues.languages.slice(0, TOP_FACETS).map((lang) => {
              const on = selectedLanguages.includes(lang);
              return (
                <button
                  key={lang}
                  onClick={() => setSelectedLanguages((prev) => toggleIn(prev, lang))}
                  className={on ? PILL_ON : PILL_OFF}
                >
                  {lang.toUpperCase()}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <div className={`${SECTION_EYEBROW_CLASS} mb-3`}>
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
                className={on ? PILL_ON : PILL_OFF}
              >
                {labels[len]}
              </button>
            );
          })}
        </div>
      </div>

      {decades.length > 0 && (
        <div>
          <div className={`${SECTION_EYEBROW_CLASS} mb-3`}>
            {t('docs.meta.era', 'الحقبة')}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {decades.slice(0, TOP_FACETS).map((d) => {
              const on = selectedDecade === d;
              return (
                <button
                  key={d}
                  onClick={() => setSelectedDecade(on ? null : d)}
                  className={on ? PILL_ON : PILL_OFF}
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
      <div className="pt-5 border-t border-border">
        <div className={`${SECTION_EYEBROW_CLASS} mb-3`}>
          {t('docs.mood.title', 'الموضوع أو الإحساس')}
        </div>
        <textarea
          value={moodText}
          onChange={(e) => setMoodText(e.target.value)}
          placeholder={t('docs.mood.placeholder', 'اكتب ما تبحث عنه…')}
          rows={2}
          className={`${INPUT_BASE} resize-none leading-[1.7]`}
        />
        <p className="mt-2 text-[11.5px] text-text-3">
          {t('docs.mood.hint', 'مثلاً: كتب هادئة للقراءة قبل النوم')}
        </p>
      </div>

      {/* Date range */}
      <details className="group">
        <summary className="list-none [&::-webkit-details-marker]:hidden flex items-center justify-between cursor-pointer text-[11px] tracking-[0.18em] uppercase text-accent font-medium hover:text-accent-2 transition-colors">
          <span>{t('docs.uploadDate', 'تاريخ الرفع')}</span>
          <svg className="w-3 h-3 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </summary>
        <div className="mt-3 space-y-3">
          <label className="block">
            <span className="block text-[11px] text-text-3 mb-1.5">{t('docs.from', 'من')}</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className={`${INPUT_BASE} !text-[12.5px] !py-2`}
            />
          </label>
          <label className="block">
            <span className="block text-[11px] text-text-3 mb-1.5">{t('docs.to', 'إلى')}</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className={`${INPUT_BASE} !text-[12.5px] !py-2`}
            />
          </label>
        </div>
      </details>
    </div>
  );

  const renderActiveChips = () => {
    if (!hasActiveFilters) return null;
    return (
      <div className="flex flex-wrap items-center gap-2 mb-4">
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
        <button onClick={clearFilters} className="text-[12px] text-accent-2 hover:text-text transition-colors px-2 py-1">
          {t('docs.clearAll', 'مسح الكل')}
        </button>
      </div>
    );
  };

  const renderEmpty = () => (
    <div className="bg-gradient-to-b from-card-2 to-card border border-border rounded-[22px] p-10 text-center relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-white/5 to-transparent" />
      <div className="flex items-center justify-center gap-3.5 text-accent mb-6">
        <div className="h-[1px] w-10 bg-gradient-to-r from-transparent to-accent" />
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" /></svg>
        <div className="h-[1px] w-10 bg-gradient-to-r from-accent to-transparent" />
      </div>
      <h3 className="font-fraunces font-light text-[clamp(24px,3vw,32px)] leading-[1.15] text-text mb-3">
        {t('docs.empty.didYouMean', 'هل تقصد…؟')}
      </h3>
      <p className="text-[14px] text-text-2 mb-7 max-w-md mx-auto leading-[1.8]">
        {t('docs.adjustFilters', 'جرّب تعديل المرشحات لعرض نتائج أكثر.')}
      </p>
      <div className="flex flex-wrap justify-center gap-2 mb-7">
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
            className={PILL_OFF}
          >
            {s}
          </button>
        ))}
      </div>
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

  const currentPlaceholder = placeholders[placeholderIdx] ?? placeholders[0];

  return (
    <RequireAuth>
      <main className="landing-shell min-h-screen">
        {/* Top bar — brand mark + back to home */}
        <div className="px-6 sm:px-10 lg:px-16 pt-8 flex items-center justify-between relative z-10">
          <Link href={localizedPath('/')} className="flex items-center gap-2">
            <span className="font-fraunces text-[24px] text-accent-2 leading-none">ع</span>
            <span className="font-fraunces text-[18px] tracking-tight">
              ILM <em className="italic text-text-2">Shamela</em>
            </span>
          </Link>
          <div className="flex items-center gap-5 sm:gap-7">
            <Link
              href={localizedPath('/upload')}
              className="hidden sm:flex items-center gap-2 text-[13px] text-text-3 hover:text-text-2 transition-colors"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              {t('nav.upload', 'Upload')}
            </Link>
            <Link
              href={localizedPath('/profile')}
              className="hidden sm:flex items-center gap-2 text-[13px] text-text-3 hover:text-text-2 transition-colors"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              {t('nav.profile', 'Profile')}
            </Link>
            <Link
              href={localizedPath('/')}
              className="flex items-center gap-2 text-[13px] text-text-3 hover:text-text-2 transition-colors"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <path d="m15 18-6-6 6-6" />
              </svg>
              {t('login.backHome', 'Back to home')}
            </Link>
            <LanguageSwitcher />
          </div>
        </div>

        {/* Header */}
        <div className="mx-auto max-w-[1280px] px-6 sm:px-10 lg:px-16 pt-12 relative z-10">
          <header className="mb-10 max-w-3xl">
            <FadeIn>
              <span className="section-eyebrow">{t('docs.eyebrow', 'Library')}</span>
            </FadeIn>
            <FadeIn delay={0.05}>
              <h1 className="font-fraunces font-light text-[clamp(36px,5vw,56px)] leading-[1.05] tracking-tight mt-5 text-text">
                {t('docs.title', 'المكتبة')}
              </h1>
            </FadeIn>
            <FadeIn delay={0.1}>
              <p className="mt-4 text-[16px] leading-relaxed text-text-2">
                {t('docs.subtitle', 'تصفّح كتبك والنتائج بسهولة.')}
              </p>
            </FadeIn>
          </header>
        </div>

        {/* Sticky AI search bar */}
        <div className="sticky top-0 z-30 backdrop-blur-xl bg-bg/80 border-b border-border">
          <div className="max-w-[1280px] mx-auto px-6 sm:px-10 lg:px-16 py-4">
            <form
              onSubmit={submitSearch}
              className="search-shell bg-gradient-to-b from-card-2/90 to-card/90 border border-border rounded-[20px] p-1.5 shadow-2xl relative"
            >
              <div className="flex items-center gap-3 px-4">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className="text-accent flex-shrink-0"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
                <input
                  type="text"
                  value={searchDraft}
                  onChange={(e) => setSearchDraft(e.target.value)}
                  placeholder={currentPlaceholder}
                  aria-label={t('docs.ai.searchAria', 'بحث بالذكاء الاصطناعي')}
                  dir="auto"
                  className="bg-transparent border-none outline-none font-fraunces text-[15px] text-text placeholder:text-text-3 placeholder:italic w-full py-2.5 px-1 min-w-0"
                />
                <button
                  type="submit"
                  className="btn-primary flex-shrink-0 flex items-center gap-2 !text-[13px]"
                >
                  {t('docs.ai.searchSubmit', 'ابحث')}
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M5 12h14M13 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </form>
          </div>
        </div>

        <div className="max-w-[1280px] mx-auto px-6 sm:px-10 lg:px-16 py-8 relative z-10">
          <div className="flex flex-col lg:flex-row gap-6">
            {/* Mobile filter toggle */}
            <button
              onClick={() => setShowMobileFilters((v) => !v)}
              className="lg:hidden inline-flex items-center justify-center gap-2 px-4 py-3 text-[13px] rounded-[14px] border border-border-strong text-text bg-white/5 hover:bg-white/10 hover:border-accent transition-all"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              {showMobileFilters
                ? t('docs.hideFilters', 'إخفاء المرشحات')
                : t('docs.showFilters', 'إظهار المرشحات')}
              {hasActiveFilters && (
                <span className="w-2 h-2 rounded-full bg-accent" aria-hidden />
              )}
            </button>

            {/* Filter rail */}
            <aside
              className={`lg:w-72 flex-shrink-0 ${
                showMobileFilters ? 'block' : 'hidden lg:block'
              }`}
            >
              <FadeIn delay={0.15}>
                <div className="bg-gradient-to-b from-card-2 to-card border border-border rounded-[22px] p-6 lg:sticky lg:top-[110px] relative overflow-hidden">
                  <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-white/5 to-transparent" />
                  {renderFacetSection()}
                </div>
              </FadeIn>
            </aside>

            {/* Main results area */}
            <section className="flex-1 min-w-0">
              {renderActiveChips()}

              {/* Results summary strip */}
              {!isLoading && accumulated.length > 0 && (
                <FadeIn className="mb-5">
                  <div className="flex items-start gap-3 p-4 rounded-[14px] bg-accent-soft border border-accent/20">
                    <span className="mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full bg-accent/20 text-accent-2 text-[11px] flex-shrink-0">
                      ✦
                    </span>
                    <p className="text-[13.5px] leading-[1.7] text-text-2 font-fraunces">
                      {summarySentence}
                    </p>
                  </div>
                </FadeIn>
              )}

              {/* Sort + refine + view toggle */}
              <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                <div className="flex items-center gap-2">
                  <label className="text-[11.5px] tracking-[0.12em] uppercase text-text-3">
                    {t('docs.sort.label', 'الترتيب')}
                  </label>
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as SortKey)}
                    className="px-3 py-2 text-[12.5px] font-fraunces bg-white/[0.03] border border-border-strong rounded-[10px] focus:border-accent focus:bg-accent-soft outline-none text-text cursor-pointer transition-all"
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
                      className={`inline-flex items-center gap-1.5 px-3 py-2 text-[12.5px] rounded-[10px] border transition-all ${
                        refineText
                          ? 'bg-accent-soft border-accent/40 text-accent-2'
                          : 'bg-white/[0.03] border-border-strong text-text-2 hover:border-accent hover:text-accent-2'
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
                        className="absolute top-full mt-2 start-0 z-20 w-[320px] p-4 bg-card-2 border border-border-strong rounded-[16px] shadow-[0_18px_42px_-10px_rgba(0,0,0,0.55)]"
                      >
                        <textarea
                          value={refineDraft}
                          onChange={(e) => setRefineDraft(e.target.value)}
                          placeholder={t('docs.refine.placeholder', 'اجعل النتائج أقصر، استبعد الروايات…')}
                          rows={2}
                          autoFocus
                          className={`${INPUT_BASE} resize-none leading-[1.7]`}
                        />
                        <div className="mt-3 flex items-center justify-end gap-2">
                          <button
                            onClick={closeRefine}
                            className="px-3 py-1.5 text-[12px] text-text-3 hover:text-text transition-colors"
                          >
                            {t('docs.refine.cancel', 'إلغاء')}
                          </button>
                          <button
                            onClick={applyRefine}
                            className="btn-primary !text-[12px] !px-3.5 !py-1.5"
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
                    <span className="text-[11.5px] tracking-wide text-text-3">
                      {t('docs.loadMoreProgress', '{shown} من {total}', {
                        shown: accumulated.length,
                        total: totalCount,
                      })}
                    </span>
                  )}
                  <div className="flex items-center gap-1 p-1 bg-white/[0.04] border border-border rounded-[12px]">
                    <button
                      onClick={() => setViewMode('grid')}
                      aria-pressed={viewMode === 'grid'}
                      aria-label={t('docs.grid', 'عرض شبكي')}
                      className={`p-1.5 rounded-[8px] transition-all ${
                        viewMode === 'grid'
                          ? 'bg-accent-soft text-accent-2 shadow-[inset_0_0_0_1px_rgba(192,133,82,0.25)]'
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
                      className={`p-1.5 rounded-[8px] transition-all ${
                        viewMode === 'list'
                          ? 'bg-accent-soft text-accent-2 shadow-[inset_0_0_0_1px_rgba(192,133,82,0.25)]'
                          : 'text-text-3 hover:text-text'
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
                <div className="bg-gradient-to-b from-card-2 to-card border border-red-500/30 rounded-[22px] p-8 text-center">
                  <p className="text-red-300 mb-4 text-[14px]">{error}</p>
                  <button
                    onClick={retry}
                    className="btn-primary !text-[13px]"
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
                  <div className="mt-10 flex flex-col items-center gap-2.5">
                    {hasNext ? (
                      <button
                        onClick={loadMore}
                        disabled={isLoadingMore}
                        className="inline-flex items-center gap-2 px-6 py-3 text-[13.5px] rounded-full border border-border-strong text-text bg-white/5 hover:bg-white/10 hover:border-accent transition-all disabled:opacity-60"
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
                      <span className="text-[12px] text-text-3">
                        {t('docs.endOfResults', 'انتهت النتائج')}
                      </span>
                    )}
                    <span className="text-[11.5px] text-text-3 tracking-wide">
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
