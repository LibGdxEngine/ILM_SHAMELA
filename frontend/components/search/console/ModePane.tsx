'use client';

import { useI18n } from '@/components/i18n/I18nProvider';
import { MODE_FALLBACK, MODE_ORDER } from '@/components/search/searchMode';
import type { ModeSectionSpec } from './types';

/** The exact / semantic / hybrid segmented control + explanation, lifted from
 *  the legacy `SearchFacetControls` body. Always available (no API call). */
export default function ModePane({ section }: { section: ModeSectionSpec }) {
  const { t } = useI18n();

  return (
    <div>
      <div
        className="grid grid-cols-3 gap-[5px] rounded-[11px] p-1"
        style={{ background: 'var(--shell-line, #e6d9bc)' }}
        role="group"
        aria-label={section.label}
      >
        {MODE_ORDER.map((m) => {
          const on = m === section.mode;
          return (
            <button
              key={m}
              type="button"
              onClick={() => section.onModeChange(m)}
              aria-pressed={on}
              className="flex items-center justify-center whitespace-nowrap rounded-[8px] px-0 py-2 text-[12px] font-semibold transition-all"
              style={
                on
                  ? {
                      background: 'var(--accent, #b07d2b)',
                      color: 'var(--shell-on-accent, #fcf8ee)',
                      boxShadow: '0 2px 6px rgba(44,38,32,.18)',
                    }
                  : { color: 'var(--shell-muted, #7a6f59)' }
              }
            >
              {t(`nav.search.mode.${m}`, MODE_FALLBACK[m])}
            </button>
          );
        })}
      </div>
      <p className="mt-2.5 text-[11.5px] leading-[1.7]" style={{ color: 'var(--shell-muted, #9a8b70)' }}>
        {t(
          'nav.search.mode.hint',
          '«تام» يطابق الألفاظ حرفيًّا، و«دلالي» يطابق المعنى، و«مزيج» يجمع بينهما.',
        )}
      </p>
    </div>
  );
}
