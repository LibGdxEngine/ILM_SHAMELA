'use client';

// "خيارات الباحث" collapsible for the Reader & Search v2 panel: semantic
// threshold slider, diacritics toggle, sort control, and the 3-kind legend.
// Collapsed it shows a one-line summary ("عتبة ٠٫٥ · الأكثر صلة").

import { useState } from 'react';

import { useI18n } from '@/components/i18n/I18nProvider';
import type { SearchSort } from '@/lib/reader/searchPanelUtils';

interface SearchOptionsAccordionProps {
  threshold: number;
  /** Pre-localized threshold label (e.g. "٠٫٥"). */
  thresholdLabel: string;
  ignoreDiacritics: boolean;
  sort: SearchSort;
  onThresholdChange: (t: number) => void;
  onDiacriticsChange: (v: boolean) => void;
  onSortChange: (s: SearchSort) => void;
}

export default function SearchOptionsAccordion({
  threshold,
  thresholdLabel,
  ignoreDiacritics,
  sort,
  onThresholdChange,
  onDiacriticsChange,
  onSortChange,
}: SearchOptionsAccordionProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const sortLabels: Record<SearchSort, string> = {
    relevance: t('reader.search.sort.relevance', 'الأكثر صلة'),
    page: t('reader.search.sort.page', 'ترتيب الصفحات'),
  };

  const legend: { color: string; term: string; desc: string }[] = [
    { color: '#1e5f56', term: t('reader.search.kind.exact', 'تام'), desc: t('reader.search.legend.exact', 'ورود اللفظ نفسه حرفيًّا.') },
    { color: '#9a6b12', term: t('reader.search.kind.lexical', 'لفظي'), desc: t('reader.search.legend.lexical', 'قُرب الكتابة: الجذر والمشتقّات.') },
    { color: '#574a7e', term: t('reader.search.kind.semantic', 'دلالي'), desc: t('reader.search.legend.semantic', 'قُرب المعنى عبر متجهات النص.') },
  ];

  return (
    <div className="mt-3" style={{ borderTop: '1px dashed #decfb0' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-0.5 py-[11px] text-start"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--rr-ink-2)" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M4 6h10M4 12h16M4 18h7" />
          <circle cx="17" cy="6" r="2.2" />
          <circle cx="13" cy="18" r="2.2" />
        </svg>
        <span className="text-[12.5px] font-semibold" style={{ color: 'var(--rr-ink-2)' }}>
          {t('reader.search.options', 'خيارات الباحث')}
        </span>
        {!open && (
          <span className="truncate text-[11px]" style={{ color: 'var(--rr-ink-4)' }}>
            {t('reader.search.thresholdShort', 'عتبة')} {thresholdLabel} · {sortLabels[sort]}
          </span>
        )}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#8a7d68"
          strokeWidth="2.2"
          strokeLinecap="round"
          aria-hidden
          className="ms-auto transition-transform"
          style={{ transform: open ? 'rotate(180deg)' : 'none' }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="flex flex-col gap-3.5 px-0.5 pb-[15px] pt-0.5">
          {/* Semantic threshold */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[12.5px]" style={{ color: '#5a5240' }}>
                {t('reader.search.threshold', 'عتبة التشابه الدلالي')}
              </span>
              <span className="text-[13px] font-bold tabular-nums" style={{ color: '#574a7e' }}>
                {thresholdLabel}
              </span>
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
              aria-label={t('reader.search.threshold', 'عتبة التشابه الدلالي')}
            />
            <div className="mt-1 text-[10.5px]" style={{ color: '#a99a80' }}>
              {t('reader.search.thresholdHint', 'تُعرَض نتائج المعنى التي تتجاوز هذه العتبة فقط.')}
            </div>
          </div>

          {/* Diacritics toggle */}
          <button
            type="button"
            role="switch"
            aria-checked={ignoreDiacritics}
            onClick={() => onDiacriticsChange(!ignoreDiacritics)}
            className="flex w-full items-center justify-between text-start"
          >
            <span className="text-[12.5px]" style={{ color: '#5a5240' }}>
              {t('reader.search.diacritics', 'تجاهل التشكيل والهمزات')}
            </span>
            <span
              className="flex h-5 w-9 items-center rounded-xl p-0.5 transition-all"
              style={{
                background: ignoreDiacritics ? '#2e5347' : '#d8c8a6',
                justifyContent: ignoreDiacritics ? 'flex-end' : 'flex-start',
              }}
            >
              <span className="h-4 w-4 rounded-full" style={{ background: '#fcf8ee', boxShadow: '0 1px 3px rgba(44,38,32,.3)' }} />
            </span>
          </button>

          {/* Sort */}
          <div>
            <div className="mb-[7px] text-[12.5px]" style={{ color: '#5a5240' }}>
              {t('reader.search.sortLabel', 'ترتيب النتائج')}
            </div>
            <div className="grid grid-cols-2 gap-1 rounded-[10px] p-[3px]" style={{ background: '#e6d9bc' }}>
              {(['relevance', 'page'] as SearchSort[]).map((key) => {
                const on = key === sort;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => onSortChange(key)}
                    className="flex items-center justify-center whitespace-nowrap rounded-[8px] py-[7px] text-[12px] font-semibold transition-all"
                    style={
                      on
                        ? { background: '#2c2620', color: '#f4ecda', boxShadow: '0 2px 6px rgba(44,38,32,.2)' }
                        : { color: '#7a6f59' }
                    }
                  >
                    {sortLabels[key]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Kind legend */}
          <div className="flex flex-col gap-[7px] pt-[11px]" style={{ borderTop: '1px dashed var(--rr-line)' }}>
            {legend.map((row) => (
              <div key={row.term} className="flex items-baseline gap-2">
                <span className="h-2 w-2 flex-shrink-0 translate-y-px rounded-[3px]" style={{ background: row.color }} />
                <span className="text-[11.5px] leading-[1.55]" style={{ color: '#7a6f59' }}>
                  <b>{row.term}</b> — {row.desc}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
