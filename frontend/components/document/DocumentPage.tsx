import React from 'react';

interface DocumentPageProps {
  pageNumber: number;
  content: string;
  searchQuery: string;
  isIntersecting?: boolean;
  language?: string | null;
}

function highlightText(text: string, query: string): string {
  if (!query.trim()) return text;
  // Escape special regex characters
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedQuery})`, 'gi');
  return text.replace(regex, '<mark class="bg-yellow-200/80 dark:bg-yellow-500/30 px-1 py-0.5 rounded text-gray-900 dark:text-gray-100">$1</mark>');
}

export default function DocumentPage({ pageNumber, content, searchQuery, language }: DocumentPageProps) {
  // Determine text direction: Arabic = RTL, others = LTR
  const textDirection = language === 'ar' ? 'rtl' : 'ltr';
  
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm mb-6 overflow-hidden relative group transition-all hover:shadow-md">
      {/* Page Header */}
      <div className="px-6 py-3 bg-gray-50/50 dark:bg-gray-700/30 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          Page {pageNumber}
        </span>
      </div>

      {/* Page Content */}
      <div 
        className="p-8 md:p-10 select-none cursor-default"
        onContextMenu={(e) => e.preventDefault()}
        dir={textDirection}
      >
        <div
          className={`prose prose-lg dark:prose-invert max-w-none font-serif leading-relaxed ${
            textDirection === 'rtl' ? 'text-right' : 'text-left'
          }`}
          dangerouslySetInnerHTML={{
            __html: highlightText(
              content.replace(/\n/g, '<br />'),
              searchQuery
            ),
          }}
        />
      </div>
      
      {/* Footer / Overlay (optional) */}
      <div className="absolute inset-0 pointer-events-none border-2 border-transparent group-hover:border-indigo-500/10 dark:group-hover:border-indigo-400/10 rounded-xl transition-colors" />
    </div>
  );
}
