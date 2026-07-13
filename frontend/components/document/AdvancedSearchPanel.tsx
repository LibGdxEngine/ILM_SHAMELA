'use client';

// Reader & Search v2 panel (from the "ILM Shamela - Reader & Search v2" design).
// One `mode=all` request per query; the الكل/تام/لفظي/دلالي tabs and the sort
// control filter/order that single result set client-side. The scope control
// switches between this book (in-document search) and the whole library
// (corpus search via `getDocumentsSearch`, no kind classification).

import { useEffect, useMemo, useRef } from 'react';

import { useI18n } from '@/components/i18n/I18nProvider';
import type { Document, DocumentSearchMatch, DocumentSearchResponse, DocumentsListResponse } from '@/lib/api';
import {
  buildResultsCsv,
  countMatchesByKind,
  filterMatchesByTab,
  formatCitation,
  resolveMatchKind,
  resultKey,
  sortMatches,
  type SearchKindTab,
  type SearchScope,
  type SearchSort,
} from '@/lib/reader/searchPanelUtils';
import { toLocaleDigits } from '@/lib/utils';
import PanelIconButton from './PanelIconButton';
import SearchEmptyState from './SearchEmptyState';
import SearchKindTabs from './SearchKindTabs';
import SearchOptionsAccordion from './SearchOptionsAccordion';
import SearchResultCardV2, { LibraryResultCard } from './SearchResultCardV2';

interface AdvancedSearchPanelProps {
  query: string;
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

  const hasQuery = Boolean(query.trim());
  const isBook = scope === 'book';

  const matches = useMemo(() => results?.matches ?? [], [results]);
  const counts = useMemo(() => countMatchesByKind(matches), [matches]);
  const visibleMatches = useMemo(
    () => sortMatches(filterMatchesByTab(matches, tab), sort),
    [matches, tab, sort]
  );
  const libraryDocs = libraryResults?.results ?? [];

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
