'use client';

import { useMemo } from 'react';

import { useI18n } from '@/components/i18n/I18nProvider';
import type { DocumentSearchMatch, DocumentSearchResponse, InDocSearchMode } from '@/lib/api';
import { toLocaleDigits } from '@/lib/utils';
import PanelIconButton from './PanelIconButton';

interface AdvancedSearchPanelProps {
  query: string;
  mode: InDocSearchMode;
  threshold: number;
  results: DocumentSearchResponse | null;
  isSearching: boolean;
  error?: string | null;
  /** Suggested query words shown in the empty state (e.g. frequent terms). */
  suggestions: string[];
  onQueryChange: (q: string) => void;
  onModeChange: (m: InDocSearchMode) => void;
  onThresholdChange: (t: number) => void;
  onClear: () => void;
  onGoToPage: (page: number) => void;
  /** Optional resolver: page number → chapter title (for result locations). */
  chapterTitleForPage?: (page: number) => string | null;
  /** Pinned = docked column; unpinned = floating overlay. */
  pinned?: boolean;
  onTogglePin?: () => void;
  onClose?: () => void;
}

const MODE_META: Record<InDocSearchMode, { labelKey: string; labelFallback: string; badgeKey: string; badgeFallback: string; bg: string; fg: string }> = {
  exact: { labelKey: 'reader.search.mode.exact', labelFallback: 'تطابق تام', badgeKey: 'reader.search.badge.exact', badgeFallback: 'تطابق تام', bg: '#e6f0ec', fg: '#1e5f56' },
  similar: { labelKey: 'reader.search.mode.similar', labelFallback: 'تقارب لفظي', badgeKey: 'reader.search.badge.similar', badgeFallback: 'تقارب', bg: '#fbefd6', fg: '#9a6b12' },
  semantic: { labelKey: 'reader.search.mode.semantic', labelFallback: 'دلالي', badgeKey: 'reader.search.badge.semantic', badgeFallback: 'دلالي', bg: '#ece7f4', fg: '#574a7e' },
  mix: { labelKey: 'reader.search.mode.mix', labelFallback: 'مزيج', badgeKey: 'reader.search.badge.mix', badgeFallback: 'مزيج', bg: '#eaefe7', fg: '#4a5a3e' },
};

const MODE_ORDER: InDocSearchMode[] = ['exact', 'similar', 'semantic', 'mix'];

