'use client';

export default function BookCardSkeleton() {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden animate-pulse">
      {/* Cover Skeleton */}
      <div className="aspect-[3/4] bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-600" />
      
      {/* Info Skeleton */}
      <div className="p-4 space-y-3">
        {/* Title */}
        <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-full" />
        <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
        
        {/* Author */}
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
        
        {/* Categories */}
        <div className="flex gap-2">
          <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded-full w-16" />
          <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded-full w-20" />
        </div>
        
        {/* Date */}
        <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-24" />
        </div>
      </div>
    </div>
  );
}
