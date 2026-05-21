'use client';

export default function BookCardSkeleton({ variant = 'grid' }: { variant?: 'grid' | 'list' }) {
  if (variant === 'list') {
    return (
      <div className="flex gap-4 p-4 bg-gradient-to-b from-card-2 to-card rounded-[18px] border border-border animate-pulse">
        <div className="flex-shrink-0 w-20 sm:w-24 aspect-[2/3] rounded-[10px] bg-white/[0.04]" />
        <div className="flex-1 min-w-0 space-y-3">
          <div className="h-5 bg-white/[0.04] rounded w-2/3" />
          <div className="h-3.5 bg-white/[0.04] rounded w-1/3" />
          <div className="space-y-1.5">
            <div className="h-3 bg-white/[0.04] rounded w-full" />
            <div className="h-3 bg-white/[0.04] rounded w-5/6" />
          </div>
          <div className="flex gap-2 pt-1">
            <div className="h-4 bg-white/[0.04] rounded-full w-16" />
            <div className="h-4 bg-white/[0.04] rounded-full w-20" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-b from-card-2 to-card rounded-[18px] border border-border overflow-hidden animate-pulse">
      <div className="aspect-[2/3] bg-white/[0.04]" />
      <div className="p-4 space-y-2.5">
        <div className="h-4 bg-white/[0.04] rounded w-full" />
        <div className="h-4 bg-white/[0.04] rounded w-2/3" />
        <div className="h-3 bg-white/[0.04] rounded w-1/2" />
        <div className="h-3 bg-white/[0.04] rounded w-3/4" />
      </div>
    </div>
  );
}
