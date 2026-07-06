import type { ReactNode } from 'react';

/* ─── Shared design tokens for the documents filter sidebar ───
 * Styled with Reading Room parchment/gold literals (the `.reading-room`
 * theme does not remap the generic `bg-card`/`accent` Tailwind tokens, so we
 * use the palette hexes directly): surface #fcf8ee · rail #f4ecd8 ·
 * brand #b07d2b · ink #2c2620 · ink-2 #6e6354 · ink-3 #9a8b70 ·
 * line #e2d5ba · line-2 #e7dbc1.
 */
export const PILL_BASE =
  'inline-flex items-center justify-center gap-1.5 px-3 py-1 text-[11.5px] rounded-full border transition-all duration-200';
export const PILL_ON = `${PILL_BASE} bg-[#b07d2b] border-[#b07d2b] text-[#fcf8ee]`;
export const PILL_OFF = `${PILL_BASE} bg-[#fcf8ee] border-[#e2d5ba] text-[#6e6354] hover:border-[#b07d2b] hover:text-[#2c2620]`;
export const SECTION_EYEBROW_CLASS = 'text-[11px] tracking-[0.18em] uppercase text-[#b07d2b] font-medium';
export const FACET_INPUT_CLASS =
  'w-full ps-8 pe-3 py-2 rounded-[10px] text-[12.5px] font-fraunces outline-none transition-all bg-[#fcf8ee] text-[#2c2620] placeholder:text-[#9a8b70] focus:border-[#b07d2b] focus:shadow-[0_0_0_4px_rgba(176,125,43,0.10)] border border-[#e2d5ba]';

/* ─── Date picker (DatePickerField) ─── */
export const DATE_TRIGGER_CLASS =
  'flex w-full items-center justify-between gap-2 rounded-[10px] border px-3 py-2 text-[12.5px] font-fraunces transition-all bg-[#fcf8ee] text-[#2c2620] border-[#e2d5ba] hover:border-[#b07d2b] focus:outline-none focus:border-[#b07d2b] focus:shadow-[0_0_0_4px_rgba(176,125,43,0.10)] disabled:opacity-50';
export const DATE_POPOVER_CLASS =
  'absolute z-40 top-full mt-2 start-0 w-[16rem] rounded-[14px] border border-[#e2d5ba] bg-[#fcf8ee] p-3 shadow-[0_18px_42px_-12px_rgba(44,38,32,0.28)]';

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
  if (disabled) return `${base} cursor-not-allowed text-[#9a8b70]/40`;
  if (selected) return `${base} bg-[#b07d2b] font-medium text-[#fcf8ee]`;
  if (today) return `${base} text-[#2c2620] ring-1 ring-[#b07d2b]/45`;
  return `${base} text-[#2c2620] hover:bg-[#f4ecd8]`;
}

export function FilterSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="py-4 border-b border-[#e7dbc1] last:border-b-0">
      <h3 className={`${SECTION_EYEBROW_CLASS} mb-3`}>{heading}</h3>
      {children}
    </section>
  );
}
