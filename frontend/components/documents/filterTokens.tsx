import type { ReactNode } from 'react';

/* ─── Shared design tokens for the documents filter sidebar ─── */
export const PILL_BASE =
  'inline-flex items-center justify-center gap-1.5 px-3 py-1 text-[11.5px] rounded-full border transition-all duration-200';
export const PILL_ON = `${PILL_BASE} bg-accent-soft border-accent/40 text-accent-2`;
export const PILL_OFF = `${PILL_BASE} bg-card border-border-strong text-text-2 hover:border-accent hover:text-accent-2`;
export const SECTION_EYEBROW_CLASS = 'text-[11px] tracking-[0.18em] uppercase text-accent font-medium';
export const FACET_INPUT_CLASS =
  'w-full ps-8 pe-3 py-2 rounded-[10px] text-[12.5px] font-fraunces outline-none transition-all bg-card text-text placeholder:text-text-3 focus:border-accent focus:bg-accent-soft/40 focus:shadow-[0_0_0_4px_rgba(185,115,64,0.08)] border border-border';
export const DATE_INPUT_CLASS =
  'w-full px-3 py-2 rounded-[10px] text-[12.5px] font-fraunces outline-none transition-all bg-card text-text placeholder:text-text-3 focus:border-accent focus:bg-accent-soft/40 focus:shadow-[0_0_0_4px_rgba(185,115,64,0.08)] border border-border';

export function FilterSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="py-4 border-b border-border last:border-b-0">
      <h3 className={`${SECTION_EYEBROW_CLASS} mb-3`}>{heading}</h3>
      {children}
    </section>
  );
}
