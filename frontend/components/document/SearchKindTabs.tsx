'use client';

// Match-kind tabs for the Reader & Search v2 panel: filter ONE `mode=all`
// result set client-side (no re-fetch on tab switch). Counts come precomputed
// from `countMatchesByKind`.

import { useI18n } from '@/components/i18n/I18nProvider';
import type { SearchKindTab } from '@/lib/reader/searchPanelUtils';
import { toLocaleDigits } from '@/lib/utils';

export const KIND_COLORS: Record<SearchKindTab, string> = {
  all: '#2c2620',
  exact: '#1e5f56',
  lexical: '#9a6b12',
  semantic: '#574a7e',
};

const TAB_ORDER: SearchKindTab[] = ['all', 'exact', 'lexical', 'semantic'];

const TAB_LABELS: Record<SearchKindTab, { key: string; fallback: string }> = {
  all: { key: 'reader.search.tab.all', fallback: 'الكل' },
  exact: { key: 'reader.search.tab.exact', fallback: 'تام' },
  lexical: { key: 'reader.search.tab.lexical', fallback: 'لفظي' },
  semantic: { key: 'reader.search.tab.semantic', fallback: 'دلالي' },
};

interface SearchKindTabsProps {
  tab: SearchKindTab;
  counts: Record<SearchKindTab, number>;
  onChange: (tab: SearchKindTab) => void;
}

export default function SearchKindTabs({ tab, counts, onChange }: SearchKindTabsProps) {
  const { t, locale } = useI18n();
  return (
    <div className="flex gap-1.5" role="tablist" aria-label={t('reader.search.tab.all', 'الكل')}>
      {TAB_ORDER.map((key) => {
        const on = key === tab;
        const count = counts[key];
        const zero = count === 0;
        const color = KIND_COLORS[key];
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(key)}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-[9px] px-[11px] py-1.5 text-[12px] font-semibold transition-all"
            style={{
              background: on ? color : 'var(--rr-surface)',
              color: on ? '#f4ecda' : zero ? '#b7ab8e' : '#5a5240',
              border: `1px solid ${on ? color : 'var(--rr-line)'}`,
              opacity: zero && !on ? 0.55 : 1,
            }}
          >
            {t(TAB_LABELS[key].key, TAB_LABELS[key].fallback)}
            <span
              className="rounded-[6px] px-1.5 py-px text-[10.5px] font-bold"
              style={
                on
                  ? { background: 'rgba(255,255,255,.22)', color: '#f4ecda' }
                  : { background: '#efe5ce', color: '#8a7d68' }
              }
            >
              {toLocaleDigits(count, locale)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
