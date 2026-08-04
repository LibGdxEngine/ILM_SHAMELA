'use client';

// Reader & Search v2 panel (from the "ILM Shamela - Reader & Search v2" design).
// One `mode=all` request per query; the الكل/تام/لفظي/دلالي tabs and the sort
// control filter/order that single result set client-side. The scope control
// switches between this book (in-document search) and the whole library
// (corpus search via `getDocumentsSearch`, no kind classification).

import { useEffect, useMemo, useRef, useState } from 'react';

import { useI18n } from '@/components/i18n/I18nProvider';
import type { Document, DocumentSearchMatch, DocumentSearchResponse, DocumentsListResponse } from '@/lib/api';
import {
  buildResultsCsv,
  countMatchesByKind,
  filterMatchesByTab,
  filterMatchesByTerm,
  formatCitation,
  resolveMatchKind,
  resultKey,
  sortMatches,
  type SearchKindTab,
  type SearchScope,
  type SearchSort,
} from '@/lib/reader/searchPanelUtils';
import { termColor } from '@/lib/search/termColors';
import {
  createSearchTerm,
  type SearchTerm,
  type TermFuzziness,
  type TermMatch,
  type TermOp,
} from '@/lib/search/terms';
import { toLocaleDigits } from '@/lib/utils';
import PanelIconButton from './PanelIconButton';
import SearchEmptyState from './SearchEmptyState';
import SearchKindTabs from './SearchKindTabs';
import SearchOptionsAccordion from './SearchOptionsAccordion';
import SearchResultCardV2, { LibraryResultCard } from './SearchResultCardV2';

interface AdvancedSearchPanelProps {
  query: string;
  /** Multi-term rows; empty = classic single-input search. */
  terms: SearchTerm[];
  onTermsChange: (terms: SearchTerm[]) => void;
  scope: SearchScope;
  tab: SearchKindTab;
  sort: SearchSort;
  threshold: number;
  ignoreDiacritics: boolean;
  /** Book-scope results (mode=all). */
  results: DocumentSearchResponse | null;
  /** Library-scope results (corpus endpoint). */
  libraryResults: DocumentsListResponse | null;
  isSearching: boolean;
  error?: string | null;
  /** Suggested query words shown in the empty state (frequent chapter terms). */
  suggestions: string[];
  recentTerms: string[];
  pinnedTerms: string[];
  /** Book title for citations and library-card contrast. */
  bookTitle: string;
  /** `resultKey`s of matches already saved as notes (drives «محفوظ»). */
  savedKeys: ReadonlySet<string>;
  /** Increment to focus the search input (Ctrl+F / Ctrl+K). */
  focusToken?: number;
  onQueryChange: (q: string) => void;
  /** A deliberate search commit (Enter / chip pick) → recents MRU. */
  onCommitQuery: (q: string) => void;
  onScopeChange: (s: SearchScope) => void;
  onTabChange: (t: SearchKindTab) => void;
  onSortChange: (s: SearchSort) => void;
  onThresholdChange: (t: number) => void;
  onDiacriticsChange: (v: boolean) => void;
  onClear: () => void;
  onGoToPage: (page: number) => void;
  onOpenLibraryResult: (documentId: number) => void;
  onPinTerm: (term: string) => void;
  onToggleSaveResult: (match: DocumentSearchMatch, citation: string) => void;
  onToast: (message: string) => void;
  /** Optional resolver: page number → chapter title (for result locations). */
  chapterTitleForPage?: (page: number) => string | null;
  /** Pinned = docked column; unpinned = floating overlay. */
  pinned?: boolean;
  onTogglePin?: () => void;
  onClose?: () => void;
}

