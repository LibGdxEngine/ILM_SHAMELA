import React, { useEffect, useRef, useCallback } from 'react';
import { DocumentPage as DocumentPageType } from '@/lib/api';
import DocumentPage from './DocumentPage';

interface DocumentViewerProps {
  pages: DocumentPageType[];
  isLoading: boolean;
  hasMore: boolean;
  searchQuery: string;
  onLoadMore: () => void;
  onPageVisible: (pageNumber: number) => void;
  onLoadFirstPage?: () => void;
  language?: string | null;
}

export default function DocumentViewer({ 
  pages, 
  isLoading, 
  hasMore, 
  searchQuery, 
  onLoadMore,
  onPageVisible,
  onLoadFirstPage,
  language
}: DocumentViewerProps) {
  const observer = useRef<IntersectionObserver | null>(null);
  const lastPageRef = useRef<HTMLDivElement | null>(null);
  const lastPageNodeRef = useRef<HTMLDivElement | null>(null); // Track the currently observed node
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const topSentinelRef = useRef<HTMLDivElement | null>(null);
  
  // Use refs to store latest values to avoid recreating observer
  const isLoadingRef = useRef(isLoading);
  const hasMoreRef = useRef(hasMore);
  const onLoadMoreRef = useRef(onLoadMore);
  const onPageVisibleRef = useRef(onPageVisible);
  
  // Update refs when values change
  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);
  
  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);
  
  useEffect(() => {
    onLoadMoreRef.current = onLoadMore;
  }, [onLoadMore]);
  
  useEffect(() => {
    onPageVisibleRef.current = onPageVisible;
  }, [onPageVisible]);

  // Infinite scroll observer - only recreate when node actually changes
  const lastElementRef = useCallback((node: HTMLDivElement | null) => {
    // If it's the same node, don't recreate the observer
    if (lastPageNodeRef.current === node) {
      return;
    }
    
    // Disconnect previous observer
    if (observer.current) {
      observer.current.disconnect();
      observer.current = null;
    }
    
    // Update the tracked node
    lastPageNodeRef.current = node;
    
    // Don't set up observer if loading, no more pages, or no node
    if (isLoadingRef.current || !hasMoreRef.current || !node) {
      return;
    }
    
    // Create new observer with refs to access latest values
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMoreRef.current && !isLoadingRef.current) {
        onLoadMoreRef.current();
      }
    });
    
    observer.current.observe(node);
  }, []); // Empty deps - we use refs for values
  
  // Cleanup observer on unmount
  useEffect(() => {
    return () => {
      if (observer.current) {
        observer.current.disconnect();
        observer.current = null;
      }
    };
  }, []);

  // Refs for visibility observer
  const visibilityObserverRef = useRef<IntersectionObserver | null>(null);
  const observedPagesRef = useRef<Set<number>>(new Set());
  const lastReportedPageRef = useRef<number | null>(null);
  const intersectingPagesRef = useRef<Map<number, IntersectionObserverEntry>>(new Map());

  // Create and maintain visibility observer (persistent, not recreated on page loads)
  useEffect(() => {
    const visibilityObserver = new IntersectionObserver(
      (entries) => {
        // Track which pages are currently intersecting
        entries.forEach((entry) => {
          const pageNum = parseInt(entry.target.getAttribute('data-page') || '0');
          if (pageNum > 0) {
            if (entry.isIntersecting) {
              intersectingPagesRef.current.set(pageNum, entry);
            } else {
              intersectingPagesRef.current.delete(pageNum);
            }
          }
        });

        // Find the page closest to viewport center
        if (intersectingPagesRef.current.size > 0) {
          let centerMostPage: number | null = null;
          let minDistance = Infinity;

          intersectingPagesRef.current.forEach((entry, pageNum) => {
            // Get the vertical center of the entry
            const rect = entry.boundingClientRect;
            const entryCenter = rect.top + rect.height / 2;
            const viewportCenter = window.innerHeight / 2;
            const distance = Math.abs(entryCenter - viewportCenter);

            if (distance < minDistance) {
              minDistance = distance;
              centerMostPage = pageNum;
            }
          });

          // Only call callback if the center-most page changed
          if (centerMostPage !== null && centerMostPage !== lastReportedPageRef.current) {
            lastReportedPageRef.current = centerMostPage;
            onPageVisibleRef.current(centerMostPage);
          }
        }
      },
      {
        rootMargin: '-35% 0px -35% 0px', // Track center 30% of viewport
        threshold: 0.1
      }
    );

    visibilityObserverRef.current = visibilityObserver;

    return () => {
      visibilityObserver.disconnect();
      visibilityObserverRef.current = null;
    };
  }, []); // Empty deps - observer is created once and reused

  // Observe newly loaded pages
  useEffect(() => {
    const observer = visibilityObserverRef.current;
    if (!observer) return;

    // Observe any pages that aren't already observed
    pageRefs.current.forEach((el, pageNum) => {
      if (!observedPagesRef.current.has(pageNum)) {
        observer.observe(el);
        observedPagesRef.current.add(pageNum);
      }
    });
  }, [pages]); // This effect runs when pages change, but doesn't recreate the observer

  // Scroll to top detection - load first page if not loaded
  useEffect(() => {
    if (!onLoadFirstPage) return;

    const topSentinel = topSentinelRef.current;
    if (!topSentinel) return;

    // Find the scroll container (parent div with id "document-scroll-container")
    const scrollContainer = document.getElementById('document-scroll-container');

    const topObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            // Check if page 1 is not loaded
            const hasFirstPage = pages.some(p => p.page_number === 1);
            if (!hasFirstPage && !isLoading) {
              onLoadFirstPage();
            }
          }
        });
      },
      {
        root: scrollContainer, // Use the scroll container as root
        rootMargin: '400px 0px 0px 0px', // Trigger when sentinel is 400px from top
        threshold: 0
      }
    );

    topObserver.observe(topSentinel);

    return () => {
      topObserver.disconnect();
    };
  }, [pages, isLoading, onLoadFirstPage]);

  // Function to scroll to a specific page
  // We attach this to window so parent can call it if needed, 
  // but better to expose via ref. For now keeping it simple.
  
  // Determine text direction based on language
  const textDirection = language === 'ar' ? 'rtl' : 'ltr';

  return (
    <div 
      className="max-w-4xl mx-auto py-8 px-4"
      dir={textDirection}
    >
      {/* Top sentinel for scroll detection */}
      {onLoadFirstPage && (
        <div 
          ref={topSentinelRef}
          className="h-1 w-full"
          aria-hidden="true"
        />
      )}
      
      {pages.map((page, index) => {
        const isLastPage = index === pages.length - 1;
        return (
          <div 
            key={page.page_number} 
            ref={(el) => {
              if (el) pageRefs.current.set(page.page_number, el);
              if (isLastPage) lastElementRef(el);
            }}
            data-page={page.page_number}
          >
            <DocumentPage 
              pageNumber={page.page_number}
              content={page.content}
              searchQuery={searchQuery}
              language={language}
            />
          </div>
        );
      })}
      
      {isLoading && (
         <div className="flex flex-col items-center justify-center py-10">
           <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mb-2" />
           <p className="text-sm text-gray-500 font-medium">Loading pages...</p>
         </div>
      )}
      
      {!hasMore && pages.length > 0 && (
        <div className="text-center py-10 border-t border-gray-100 dark:border-gray-800 mt-8">
          <p className="text-gray-400 text-sm">End of document</p>
        </div>
      )}

      {pages.length === 0 && !isLoading && (
        <div className="text-center py-20">
          <p className="text-gray-500">No pages found.</p>
        </div>
      )}
    </div>
  );
}
