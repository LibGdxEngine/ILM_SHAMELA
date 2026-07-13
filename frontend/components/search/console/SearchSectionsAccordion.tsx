'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';

import { useI18n } from '@/components/i18n/I18nProvider';
import { toLocaleDigits } from '@/lib/utils';
import { SectionPane } from './SearchConsole';
import type { FilterSectionKey, SectionSpec } from './types';

export interface SearchSectionsAccordionProps {
  sections: SectionSpec[];
  presetsPane?: ReactNode;
  signInHint?: string;
  /** Section expanded on mount (default: the first). */
  defaultOpenKey?: FilterSectionKey;
}

/**
 * The narrow single-column presentation of the same section model: stacked
 * collapsible sections (header = label + selected-count badge), each opening
 * to the same pane bodies the two-pane console uses. Serves the
 * `NavSearchPopover` dropdown/panel and the palette's mobile takeover.
 */
export default function SearchSectionsAccordion({
  sections,
  presetsPane,
  signInHint,
  defaultOpenKey,
}: SearchSectionsAccordionProps) {
  const { locale } = useI18n();
  const [openKey, setOpenKey] = useState<FilterSectionKey | null>(
    defaultOpenKey ?? sections[0]?.key ?? null,
  );

  return (
    <div className="flex flex-col">
      {sections.map((section) => {
        const open = section.key === openKey;
        return (
          <section
            key={section.key}
            className="border-b last:border-b-0"
            style={{ borderColor: 'var(--shell-line, #e7dbc1)' }}
          >
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpenKey(open ? null : section.key)}
              className="flex w-full items-center justify-between gap-2 py-3 text-start"
            >
              <span
                className="flex min-w-0 items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em]"
                style={{ color: 'var(--accent, #b07d2b)' }}
              >
                <span className="min-w-0 truncate">{section.label}</span>
                {section.badge > 0 && (
                  <span
                    className="grid h-[17px] min-w-[17px] shrink-0 place-items-center rounded-full px-1 text-[10px] font-semibold normal-case tracking-normal tabular-nums"
                    style={{
                      background: 'var(--accent, #b07d2b)',
                      color: 'var(--shell-on-accent, #fcf8ee)',
                    }}
                  >
                    {toLocaleDigits(section.badge, locale)}
                  </span>
                )}
              </span>
              <svg
                className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
                style={{ color: 'var(--shell-muted, #9a8b70)' }}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {open && (
              <div className="flex max-h-[300px] min-h-0 flex-col overflow-y-auto pb-4">
                {section.kind === 'presets' ? presetsPane : <SectionPane section={section} />}
              </div>
            )}
          </section>
        );
      })}

      {signInHint && (
        <p className="pt-3 text-[12.5px] leading-[1.7]" style={{ color: 'var(--shell-muted, #6e6354)' }}>
          {signInHint}
        </p>
      )}
    </div>
  );
}