export default function AdvancedSearchPanel({
  query,
  terms,
  onTermsChange,
  scope,
  tab,
  sort,
  threshold,
  ignoreDiacritics,
  results,
  libraryResults,
  isSearching,
  error,
  suggestions,
  recentTerms,
  pinnedTerms,
  bookTitle,
  savedKeys,
  focusToken,
  onQueryChange,
  onCommitQuery,
  onScopeChange,
  onTabChange,
  onSortChange,
  onThresholdChange,
  onDiacriticsChange,
  onClear,
  onGoToPage,
  onOpenLibraryResult,
  onPinTerm,
  onToggleSaveResult,
  onToast,
  chapterTitleForPage,
  pinned,
  onTogglePin,
  onClose,
}: AdvancedSearchPanelProps) {
  const { t, locale } = useI18n();
  const isRtl = locale === 'ar' || locale === 'fa' || locale === 'ur';
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusToken) inputRef.current?.focus();
  }, [focusToken]);

  const num = (n: number) => toLocaleDigits(n, locale);
  const pct = (x: number | null | undefined) => {
    const n = Math.round((x ?? 0) * 100);
    return isRtl ? `${num(n)}٪` : `${n}%`;
  };
  const threshLabel = useMemo(() => {
    // Step is 0.05 → one decimal for .x0/.x values, two for .x5 (٠٫٥ vs ٠٫٥٥).
    const hundredths = Math.round(threshold * 100);
    const label = (hundredths / 100).toFixed(hundredths % 10 === 0 ? 1 : 2);
    const localized = toLocaleDigits(label, locale);
    return isRtl ? localized.replace('.', '٫') : localized;
  }, [threshold, locale, isRtl]);

  const activeTerms = useMemo(() => terms.filter((t) => t.text.trim()), [terms]);
  const hasQuery = Boolean(query.trim()) || activeTerms.length > 0;
  const isBook = scope === 'book';

  // Term-row editor visibility + the client-side per-term result filter.
  const [termsOpen, setTermsOpen] = useState(terms.length > 0);
  const [termFilter, setTermFilter] = useState<number | null>(null);
  useEffect(() => {
    setTermFilter(null);
  }, [results]);

  const matches = useMemo(() => results?.matches ?? [], [results]);
  const counts = useMemo(() => countMatchesByKind(matches), [matches]);
  const visibleMatches = useMemo(
    () => sortMatches(filterMatchesByTab(filterMatchesByTerm(matches, termFilter), tab), sort),
    [matches, termFilter, tab, sort]
  );
  const libraryDocs = libraryResults?.results ?? [];

  const updateTerm = (id: string, patch: Partial<Omit<SearchTerm, 'id'>>) =>
    onTermsChange(terms.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const removeTerm = (id: string) => onTermsChange(terms.filter((row) => row.id !== id));
  const addTerm = () => {
    setTermsOpen(true);
    onTermsChange([...terms, createSearchTerm()]);
  };

  const visibleCount = isBook ? visibleMatches.length : libraryDocs.length;
  const hasResults = hasQuery && !isSearching && !error && visibleCount > 0;
  const noHits = hasQuery && !isSearching && !error && visibleCount === 0;

  const isMac = typeof navigator !== 'undefined' && /Mac|iP/.test(navigator.platform);

  const kindLabel = (m: DocumentSearchMatch) => {
    const kind = resolveMatchKind(m);
    return t(`reader.search.kind.${kind}`, kind === 'exact' ? 'تام' : kind === 'lexical' ? 'لفظي' : 'دلالي');
  };

  const citationFor = (m: DocumentSearchMatch) =>
    formatCitation(m, {
      bookTitle,
      chapter: chapterTitleForPage?.(m.page_number) ?? null,
      localizedPage: num(m.page_number),
    });

  const handleCopyCitation = async (m: DocumentSearchMatch) => {
    try {
      await navigator.clipboard.writeText(citationFor(m));
      onToast(t('reader.search.copiedCitation', 'نُسخ المقطع مع الإحالة'));
    } catch {
      // Clipboard unavailable (permissions/insecure context): stay silent.
    }
  };

  const handleExport = () => {
    const csv = buildResultsCsv(
      visibleMatches.map((m) => ({
        page: m.page_number,
        kind: kindLabel(m),
        score: m.score_final ?? null,
        snippet: m.snippet,
      })),
      {
        page: t('reader.search.csv.page', 'الصفحة'),
        kind: t('reader.search.csv.kind', 'النوع'),
        score: t('reader.search.csv.score', 'الدرجة'),
        snippet: t('reader.search.csv.snippet', 'المقطع'),
      }
    );
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `search-${query.trim() || 'results'}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    onToast(t('reader.search.exported', 'أُعِدّت النتائج للتصدير (CSV)'));
  };

  const pickTerm = (term: string) => {
    onQueryChange(term);
    onCommitQuery(term);
  };

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ color: 'var(--rr-ink)' }}>
      {/* ── Fixed head ── */}
      <div className="flex-shrink-0 px-[18px] pb-0 pt-4" style={{ borderBottom: '1px solid var(--rr-line-2)' }}>
        <div className="mb-3 flex items-center gap-[9px]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--rr-brand)" strokeWidth="2" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.5" y2="16.5" />
          </svg>
          <span className="rr-title text-[16px]">{t('reader.search.title', 'البحث')}</span>
          <div className="ms-auto flex items-center gap-1.5">
            <span
              className="rounded-[5px] px-[7px] py-0.5 text-[10.5px]"
              style={{ color: 'var(--rr-ink-4)', border: '1px solid var(--rr-line)', background: 'var(--rr-surface-2)' }}
              aria-label={t('reader.search.shortcutBadge', 'اختصار لوحة المفاتيح')}
            >
              {isMac ? '⌘K' : 'Ctrl K'}
            </span>
            {onTogglePin && <PanelIconButton onClick={onTogglePin} active={pinned} label={t(pinned ? 'reader.panel.unpin' : 'reader.panel.pin', pinned ? 'إلغاء التثبيت' : 'تثبيت')} icon="pin" />}
            {onClose && <PanelIconButton onClick={onClose} label={t('reader.closePanel', 'إغلاق')} icon="close" />}
          </div>
        </div>

        {/* Input */}
        <div
          className="flex items-center gap-[9px] rounded-[11px] px-[13px] py-[9px]"
          style={{ background: 'var(--rr-surface)', border: '1.5px solid #ddcda9' }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#a99a80" strokeWidth="2" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.5" y2="16.5" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && query.trim()) onCommitQuery(query.trim());
            }}
            placeholder={t('reader.search.placeholder', 'اكتب مصطلحًا… أو انقر كلمة في النص')}
            dir="auto"
            aria-label={t('reader.search.title', 'البحث')}
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none"
            style={{ color: 'var(--rr-ink)' }}
          />
          {hasQuery && (
            <button type="button" onClick={onClear} aria-label={t('reader.search.clear', 'مسح')} className="flex" style={{ color: 'var(--rr-ink-4)' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        {/* Multi-term builder toggle + rows */}
        <button
          type="button"
          onClick={() => setTermsOpen((v) => !v)}
          aria-expanded={termsOpen}
          className="mt-2 inline-flex items-center gap-1.5 text-[11.5px] font-semibold"
          style={{ color: 'var(--rr-brand, #b07d2b)' }}
        >
          <svg
            width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" aria-hidden
            style={{ transform: termsOpen ? 'rotate(90deg)' : undefined, transition: 'transform .15s' }}
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
          {t('reader.search.terms.toggle', 'شروط متعددة')}
          {activeTerms.length > 0 && (
            <span
              className="rounded-full px-1.5 text-[10.5px]"
              style={{ background: 'var(--rr-surface-2)', border: '1px solid var(--rr-line)', color: 'var(--rr-ink-2)' }}
            >
              {num(activeTerms.length)}
            </span>
          )}
        </button>
        {termsOpen && (
          <div className="mt-2 flex flex-col gap-1.5">
            {terms.map((term, index) => (
              <div
                key={term.id}
                className="flex flex-wrap items-center gap-1.5 rounded-[10px] px-2 py-1.5"
                style={{ background: 'var(--rr-surface)', border: '1px solid var(--rr-line)' }}
              >
                <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: termColor(index) }} />
                <button
                  type="button"
                  onClick={() => {
                    const order: TermOp[] = ['must', 'should', 'must_not'];
                    updateTerm(term.id, { op: order[(order.indexOf(term.op) + 1) % order.length] });
                  }}
                  title={t('nav.search.terms.opCycle', 'تبديل نوع الشرط')}
                  className="rounded-full border px-2 py-[2px] text-[11px] font-semibold"
                  style={
                    term.op === 'must'
                      ? { background: 'var(--rr-brand, #b07d2b)', borderColor: 'var(--rr-brand, #b07d2b)', color: '#fcf8ee' }
                      : term.op === 'should'
                        ? { borderColor: 'var(--rr-brand, #b07d2b)', color: 'var(--rr-brand, #b07d2b)' }
                        : { borderColor: '#a4423b', color: '#a4423b' }
                  }
                >
                  {t(`nav.search.terms.op.${term.op}`, term.op === 'must' ? 'يجب' : term.op === 'should' ? 'أو' : 'بدون')}
                </button>
                <input
                  type="text"
                  dir="auto"
                  value={term.text}
                  onChange={(e) => updateTerm(term.id, { text: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape' && term.text) {
                      e.preventDefault();
                      updateTerm(term.id, { text: '' });
                    }
                  }}
                  placeholder={t('nav.search.terms.placeholder', 'كلمة أو عبارة…')}
                  className="min-w-[7rem] flex-1 bg-transparent text-[12.5px] outline-none"
                  style={{ color: 'var(--rr-ink)' }}
                />
                <select
                  value={term.match}
                  onChange={(e) => {
                    const match = e.target.value as TermMatch;
                    updateTerm(term.id, {
                      match,
                      fuzziness: match === 'fuzzy' ? (term.fuzziness ?? 'AUTO') : undefined,
                      diacritics: match === 'stem' ? 'ignore' : term.diacritics,
                    });
                  }}
                  aria-label={t('nav.search.terms.matchLabel', 'نوع المطابقة')}
                  className="rounded-[7px] px-1 py-[3px] text-[11px] outline-none"
                  style={{ background: 'var(--rr-surface-2)', border: '1px solid var(--rr-line)', color: 'var(--rr-ink-2)' }}
                >
                  {(['phrase', 'word', 'fuzzy', 'stem'] as TermMatch[]).map((m) => (
                    <option key={m} value={m}>
                      {t(`nav.search.terms.match.${m}`, m === 'phrase' ? 'عبارة تامة' : m === 'word' ? 'كلمة تامة' : m === 'fuzzy' ? 'تقريبي' : 'تقارب لفظي')}
                    </option>
                  ))}
                </select>
                {term.match === 'fuzzy' && (
                  <select
                    value={String(term.fuzziness ?? 'AUTO')}
                    onChange={(e) => {
                      const raw = e.target.value;
                      updateTerm(term.id, { fuzziness: raw === 'AUTO' ? 'AUTO' : (Number(raw) as TermFuzziness) });
                    }}
                    aria-label={t('nav.search.terms.fuzzinessLabel', 'مدى التقريب')}
                    className="rounded-[7px] px-1 py-[3px] text-[11px] outline-none"
                    style={{ background: 'var(--rr-surface-2)', border: '1px solid var(--rr-line)', color: 'var(--rr-ink-2)' }}
                  >
                    <option value="AUTO">{t('nav.search.terms.fuzziness.auto', 'تلقائي')}</option>
                    <option value="1">{t('nav.search.terms.fuzziness.one', 'حرف واحد')}</option>
                    <option value="2">{t('nav.search.terms.fuzziness.two', 'حرفان')}</option>
                  </select>
                )}
                <button
                  type="button"
                  onClick={() => removeTerm(term.id)}
                  aria-label={t('docs.categorySearch.remove', 'إزالة')}
                  className="ms-auto flex"
                  style={{ color: 'var(--rr-ink-4)' }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addTerm}
              className="self-start rounded-[9px] border border-dashed px-2.5 py-1 text-[11.5px] font-medium"
              style={{ borderColor: 'var(--rr-line)', color: 'var(--rr-brand, #b07d2b)' }}
            >
              {t('nav.search.terms.add', '+ إضافة كلمة/عبارة')}
            </button>
          </div>
        )}

        {/* Scope segmented (always) */}
        <div className="mt-2.5 grid grid-cols-2 gap-1 rounded-[10px] p-[3px]" style={{ background: '#e6d9bc' }}>
          {(['book', 'library'] as SearchScope[]).map((key) => {
            const on = key === scope;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={on}
                onClick={() => onScopeChange(key)}
                className="flex items-center justify-center whitespace-nowrap rounded-[8px] py-[7px] text-[12px] font-semibold transition-all"
                style={
                  on
                    ? { background: 'var(--rr-surface)', color: 'var(--rr-ink)', boxShadow: '0 1px 4px rgba(44,38,32,.14)' }
                    : { color: '#7a6f59' }
                }
              >
                {key === 'book'
                  ? t('reader.search.scope.book', 'هذا الكتاب')
                  : t('reader.search.scope.library', 'كلّ المكتبة')}
              </button>
            );
          })}
        </div>

        {/* Kind tabs (book scope, active query) */}
        {hasQuery && isBook && (
          <div className="mt-3">
            <SearchKindTabs tab={tab} counts={counts} onChange={onTabChange} />
          </div>
        )}

        {/* Per-term result filter chips (book scope, multi-term results) */}
        {hasQuery && isBook && activeTerms.length > 1 && matches.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5" aria-label={t('nav.search.terms.label', 'شروط البحث')}>
            {terms.map((term, index) => {
              if (!term.text.trim() || term.op === 'must_not') return null;
              const on = termFilter === index;
              return (
                <button
                  key={term.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setTermFilter(on ? null : index)}
                  className="inline-flex max-w-[11rem] items-center gap-1.5 rounded-full border px-2 py-[2px] text-[11px]"
                  style={
                    on
                      ? { borderColor: termColor(index), background: 'var(--rr-surface)', color: 'var(--rr-ink)' }
                      : { borderColor: 'var(--rr-line)', color: 'var(--rr-ink-3)' }
                  }
                >
                  <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: termColor(index) }} />
                  <bdi className="min-w-0 truncate">{term.text}</bdi>
                </button>
              );
            })}
          </div>
        )}

        {/* Options accordion (book scope only — corpus search has none of these knobs) */}
        {isBook ? (
          <SearchOptionsAccordion
            threshold={threshold}
            thresholdLabel={threshLabel}
            ignoreDiacritics={ignoreDiacritics}
            sort={sort}
            onThresholdChange={onThresholdChange}
            onDiacriticsChange={onDiacriticsChange}
            onSortChange={onSortChange}
          />
        ) : (
          <div className="pb-3" />
        )}
      </div>

      {/* ── Results scroll ── */}
      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-[18px] pb-[22px] pt-3.5">
        {error ? (
          <div className="py-8 text-center">
            <div className="text-[13px]" style={{ color: '#9a3b2e' }}>{error}</div>
          </div>
        ) : isSearching ? (
          <div className="flex items-center justify-center gap-2 py-10 text-[12.5px]" style={{ color: 'var(--rr-ink-3)' }}>
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[#b07d2b] border-t-transparent" />
            {t('reader.search.searching', 'جارٍ البحث…')}
          </div>
        ) : !hasQuery ? (
          <SearchEmptyState recents={recentTerms} pinned={pinnedTerms} suggestions={suggestions} onPick={pickTerm} />
        ) : noHits ? (
          <div className="px-2.5 py-[26px] text-center" style={{ color: 'var(--rr-ink-3)' }}>
            <div className="mb-1.5 text-[14px] font-semibold" style={{ color: 'var(--rr-ink-2)' }}>
              {t('reader.search.noHits', 'لا نتائج في هذا النطاق')}
            </div>
            <div className="mb-3.5 text-[12.5px] leading-[1.7]">
              {t('reader.search.noHitsHint', 'جرِّب فئةً أوسع، أو اخفض عتبة التشابه.')}
            </div>
            {isBook && (
              <button
                type="button"
                onClick={() => onScopeChange('library')}
                className="inline-flex items-center gap-[7px] rounded-[10px] px-4 py-[9px] text-[13px] font-semibold"
                style={{ background: '#2c2620', color: '#f4ecda' }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M12 3v18M3 8l9-5 9 5M5 11v7M19 11v7M3 21h18" />
                </svg>
                {t('reader.search.searchLibrary', 'البحث في كلّ المكتبة')}
              </button>
            )}
          </div>
        ) : hasResults ? (
          <>
            <div className="mb-3 flex items-center gap-2">
              <span className="min-w-0 truncate text-[12.5px]" style={{ color: 'var(--rr-ink-2)' }} dir="auto">
                <b style={{ color: 'var(--rr-ink)' }}>{num(visibleCount)}</b>{' '}
                {t('reader.search.resultWord', 'نتيجة')} · «{query.trim()}»
              </span>
              <span className="flex-1" />
              {isBook && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      onPinTerm(query.trim());
                      onToast(t('reader.search.termPinned', 'ثُبِّت المصطلح للرجوع إليه'));
                    }}
                    title={t('reader.search.pinTerm', 'تثبيت المصطلح')}
                    aria-label={t('reader.search.pinTerm', 'تثبيت المصطلح')}
                    className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[8px]"
                    style={{ border: '1px solid var(--rr-line)', background: 'var(--rr-surface)', color: '#8a7d68' }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      <path d="M12 17v5M7 4h10l-1.5 7.5L17 14H7l1.5-2.5z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={handleExport}
                    title={t('reader.search.export', 'تصدير النتائج')}
                    aria-label={t('reader.search.export', 'تصدير النتائج')}
                    className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[8px]"
                    style={{ border: '1px solid var(--rr-line)', background: 'var(--rr-surface)', color: '#8a7d68' }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                      <path d="M12 15V3M7 8l5-5 5 5M5 21h14" />
                    </svg>
                  </button>
                </>
              )}
            </div>
            {isBook
              ? visibleMatches.map((m, i) => (
                  <SearchResultCardV2
                    key={`${resultKey(m)}-${i}`}
                    match={m}
                    location={resolveLocation(m, chapterTitleForPage, t, num)}
                    pct={pct}
                    localizedPage={num(m.page_number)}
                    saved={savedKeys.has(resultKey(m))}
                    onGoTo={() => onGoToPage(m.page_number)}
                    onCopyCitation={() => void handleCopyCitation(m)}
                    onToggleSave={() => onToggleSaveResult(m, citationFor(m))}
                  />
                ))
              : libraryDocs.map((doc: Document) => (
                  <LibraryResultCard key={doc.id} document={doc} onOpen={() => onOpenLibraryResult(doc.id)} />
                ))}
          </>
        ) : null}
      </div>
    </div>
  );
}

function resolveLocation(
  m: DocumentSearchMatch,
  chapterTitleForPage: ((page: number) => string | null) | undefined,
  t: (k: string, f?: string, v?: Record<string, string | number>) => string,
  num: (n: number) => string,
): string {
  const page = t('reader.search.pageShort', 'ص {page}', { page: num(m.page_number) });
  const chapter = chapterTitleForPage?.(m.page_number);
  return chapter ? `${chapter} · ${page}` : page;
}
