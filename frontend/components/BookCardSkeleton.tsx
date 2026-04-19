'use client';

export default function BookCardSkeleton({ variant = 'grid' }: { variant?: 'grid' | 'list' }) {
  if (variant === 'list') {
    return (
      <div className="flex gap-4 p-4 bg-ivory dark:bg-dark-surface rounded-xl border border-border-cream dark:border-dark-surface shadow-whisper animate-pulse">
        <div className="flex-shrink-0 w-20 sm:w-24 aspect-[2/3] rounded-md bg-warm-sand dark:bg-[#3d3d3a]" />
        <div className="flex-1 min-w-0 space-y-3">
          <div className="h-5 bg-warm-sand dark:bg-[#3d3d3a] rounded w-2/3" />
          <div className="h-3.5 bg-warm-sand dark:bg-[#3d3d3a] rounded w-1/3" />
          <div className="space-y-1.5">
            <div className="h-3 bg-warm-sand dark:bg-[#3d3d3a] rounded w-full" />
            <div className="h-3 bg-warm-sand dark:bg-[#3d3d3a] rounded w-5/6" />
          </div>
          <div className="flex gap-2 pt-1">
            <div className="h-4 bg-warm-sand dark:bg-[#3d3d3a] rounded-full w-16" />
            <div className="h-4 bg-warm-sand dark:bg-[#3d3d3a] rounded-full w-20" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-ivory dark:bg-dark-surface rounded-xl border border-border-cream dark:border-dark-surface shadow-whisper overflow-hidden animate-pulse">
      <div className="aspect-[2/3] bg-warm-sand dark:bg-[#3d3d3a]" />
      <div className="p-4 space-y-2.5">
        <div className="h-4 bg-warm-sand dark:bg-[#3d3d3a] rounded w-full" />
        <div className="h-4 bg-warm-sand dark:bg-[#3d3d3a] rounded w-2/3" />
        <div className="h-3 bg-warm-sand dark:bg-[#3d3d3a] rounded w-1/2" />
        <div className="h-3 bg-warm-sand dark:bg-[#3d3d3a] rounded w-3/4" />
      </div>
    </div>
  );
}