export default function AdvancedSearchPanel({
  query,
  mode,
  threshold,
  results,
  isSearching,
  error,
  suggestions,
  onQueryChange,
  onModeChange,
  onThresholdChange,
  onClear,
  onGoToPage,
  chapterTitleForPage,
  pinned,
  onTogglePin,
  onClose,
}: AdvancedSearchPanelProps) {
  const { t, locale } = useI18n();
  const isRtl = locale === 'ar' || locale === 'fa' || locale === 'ur';

  const num = (n: number) => toLocaleDigits(n, locale);
  const pct = (x: number | null | undefined) => {
    const n = Math.round((x ?? 0) * 100);
    return isRtl ? `${num(n)}٪` : `${n}%`;
  };
  const threshLabel = useMemo(() => {
    const s = threshold.toFixed(1);
    const localized = toLocaleDigits(s, locale);
    return isRtl ? localized.replace('.', '٫') : localized;
  }, [threshold, locale, isRtl]);

  const showThresh = mode === 'semantic' || mode === 'mix';
  const matches = results?.matches ?? [];
  const hasQuery = Boolean(query.trim());
  const hasResults = hasQuery && !isSearching && matches.length > 0;
  const noHits = hasQuery && !isSearching && matches.length === 0 && !error;

  const modeLabel = t(MODE_META[mode].labelKey, MODE_META[mode].labelFallback);
  const summaryTail = `«${query}» · ${modeLabel}${showThresh ? ` · ${t('reader.search.thresholdShort', 'عتبة')} ${threshLabel}` : ''}`;

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ color: 'var(--rr-ink)' }}>
      {/* ── Header / controls ── */}
      <div className="flex-shrink-0 px-5 pb-3.5 pt-[18px]" style={{ borderBottom: '1px solid var(--rr-line-2)' }}>
        <div className="mb-3.5 flex items-center gap-2.5">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--rr-brand)" strokeWidth="2" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.5" y2="16.5" />
          </svg>
          <span className="rr-title text-[16px]">{t('reader.search.title', 'البحث المتقدّم')}</span>
          <div className="ms-auto flex items-center gap-1.5">
            <span className="hidden text-[11px] sm:inline" style={{ color: 'var(--rr-ink-4)' }}>
              {t('reader.search.scope', 'داخل الكتاب')}
            </span>
            {onTogglePin && <PanelIconButton onClick={onTogglePin} active={pinned} label={t(pinned ? 'reader.panel.unpin' : 'reader.panel.pin', pinned ? 'إلغاء التثبيت' : 'تثبيت')} icon="pin" />}
            {onClose && <PanelIconButton onClick={onClose} label={t('reader.closePanel', 'إغلاق')} icon="close" />}
          </div>
        </div>

        {/* Input */}
        <div
          className="flex items-center gap-2.5 rounded-[11px] px-3 py-[9px]"
          style={{ background: 'var(--rr-surface)', border: '1.5px solid #ddcda9' }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#a99a80" strokeWidth="2" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.5" y2="16.5" />
          </svg>
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={t('reader.search.placeholder', 'اكتب مصطلحًا، أو انقر كلمة في النص…')}
            dir="auto"
            aria-label={t('reader.search.title', 'البحث المتقدّم')}
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

        {/* Mode segmented control */}
        <div className="mt-3 grid grid-cols-4 gap-[5px] rounded-[11px] p-1" style={{ background: '#e6d9bc' }}>
          {MODE_ORDER.map((m) => {
            const on = m === mode;
            return (
              <button
                key={m}
                type="button"
                onClick={() => onModeChange(m)}
                aria-pressed={on}
                className="flex items-center justify-center whitespace-nowrap rounded-[8px] px-0 py-2 text-[12px] font-semibold transition-all"
                style={
                  on
                    ? { background: '#2c2620', color: '#f4ecda', boxShadow: '0 2px 6px rgba(44,38,32,.2)' }
                    : { color: '#7a6f59' }
                }
              >
                {t(MODE_META[m].labelKey, MODE_META[m].labelFallback)}
              </button>
            );
          })}
        </div>

        {/* Threshold (semantic / mix) */}
        {showThresh && (
          <div className="mt-3.5">
            <div className="mb-[7px] flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[12.5px]" style={{ color: 'var(--rr-ink-2)' }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#7c6fa8" strokeWidth="2" aria-hidden>
                  <path d="M4 6h10M4 12h16M4 18h7" />
                  <circle cx="17" cy="6" r="2.4" fill="#eae6f3" />
                  <circle cx="13" cy="18" r="2.4" fill="#eae6f3" />
                </svg>
                {t('reader.search.threshold', 'عتبة التشابه المتجِّهي')}
              </span>
              <span className="text-[13px] font-bold tabular-nums" style={{ color: '#574a7e' }}>{threshLabel}</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={threshold}
              onChange={(e) => onThresholdChange(parseFloat(e.target.value))}
              className="w-full cursor-pointer"
              style={{ accentColor: '#7c6fa8' }}
              aria-label={t('reader.search.threshold', 'عتبة التشابه المتجِّهي')}
            />
            <div className="mt-1.5 text-[11px] leading-[1.6]" style={{ color: '#a99a80' }}>
              {t('reader.search.thresholdHint', 'تُعرَض المقاطع التي يتجاوز قُربها الدلالي هذه العتبة فقط.')}
            </div>
          </div>
        )}
      </div>

      {/* ── Results scroll ── */}
      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-5 pb-[22px] pt-4">
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
          <EmptyState
            t={t}
            suggestions={suggestions}
            onPick={(w) => onQueryChange(w)}
          />
        ) : noHits ? (
          <div className="px-2.5 py-[30px] text-center" style={{ color: 'var(--rr-ink-3)' }}>
            <div className="mb-1.5 text-[14px] font-semibold" style={{ color: 'var(--rr-ink-2)' }}>
              {t('reader.search.noResults', 'لا توجد نتائج مطابقة')}
            </div>
            <div className="text-[12.5px] leading-[1.7]">
              {t('reader.search.noResultsHint', 'جرِّب وضعًا أوسع (تقارب أو دلالي)، أو اخفض عتبة التشابه.')}
            </div>
          </div>
        ) : hasResults ? (
          <>
            <div className="mb-3.5 flex items-center gap-2 text-[12.5px]" style={{ color: 'var(--rr-ink-2)' }}>
              <span className="font-semibold" style={{ color: 'var(--rr-ink)' }}>{num(matches.length)}</span>
              {t('reader.search.resultWord', 'نتيجة')}
              <span className="h-1 w-1 rounded-full" style={{ background: '#c9ba9a' }} />
              <span className="truncate" dir="auto">{summaryTail}</span>
            </div>
            {matches.map((m, i) => (
              <ResultCard
                key={`${m.page_number}-${i}`}
                match={m}
                mode={mode}
                threshold={threshold}
                pct={pct}
                location={resolveLocation(m, chapterTitleForPage, t, num)}
                onClick={() => onGoToPage(m.page_number)}
              />
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

function ResultCard({
  match,
  mode,
  threshold,
  pct,
  location,
  onClick,
}: {
  match: DocumentSearchMatch;
  mode: InDocSearchMode;
  threshold: number;
  pct: (x: number | null | undefined) => string;
  location: string;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const meta = MODE_META[mode];
  const lex = match.score_lexical ?? 0;
  const sem = match.score_semantic ?? 0;
  const fin = match.score_final ?? 0;

  let badgeText: string;
  let rankVal: number;
  if (mode === 'exact') {
    badgeText = t(meta.badgeKey, meta.badgeFallback);
    rankVal = Math.max(0.6, lex);
  } else if (mode === 'similar') {
    badgeText = `${t(meta.badgeKey, meta.badgeFallback)} ${pct(lex)}`;
    rankVal = lex;
  } else if (mode === 'semantic') {
    badgeText = `${t(meta.badgeKey, meta.badgeFallback)} ${pct(sem)}`;
    rankVal = sem;
  } else {
    badgeText = `${t(meta.badgeKey, meta.badgeFallback)} ${pct(fin)}`;
    rankVal = fin;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="ilm-result mb-[11px] block w-full cursor-pointer text-start"
      style={{
        background: 'var(--rr-surface)',
        border: '1px solid var(--rr-line-2)',
        borderInlineEnd: `3px solid ${meta.fg}`,
        borderRadius: '12px',
        padding: '13px 15px',
      }}
    >
      <div className="mb-[9px] flex items-center gap-2">
        <span
          className="flex-shrink-0 whitespace-nowrap rounded-[7px] px-[9px] py-[3px] text-[11px] font-bold"
          style={{ background: meta.bg, color: meta.fg }}
        >
          {badgeText}
        </span>
        <span className="truncate text-[11px]" style={{ color: 'var(--rr-ink-3)' }}>{location}</span>
      </div>
      <div
        className="text-[13.5px] leading-[1.95]"
        style={{ color: '#3a342b' }}
        dir="auto"
        dangerouslySetInnerHTML={{ __html: match.snippet }}
      />
      <div className="mt-[11px] h-1 overflow-hidden rounded-[3px]" style={{ background: 'var(--rr-line-2)' }}>
        <div className="h-full rounded-[3px]" style={{ width: `${Math.round(rankVal * 100)}%`, background: meta.fg, transition: 'width .2s' }} />
      </div>
      {mode === 'mix' && (
        <div className="mt-2.5 flex gap-[5px]">
          <SignalDot on={lex >= 0.99} label={t('reader.search.signal.exact', 'تام')} color="#1e5f56" />
          <SignalDot on={lex >= 0.5} label={t('reader.search.signal.lexical', 'لفظي')} color="#9a6b12" />
          <SignalDot on={(match.score_semantic ?? 0) >= threshold && match.score_semantic != null} label={t('reader.search.signal.semantic', 'دلالي')} color="#574a7e" />
        </div>
      )}
    </button>
  );
}

function SignalDot({ on, label, color }: { on: boolean; label: string; color: string }) {
  return (
    <span
      className="rounded-[5px] px-[7px] py-0.5 text-[10px] font-semibold"
      style={on ? { background: `${color}1f`, color } : { background: '#eee6d0', color: '#b7ab8e' }}
    >
      {label}
    </span>
  );
}

function EmptyState({
  t,
  suggestions,
  onPick,
}: {
  t: (k: string, f?: string, v?: Record<string, string | number>) => string;
  suggestions: string[];
  onPick: (w: string) => void;
}) {
  const legend: { color: string; term: string; desc: string }[] = [
    { color: '#1e5f56', term: t('reader.search.mode.exact', 'تطابق تام'), desc: t('reader.search.legend.exact', 'ورود اللفظ نفسه حرفيًّا.') },
    { color: '#9a6b12', term: t('reader.search.mode.similar', 'تقارب لفظي'), desc: t('reader.search.legend.similar', 'قُرب الكتابة (مسافة التحرير) كالجذر والمشتقّات.') },
    { color: '#574a7e', term: t('reader.search.mode.semantic', 'دلالي'), desc: t('reader.search.legend.semantic', 'قُرب المعنى عبر متّجهات، مضبوط بعتبة.') },
    { color: '#4a5a3e', term: t('reader.search.mode.mix', 'مزيج'), desc: t('reader.search.legend.mix', 'دمج موزون للإشارات الثلاث.') },
  ];
  return (
    <>
      <div className="px-1.5 pb-2 pt-[18px] text-center">
        <div className="mx-auto mb-3.5 flex h-[50px] w-[50px] items-center justify-center rounded-[14px]" style={{ background: '#e9dcbe' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#b07d2b" strokeWidth="1.8" aria-hidden>
            <path d="M9 3h6M12 3v6M5.5 12.5l-2 6.5a1 1 0 0 0 1.3 1.2l5.2-2 5.2 2a1 1 0 0 0 1.3-1.2l-2-6.5" />
            <circle cx="12" cy="9" r="3.2" />
          </svg>
        </div>
        <div className="mx-auto max-w-[250px] text-[13.5px] leading-[1.8]" style={{ color: 'var(--rr-ink-2)' }}>
          {t('reader.search.empty.hint', 'انقر أيّ كلمة في النص، أو حدِّد عبارة بالماوس، أو اكتب مصطلحًا أعلاه — ثم اختر طريقة المطابقة.')}
        </div>
      </div>

      {suggestions.length > 0 && (
        <>
          <div className="mb-2.5 mt-[22px] text-[11px] font-semibold tracking-[0.12em]" style={{ color: 'var(--rr-ink-4)' }}>
            {t('reader.search.suggested', 'كلمات مقترحة')}
          </div>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => onPick(w)}
                className="cursor-pointer rounded-[9px] px-[13px] py-1.5 text-[13px]"
                style={{ background: 'var(--rr-surface)', border: '1px solid var(--rr-line)', color: '#4a4236' }}
              >
                {w}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="mt-[26px] flex flex-col gap-2.5 pt-4" style={{ borderTop: '1px solid var(--rr-line)' }}>
        <div className="text-[11px] font-semibold tracking-[0.12em]" style={{ color: 'var(--rr-ink-4)' }}>
          {t('reader.search.patterns', 'أنماط المطابقة')}
        </div>
        {legend.map((row) => (
          <div key={row.term} className="flex items-start gap-2.5">
            <span className="mt-1 h-[9px] w-[9px] flex-shrink-0 rounded-[3px]" style={{ background: row.color }} />
            <div className="text-[12.5px] leading-[1.6]" style={{ color: '#5a5240' }}>
              <b>{row.term}</b> — {row.desc}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
