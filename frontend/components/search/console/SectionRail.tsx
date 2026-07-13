'use client';

import { useRef } from 'react';
import type { KeyboardEvent } from 'react';

import { useI18n } from '@/components/i18n/I18nProvider';
import { toLocaleDigits } from '@/lib/utils';
import type { FilterSectionKey, SectionSpec } from './types';

export interface SectionRailProps {
  sections: SectionSpec[];
  activeKey: FilterSectionKey;
  onSelect: (key: FilterSectionKey) => void;
  /** Prefix for the tab / tabpanel id pairing. */
  idBase: string;
}

/**
 * The console's side rail: a vertical `tablist` of filter sections with
 * selected-count badges. Manual activation — ArrowUp/Down + Home/End move
 * roving focus, Enter/Space (native button click) activates.
 */
export default function SectionRail({ sections, activeKey, onSelect, idBase }: SectionRailProps) {
  const { locale } = useI18n();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const current = refs.current.findIndex((el) => el !== null && el === document.activeElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = Math.min((current < 0 ? -1 : current) + 1, sections.length - 1);
    else if (e.key === 'ArrowUp') next = Math.max((current < 0 ? sections.length : current) - 1, 0);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = sections.length - 1;
    if (next >= 0) {
      e.preventDefault();
      refs.current[next]?.focus();
    }
  };

  return (
    <div
      role="tablist"
      aria-orientation="vertical"
      onKeyDown={onKeyDown}
      className="flex flex-col gap-0.5 overflow-y-auto p-2"
    >
      {sections.map((section, i) => {
        const on = section.key === activeKey;
        return (
          <button
            key={section.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${idBase}-tab-${section.key}`}
            aria-selected={on}
            aria-controls={`${idBase}-pane-${section.key}`}
            tabIndex={on ? 0 : -1}
            onClick={() => onSelect(section.key)}
            className="flex items-center justify-between gap-2 rounded-[9px] px-3 py-2 text-start text-[12.5px] font-medium transition-colors"
            style={
              on
                ? {
                    background: 'color-mix(in srgb, var(--accent, #b07d2b) 12%, transparent)',
                    color: 'var(--shell-ink, #2c2620)',
                  }
                : { color: 'var(--shell-ink-2, #6e6354)' }
            }
          >
            <span className="min-w-0 truncate">{section.label}</span>
            {section.badge > 0 && (
              <span
                className="grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full px-1 text-[10.5px] font-semibold tabular-nums"
                style={{
                  background: 'var(--accent, #b07d2b)',
                  color: 'var(--shell-on-accent, #fcf8ee)',
                }}
              >
                {toLocaleDigits(section.badge, locale)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
