'use client';

import Link from 'next/link';
import { Document } from '@/lib/api';
import { paletteFor } from '@/lib/coverPalettes';
import { useLocalizedPath } from '@/lib/i18n/navigation';

interface BookSpineProps {
  document: Document;
  /** Reading progress 0..100; when present a sliver runs along the spine foot. */
  progressPercent?: number;
}

function hashString(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

export default function BookSpine({ document, progressPercent }: BookSpineProps) {
  const localizedPath = useLocalizedPath();
  const palette = paletteFor(document);

  // Deterministic height variation for a real-shelf feel (no Math.random → no
  // hydration mismatch). Range ~216–248px.
  const height = 216 + (hashString(document.title || 'untitled') % 4) * 11;

  const hasProgress = typeof progressPercent === 'number';
  const percent = hasProgress ? Math.max(0, Math.min(100, Math.round(progressPercent!))) : 0;

  return (
    <Link
      href={localizedPath(`/documents/${document.id}`)}
      title={document.title}
      className="group block flex-shrink-0 transition-transform duration-300 hover:-translate-y-1.5"
    >
      <div
        className="relative w-[clamp(36px,4vw,52px)] rounded-[5px] border border-black/30 shadow-[0_6px_16px_-6px_rgba(0,0,0,0.6),inset_1px_0_0_rgba(255,255,255,0.08)] overflow-hidden"
        style={{
          height: `${height}px`,
          backgroundImage: `linear-gradient(180deg, ${palette.from}, ${palette.to})`,
        }}
      >
        {/* Head & foot accent bands */}
        <div
          className="absolute inset-x-0 top-2.5 h-px"
          style={{ background: palette.accent, opacity: 0.55 }}
          aria-hidden
        />
        <div
          className="absolute inset-x-0 bottom-2.5 h-px"
          style={{ background: palette.accent, opacity: 0.55 }}
          aria-hidden
        />

        {/* Vertical title — per-string direction preserved for mixed Arabic/Latin. */}
        <span
          dir="auto"
          className="absolute inset-0 flex items-center justify-center px-1 py-5 text-center font-reem-kufi text-[12px] leading-[1.15] overflow-hidden"
          style={{ writingMode: 'vertical-rl', color: palette.text }}
        >
          {document.title}
        </span>

        {hasProgress && (
          <div className="absolute inset-x-1 bottom-1 h-0.5 rounded-full bg-black/30 overflow-hidden">
            <div className="h-full bg-accent" style={{ width: `${percent}%` }} aria-hidden />
          </div>
        )}
      </div>
    </Link>
  );
}
