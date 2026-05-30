'use client';

import { ReactNode } from 'react';

interface ShelfProps {
  eyebrow?: string;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}

export default function Shelf({ eyebrow, title, children, action }: ShelfProps) {
  return (
    <section className="mb-10">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          {eyebrow && (
            <span className="section-eyebrow">{eyebrow}</span>
          )}
          <h2 className="mt-2 font-fraunces font-light text-[clamp(22px,2.6vw,30px)] leading-[1.15] text-text">
            {title}
          </h2>
        </div>
        {action && <div className="flex-shrink-0">{action}</div>}
      </div>
      <div className="-mx-2 flex gap-4 overflow-x-auto px-2 pb-3 md:grid md:grid-cols-2 lg:grid-cols-4 md:overflow-visible md:gap-4">
        {children}
      </div>
    </section>
  );
}
