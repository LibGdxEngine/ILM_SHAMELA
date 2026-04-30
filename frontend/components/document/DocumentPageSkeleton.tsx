import React from 'react';

export default function DocumentPageSkeleton() {
  return (
    <div className="bg-gradient-to-b from-card-2 to-card border border-border rounded-[18px] mb-6 overflow-hidden animate-pulse">
      {/* Page Header Skeleton */}
      <div className="px-6 py-3 border-b border-border bg-white/[0.02]">
        <div className="h-4 w-20 bg-white/[0.05] rounded"></div>
      </div>

      {/* Page Content Skeleton */}
      <div className="p-8 md:p-10">
        <div className="space-y-4">
          <div className="h-4 bg-white/[0.05] rounded w-full"></div>
          <div className="h-4 bg-white/[0.05] rounded w-5/6"></div>
          <div className="h-4 bg-white/[0.05] rounded w-full"></div>
          <div className="h-4 bg-white/[0.05] rounded w-4/5"></div>
          <div className="h-4 bg-white/[0.05] rounded w-full"></div>
          <div className="h-4 bg-white/[0.05] rounded w-3/4"></div>
          <div className="h-4 bg-white/[0.05] rounded w-full"></div>
          <div className="h-4 bg-white/[0.05] rounded w-5/6"></div>
          <div className="h-4 bg-white/[0.05] rounded w-full"></div>
          <div className="h-4 bg-white/[0.05] rounded w-4/5"></div>
        </div>
      </div>
    </div>
  );
}
