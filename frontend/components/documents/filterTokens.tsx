import type { ReactNode } from 'react';

/* ─── Shared design tokens for the documents filter sidebar + search console ───
 * Themed from the generic `--shell-*`/`--accent` contract with Reading Room
 * parchment/gold literal fallbacks, so the same tokens render correctly inside
 * body portals (which set the vars explicitly) and any shell that aliases them:
 * surface #fcf8ee · rail #f4ecd8 · brand #b07d2b · ink #2c2620 ·
 * ink-2 #6e6354 · ink-3 #9a8b70 · line #e2d5ba · line-2 #e7dbc1.
 * (`--shell-ink-2`/`--shell-rail` are optional aliases — keep the fallbacks.)
 */
export const PILL_BASE =
  'inline-flex items-center justify-center gap-1.5 px-3 py-1 text-[11.5px] rounded-full border transition-all duration-200';
export const PILL_ON = `${PILL_BASE} bg-[var(--accent,#b07d2b)] border-[var(--accent,#b07d2b)] text-[var(--shell-on-accent,#fcf8ee)]`;
export const PILL_OFF = `${PILL_BASE} bg-[var(--shell-surface,#fcf8ee)] border-[var(--shell-line,#e2d5ba)] text-[var(--shell-ink-2,#6e6354)] hover:border-[var(--accent,#b07d2b)] hover:text-[var(--shell-ink,#2c2620)]`;
export const SECTION_EYEBROW_CLASS =
  'text-[11px] tracking-[0.18em] uppercase text-[var(--accent,#b07d2b)] font-medium';
export const FACET_INPUT_CLASS =
  'w-full ps-8 pe-3 py-2 rounded-[10px] text-[12.5px] font-fraunces outline-none transition-all bg-[var(--shell-surface,#fcf8ee)] text-[var(--shell-ink,#2c2620)] placeholder:text-[var(--shell-muted,#9a8b70)] focus:border-[var(--accent,#b07d2b)] focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent,#b07d2b)_10%,transparent)] border border-[var(--shell-line,#e2d5ba)]';

/* ─── Date picker (DatePickerField) ─── */
export const DATE_TRIGGER_CLASS =
  'flex w-full items-center justify-between gap-2 rounded-[10px] border px-3 py-2 text-[12.5px] font-fraunces transition-all bg-[var(--shell-surface,#fcf8ee)] text-[var(--shell-ink,#2c2620)] border-[var(--shell-line,#e2d5ba)] hover:border-[var(--accent,#b07d2b)] focus:outline-none focus:border-[var(--accent,#b07d2b)] focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent,#b07d2b)_10%,transparent)] disabled:opacity-50';
export const DATE_POPOVER_CLASS =
  'absolute z-40 top-full mt-2 start-0 w-[16rem] rounded-[14px] border border-[var(--shell-line,#e2d5ba)] bg-[var(--shell-surface,#fcf8ee)] p-3 shadow-[0_18px_42px_-12px_rgba(44,38,32,0.28)]';

/** Class string for a single calendar day cell, by state. */
export function dayCellClass({
  selected,
  today,
  disabled,
}: {
  selected: boolean;
  today: boolean;
  disabled: boolean;
}): string {
  const base = 'grid h-8 w-full place-items-center rounded-md text-[12px] tabular-nums transition-colors';
  if (disabled) return `${base} cursor-not-allowed text-[color-mix(in_srgb,var(--shell-muted,#9a8b70)_40%,transparent)]`;
  if (selected) return `${base} bg-[var(--accent,#b07d2b)] font-medium text-[var(--shell-on-accent,#fcf8ee)]`;
  if (today) return `${base} text-[var(--shell-ink,#2c2620)] ring-1 ring-[color-mix(in_srgb,var(--accent,#b07d2b)_45%,transparent)]`;
  return `${base} text-[var(--shell-ink,#2c2620)] hover:bg-[var(--shell-rail,#f4ecd8)]`;
}

export function FilterSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="py-4 border-b border-[var(--shell-line,#e7dbc1)] last:border-b-0">
      <h3 className={`${SECTION_EYEBROW_CLASS} mb-3`}>{heading}</h3>
      {children}
    </section>
  );
}
