'use client';

import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Document, DocumentsListParams, getDocuments } from '@/lib/api';
import BookCard from '@/components/BookCard';
import BookListRow from '@/components/BookListRow';
import BookCardSkeleton from '@/components/BookCardSkeleton';
import RequireAuth from '@/components/RequireAuth';
import ContinueShelf from '@/components/documents/ContinueShelf';
import LibraryHero from '@/components/documents/LibraryHero';
import LibraryTopicShortcuts, { type TopicShortcut } from '@/components/documents/LibraryTopicShortcuts';
import { useI18n } from '@/components/i18n/I18nProvider';
import { useLanguageName } from '@/lib/i18n/languageName';
import { toLocaleDigits } from '@/lib/utils';

const TOP_FACETS = 7;
const VIEW_KEY = 'ilm.documents.viewMode';
const TOPIC_SHORTCUT_LIMIT = 6;
const META_FACET_MIN_BOOKS = 10;

type SortKey = 'relevance' | 'newest' | 'alphabetical' | 'shortest';
type EraFilter = '' | 'classical' | 'modern';

const SECTION_EYEBROW_CLASS =
  'text-[11px] tracking-[0.18em] uppercase text-accent font-medium';
const PILL_BASE =
  'inline-flex items-center justify-center px-3 py-1 text-[11.5px] rounded-full border transition-all duration-200';
const PILL_ON = `${PILL_BASE} bg-accent-soft border-accent/40 text-accent-2`;
const PILL_OFF = `${PILL_BASE} bg-card border-border-strong text-text-2 hover:border-accent hover:text-accent-2`;
const SEARCH_INPUT_CLASS =
  'w-full ps-10 pe-3 py-2.5 rounded-[12px] text-[14px] font-fraunces outline-none transition-all bg-card text-text placeholder:text-text-3 focus:border-accent focus:bg-accent-soft/40 focus:shadow-[0_0_0_4px_rgba(185,115,64,0.08)] border border-border';
const DATE_INPUT_CLASS =
  'w-full px-3 py-2 rounded-[10px] text-[12.5px] font-fraunces outline-none transition-all bg-card text-text placeholder:text-text-3 focus:border-accent focus:bg-accent-soft/40 focus:shadow-[0_0_0_4px_rgba(185,115,64,0.08)] border border-border';

