'use client';

import { useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';

import { useI18n } from '@/components/i18n/I18nProvider';
import DateRangePane from './DateRangePane';
import ModePane from './ModePane';
import OptionListPane from './OptionListPane';
import SectionRail from './SectionRail';
import type { FilterSectionKey, SectionSpec } from './types';

export interface SearchConsoleProps {
  sections: SectionSpec[];
  /** Rendered when the presets section is active (the dialog owns its
   *  surface-specific wiring). */
  presetsPane?: ReactNode;
  /** Shown instead of the rail+pane grid when only the mode section survives
   *  the auth gate (signed-out). */
  signInHint?: string;
}

/** Renders the pane body for a non-presets section. */
export function SectionPane({ section }: { section: SectionSpec }) {
  switch (section.kind) {
    case 'options':
      return <OptionListPane section={section} />;
    case 'mode':
      return <ModePane section={section} />;
    case 'dateRange':
      return <DateRangePane section={section} />;
    default:
      return null;
  }
}

/**
 * The two-pane research console body: a side rail of filter sections
 * (inline-start — right in RTL) and the active section's browsable pane.
 * Rail and pane scroll independently; `tab`/`tabpanel` semantics pair them.
 */
export default function SearchConsole({ sections, presetsPane, signInHint }: SearchConsoleProps) {
  const { t } = useI18n();
  const idBase = useId();
  const [activeKey, setActiveKey] = useState<FilterSectionKey>(
    sections[0]?.key ?? 'mode',
  );

  // If the active section disappears (sign-out, facet endpoint failure after
  // deselection), fall back to the first available one.
  useEffect(() => {
    if (!sections.some((s) => s.key === activeKey) && sections.length > 0) {
      setActiveKey(sections[0].key);
    }
  }, [sections, activeKey]);

  const active = sections.find((s) => s.key === activeKey) ?? sections[0];

  if (!active) return null;

  const only = sections.length === 1 ? sections[0] : null;
  if (only && only.kind === 'mode') {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <ModePane section={only} />
        {signInHint && (
          <p className="text-[12.5px] leading-[1.7]" style={{ color: 'var(--shell-muted, #6e6354)' }}>
            {signInHint}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[200px_minmax(0,1fr)]">
      <div
        className="min-h-0 border-e"
        style={{
          borderColor: 'var(--shell-line, #e2d5ba)',
          background: 'color-mix(in srgb, var(--shell-rail, #f4ecd8) 55%, var(--shell-surface, #fcf8ee))',
        }}
      >
        <SectionRail
          sections={sections}
          activeKey={active.key}
          onSelect={setActiveKey}
          idBase={idBase}
        />
      </div>

      <div
        role="tabpanel"
        id={`${idBase}-pane-${active.key}`}
        aria-labelledby={`${idBase}-tab-${active.key}`}
        className="flex min-h-0 flex-col overflow-y-auto p-4"
      >
        <h3
          className="mb-3 text-[11px] font-medium uppercase tracking-[0.18em]"
          style={{ color: 'var(--accent, #b07d2b)' }}
        >
          {active.label}
        </h3>
        {active.kind === 'presets' ? (
          presetsPane ?? (
            <p className="text-[12.5px]" style={{ color: 'var(--shell-muted, #9a8b70)' }}>
              {t('console.presets.empty', 'لا إعدادات محفوظة بعد — اختر مرشِّحاتك ثم احفظها باسم لتعود إليها بنقرة.')}
            </p>
          )
        ) : (
          <SectionPane section={active} />
        )}
      </div>
    </div>
  );
}