function FadeIn({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
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

function yearOf(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const y = Number(raw.slice(0, 4));
  return Number.isFinite(y) ? y : null;
}

function centuryOf(raw: string | null | undefined): number | null {
  const y = yearOf(raw);
  if (y === null) return null;
  return Math.floor((y - 1) / 100) + 1;
}

function eraOf(raw: string | null | undefined): EraFilter {
  const y = yearOf(raw);
  if (y === null) return '';
  return y < 1900 ? 'classical' : 'modern';
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
                className="w-4 h-4 rounded border-border-strong bg-card accent-[var(--accent,#b97340)]"
              />
              <span className={`text-[13px] truncate transition-colors ${isOn ? 'text-accent-2' : 'text-text-2 group-hover:text-text'}`}>
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
  const languageName = useLanguageName();

  /* ─── Query state ─── */
  const [searchQuery, setSearchQuery] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [refineText, setRefineText] = useState('');
  const [refineDraft, setRefineDraft] = useState('');
  const [refineOpen, setRefineOpen] = useState(false);

  const [selectedAuthors, setSelectedAuthors] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);
  const [selectedCentury, setSelectedCentury] = useState<number | null>(null);
  const [selectedEra, setSelectedEra] = useState<EraFilter>('');
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

  const zoneCRef = useRef<HTMLElement>(null);

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

  const topicShortcuts = useMemo<TopicShortcut[]>(() => {
    if (facetValues.categories.length < 2) return [];
    return facetValues.categories.slice(0, TOPIC_SHORTCUT_LIMIT).map((name) => {
      const docs = accumulated.filter((d) =>
        (d.categories ?? []).some((c) => categoryName(c) === name)
      );
      return {
        name,
        count: docs.length,
        seeds: docs.slice(0, 3).map((d) => d.title),
      };
    });
  }, [facetValues.categories, accumulated]);

  const filteredSorted = useMemo(() => {
    let list = accumulated;
    if (selectedCentury !== null) list = list.filter((d) => centuryOf(d.written_date) === selectedCentury);
    if (selectedEra) list = list.filter((d) => eraOf(d.written_date) === selectedEra);

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
  }, [accumulated, selectedCentury, selectedEra, sort, locale]);

  const shownCount = filteredSorted.length;

  const centuries = useMemo(() => {
    const set = new Set<number>();
    for (const d of accumulated) {
      const c = centuryOf(d.written_date);
      if (c !== null) set.add(c);
    }
    return [...set].sort((a, b) => b - a);
  }, [accumulated]);

  const summarySentence = useMemo(() => {
    if (accumulated.length === 0) return '';
    const topCats = facetValues.categories.slice(0, 2);
    const topLangCode = facetValues.languages[0];
    if (topCats.length > 0) {
      return t('docs.results.summaryWithCats', 'Mostly in {categories}.', { categories: topCats.join('، ') });
    }
    if (topLangCode) {
      return t('docs.results.summaryWithLang', 'Most in {language}.', { language: languageName(topLangCode) });
    }
    return t('docs.results.summaryFallback', 'A mixed selection across topics.');
  }, [accumulated.length, facetValues, t, languageName]);

  const toggleIn = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const clearFilters = () => {
    setSearchQuery('');
    setSearchDraft('');
    setRefineText('');
    setRefineDraft('');
    setSelectedAuthors([]);
    setSelectedCategories([]);
    setSelectedLanguages([]);
    setSelectedCentury(null);
    setSelectedEra('');
    setDateFrom('');
    setDateTo('');
  };

  const hasActiveFilters =
    Boolean(searchQuery) ||
    Boolean(refineText) ||
    selectedAuthors.length > 0 ||
    selectedCategories.length > 0 ||
    selectedLanguages.length > 0 ||
    selectedCentury !== null ||
    Boolean(selectedEra) ||
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

  const handleTopicSelect = (name: string) => {
    setSelectedCategories([name]);
    requestAnimationFrame(() => {
      zoneCRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const showLanguageFacet = facetValues.languages.length > 1;
  const showMetaFacets = totalCount >= META_FACET_MIN_BOOKS && centuries.length > 0;
  const initialLoading = isLoading && accumulated.length === 0;

  const renderFacetSection = () => (
    <div className="flex flex-col gap-7">
      <div className="flex items-center justify-between">
        <h2 className="font-fraunces text-[18px] text-text">{t('docs.filters', 'المرشحات')}</h2>
        {hasActiveFilters && (
          <button onClick={clearFilters} className="text-[12.5px] text-accent-2 hover:text-text transition-colors">
            {t('docs.clearAll', 'مسح الكل')}
          </button>
        )}
      </div>

      <FacetList
        label={t('docs.categories', 'العلم')}
        values={facetValues.categories}
        selected={selectedCategories}
        onToggle={(v) => setSelectedCategories((prev) => toggleIn(prev, v))}
      />

      {showLanguageFacet && (
        <div>
          <div className={`${SECTION_EYEBROW_CLASS} mb-3`}>{t('docs.language', 'اللغة')}</div>
          <div className="flex flex-wrap gap-1.5">
            {facetValues.languages.slice(0, TOP_FACETS).map((lang) => {
              const on = selectedLanguages.includes(lang);
              return (
                <button
                  key={lang}
                  onClick={() => setSelectedLanguages((prev) => toggleIn(prev, lang))}
                  className={on ? PILL_ON : PILL_OFF}
                  title={lang.toUpperCase()}
                >
                  {languageName(lang)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {showMetaFacets && (
        <div>
          <div className={`${SECTION_EYEBROW_CLASS} mb-3`}>{t('docs.meta.century', 'القرن')}</div>
          <div className="flex flex-wrap gap-1.5">
            {centuries.slice(0, TOP_FACETS).map((c) => {
              const on = selectedCentury === c;
              return (
                <button
                  key={c}
                  onClick={() => setSelectedCentury(on ? null : c)}
                  className={on ? PILL_ON : PILL_OFF}
                >
                  {t('docs.meta.centuryLabel', 'ق {n}', { n: toLocaleDigits(c, locale) })}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {showMetaFacets && (
        <div>
          <div className={`${SECTION_EYEBROW_CLASS} mb-3`}>{t('docs.meta.era', 'العصر')}</div>
          <div className="flex flex-wrap gap-1.5">
            {(['classical', 'modern'] as const).map((era) => {
              const labels: Record<typeof era, string> = {
                classical: t('docs.meta.era.classical', 'كلاسيكي'),
                modern: t('docs.meta.era.modern', 'حديث'),
              };
              const on = selectedEra === era;
              return (
                <button
                  key={era}
                  onClick={() => setSelectedEra(on ? '' : era)}
                  className={on ? PILL_ON : PILL_OFF}
                >
                  {labels[era]}
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
        {selectedCentury !== null && (
          <ActiveChip
            label={t('docs.meta.century', 'القرن')}
            value={t('docs.meta.centuryLabel', 'ق {n}', { n: toLocaleDigits(selectedCentury, locale) })}
            onRemove={() => setSelectedCentury(null)}
          />
        )}
        {selectedEra && (
          <ActiveChip
            label={t('docs.meta.era', 'العصر')}
            value={selectedEra === 'classical' ? t('docs.meta.era.classical', 'كلاسيكي') : t('docs.meta.era.modern', 'حديث')}
            onRemove={() => setSelectedEra('')}
          />
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

  return (
    <RequireAuth>
      <main className="landing-shell min-h-screen">
        <div className="mx-auto max-w-[1280px] px-6 sm:px-10 lg:px-16 relative z-10">
          {initialLoading ? (
            <div className="pt-10 sm:pt-14 pb-7 border-b border-border">
              <div className="h-12 w-72 rounded-[8px] bg-card animate-pulse" />
              <div className="mt-4 h-4 w-96 max-w-full rounded-[6px] bg-card animate-pulse" />
            </div>
          ) : (
            <LibraryHero count={totalCount} topicsCount={facetValues.categories.length} />
          )}

          {totalCount > 0 && (
            <div className="pt-10">
              <FadeIn delay={0.05}>
                <ContinueShelf />
              </FadeIn>

              <FadeIn delay={0.1}>
                <LibraryTopicShortcuts topics={topicShortcuts} onSelect={handleTopicSelect} />
              </FadeIn>

              <section ref={zoneCRef} className="scroll-mt-24">
                <div className="mb-6 flex items-end justify-between gap-4">
                  <div>
                    <span className={SECTION_EYEBROW_CLASS}>{t('docs.zoneC.eyebrow', 'كل ما لديك')}</span>
                    <h2 className="mt-2 font-reem-kufi font-semibold text-[clamp(22px,2.4vw,28px)] leading-[1.15] text-text">
                      {t('docs.zoneC.title', 'كامل مكتبتك')}
                    </h2>
                  </div>
                </div>

                <form onSubmit={submitSearch} className="mb-6 max-w-xl">
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

                <div className="flex flex-col lg:flex-row gap-6">
                  <button
                    onClick={() => setShowMobileFilters((v) => !v)}
                    className="lg:hidden inline-flex items-center justify-center gap-2 px-4 py-3 text-[13px] rounded-[14px] border border-border-strong text-text bg-card hover:bg-bg-2 hover:border-accent transition-all"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                    </svg>
                    {showMobileFilters ? t('docs.hideFilters', 'إخفاء المرشحات') : t('docs.showFilters', 'إظهار المرشحات')}
                    {hasActiveFilters && <span className="w-2 h-2 rounded-full bg-accent" aria-hidden />}
                  </button>

                  <aside className={`lg:w-72 flex-shrink-0 ${showMobileFilters ? 'block' : 'hidden lg:block'}`}>
                    <div className="bg-card border border-border rounded-[22px] p-6 lg:sticky lg:top-[80px]">
                      {renderFacetSection()}
                    </div>
                  </aside>

                  <section className="flex-1 min-w-0">
                    {renderActiveChips()}

                    {!isLoading && accumulated.length > 0 && (
                      <p className="mb-5 inline-flex items-center gap-2 text-[12.5px] text-text-3 font-fraunces">
                        <span className="text-accent" aria-hidden>✦</span>
                        {summarySentence}
                      </p>
                    )}

                    {!isLoading && !error && shownCount > 0 && effectiveSearch && renderRefineBar()}

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
                        </div>
                      </div>
                    </div>

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
                      renderEmptyResults()
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
                            <span className="text-[12px] text-text-3">
                              {t('docs.endOfResults', 'انتهت النتائج')}
                            </span>
                          )}
                          <span className="text-[11.5px] text-text-3 tracking-wide">
                            {t('docs.loadMoreProgress', '{shown} من {total}', {
                              shown: formatCount(accumulated.length),
                              total: formatCount(totalCount),
                            })}
                          </span>
                        </div>
                      </>
                    )}
                  </section>
                </div>
              </section>
            </div>
          )}
        </div>
      </main>
    </RequireAuth>
  );
}
