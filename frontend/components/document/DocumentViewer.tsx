import React, { useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { DocumentPage as DocumentPageType } from '@/lib/api';
import type { ApiHighlight } from '@/lib/api/reader';
import DocumentPageImage from './DocumentPageImage';
import DocumentPageSkeleton from './DocumentPageSkeleton';
import ErrorDisplay from '@/components/ErrorDisplay';
import { useI18n } from '@/components/i18n/I18nProvider';
import { useLocalizedPath } from '@/lib/i18n/navigation';
import { isRtlLanguage } from '@/lib/reader/pageImage';

interface DocumentViewerProps {
  documentId: number;
  pages: DocumentPageType[];
  isLoading: boolean;
  hasMore: boolean;
  searchQuery: string;
  onLoadMore: () => void;
  onPageVisible: (pageNumber: number) => void;
  onLoadFirstPage?: () => void;
  language?: string | null;
  error?: string | null;
  onRetry?: () => void;
  loadingBatchPage?: number | null;
  totalPages?: number;
  highlightedPage?: number | null;
  tashkeelEnabled?: boolean;
  highlights?: ApiHighlight[];
  /** Signature of reader layout settings; changes trigger page-image regen. */
  styleSignature?: string;
}

export default function DocumentViewer({
  documentId,
  pages,
  isLoading,
  hasMore,
  searchQuery,
  onLoadMore,
  onPageVisible,
  onLoadFirstPage,
  language,
  error,
  onRetry,
  loadingBatchPage,
  totalPages,
  highlightedPage,
  tashkeelEnabled = true,
  highlights = [],
  styleSignature = ''
}: DocumentViewerProps) {
  const { t } = useI18n();
  const localizedPath = useLocalizedPath();

  const observer = useRef<IntersectionObserver | null>(null);
  const lastPageRef = useRef<HTMLDivElement | null>(null);
  const lastPageNodeRef = useRef<HTMLDivElement | null>(null); // Track the currently observed node
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const topSentinelRef = useRef<HTMLDivElement | null>(null);
  const isLoadingFirstPageRef = useRef(false); // Track if first page load is in progress
  const topObserverRef = useRef<IntersectionObserver | null>(null);
  const visibilityObserverRef = useRef<IntersectionObserver | null>(null);
  const intersectionRatiosRef = useRef<Map<number, number>>(new Map());
  const lastScrollTopRef = useRef<number>(0);
  const scrollDirectionRef = useRef<'up' | 'down'>('down');
  
  // Use refs to store latest values to avoid recreating observer
  const isLoadingRef = useRef(isLoading);
  const hasMoreRef = useRef(hasMore);
  const onLoadMoreRef = useRef(onLoadMore);
  const onPageVisibleRef = useRef(onPageVisible);
  const onLoadFirstPageRef = useRef(onLoadFirstPage);
  const pagesRef = useRef(pages); // Track pages for top observer
  
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
  
  useEffect(() => {
    onLoadFirstPageRef.current = onLoadFirstPage;
  }, [onLoadFirstPage]);
  
  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  // Stamp a temporary `data-search-hit` attribute on the page wrapper when a
  // search result is clicked. CSS in globals.css applies the pulse animation.
  useEffect(() => {
    if (highlightedPage == null) return;
    const node = pageRefs.current.get(highlightedPage);
    if (!node) return;
    node.setAttribute('data-search-hit', 'true');
    const timer = window.setTimeout(() => {
      node.removeAttribute('data-search-hit');
    }, 1500);
    return () => {
      window.clearTimeout(timer);
      node.removeAttribute('data-search-hit');
    };
  }, [highlightedPage]);

  // Infinite scroll observer - recreate when node or state changes
  const lastElementRef = useCallback((node: HTMLDivElement | null) => {
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
  
  // Recreate observer when pages, isLoading, or hasMore changes
  useEffect(() => {
    const currentNode = lastPageNodeRef.current;
    
    // Disconnect existing observer
    if (observer.current) {
      observer.current.disconnect();
      observer.current = null;
    }
    
    // Recreate observer if we have a node and conditions are met
    if (currentNode && !isLoadingRef.current && hasMoreRef.current) {
      observer.current = new IntersectionObserver(entries => {
        if (entries[0].isIntersecting && hasMoreRef.current && !isLoadingRef.current) {
          onLoadMoreRef.current();
        }
      });
      
      observer.current.observe(currentNode);
    }
  }, [pages, isLoading, hasMore]); // Recreate when these change
  
  // Cleanup all observers on unmount
  useEffect(() => {
    return () => {
      // Cleanup infinite scroll observer
      if (observer.current) {
        observer.current.disconnect();
        observer.current = null;
      }
      // Cleanup top observer
      if (topObserverRef.current) {
        topObserverRef.current.disconnect();
        topObserverRef.current = null;
      }
      // Cleanup visibility observer
      if (visibilityObserverRef.current) {
        visibilityObserverRef.current.disconnect();
        visibilityObserverRef.current = null;
      }
      // Clear page refs
      pageRefs.current.clear();
    };
  }, []);

  // Track scroll direction
  useEffect(() => {
    const scrollContainer = document.getElementById('document-scroll-container');
    if (!scrollContainer) return;

    const handleScroll = () => {
      const currentScrollTop = scrollContainer.scrollTop;
      if (currentScrollTop > lastScrollTopRef.current) {
        scrollDirectionRef.current = 'down';
      } else if (currentScrollTop < lastScrollTopRef.current) {
        scrollDirectionRef.current = 'up';
      }
      lastScrollTopRef.current = currentScrollTop;
    };

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll);
    };
  }, []);

  // Visibility observer for current page tracking
  useEffect(() => {
    // Cleanup previous observer
    if (visibilityObserverRef.current) {
      visibilityObserverRef.current.disconnect();
      visibilityObserverRef.current = null;
    }

    // Clear intersection ratios when pages change
    intersectionRatiosRef.current.clear();

    const visibilityObserver = new IntersectionObserver(
      (entries) => {
        // Update intersection ratios for all entries
        entries.forEach((entry) => {
          const pageNum = parseInt(entry.target.getAttribute('data-page') || '0');
          if (pageNum > 0) {
            if (entry.isIntersecting) {
              intersectionRatiosRef.current.set(pageNum, entry.intersectionRatio);
            } else {
              intersectionRatiosRef.current.delete(pageNum);
            }
          }
        });

        // Find the page with the highest intersection ratio
        let maxRatio = 0;
        let mostVisiblePage = 0;
        const visiblePages: Array<{ pageNum: number; ratio: number }> = [];

        intersectionRatiosRef.current.forEach((ratio, pageNum) => {
          visiblePages.push({ pageNum, ratio });
          if (ratio > maxRatio) {
            maxRatio = ratio;
            mostVisiblePage = pageNum;
          }
        });

        // If multiple pages have similar ratios (within 10%), prefer based on scroll direction
        if (visiblePages.length > 1) {
          const similarPages = visiblePages.filter(p => Math.abs(p.ratio - maxRatio) < 0.1);
          if (similarPages.length > 1) {
            // Sort by page number
            similarPages.sort((a, b) => a.pageNum - b.pageNum);
            
            // If scrolling down, prefer higher page number; if scrolling up, prefer lower
            if (scrollDirectionRef.current === 'down') {
              mostVisiblePage = similarPages[similarPages.length - 1].pageNum;
            } else {
              mostVisiblePage = similarPages[0].pageNum;
            }
          }
        }

        // Only update if we have a valid most visible page
        if (mostVisiblePage > 0) {
          onPageVisibleRef.current(mostVisiblePage);
        }
      },
      {
        rootMargin: '-30% 0px -30% 0px', // Center 40% of viewport
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1.0] // Multiple thresholds for better ratio detection
      }
    );

    visibilityObserverRef.current = visibilityObserver;

    // Observe all current page elements
    pageRefs.current.forEach((el) => visibilityObserver.observe(el));

    return () => {
      if (visibilityObserverRef.current) {
        visibilityObserverRef.current.disconnect();
        visibilityObserverRef.current = null;
      }
      intersectionRatiosRef.current.clear();
    };
  }, [pages]); // Removed onPageVisible from deps - using ref instead

  // Scroll to top detection - load previous batch if not at page 1
  useEffect(() => {
    if (!onLoadFirstPage) return;

    const topSentinel = topSentinelRef.current;
    if (!topSentinel) return;

    // Disconnect previous observer if it exists
    if (topObserverRef.current) {
      topObserverRef.current.disconnect();
      topObserverRef.current = null;
    }

    // Find the scroll container (parent div with id "document-scroll-container")
    const scrollContainer = document.getElementById('document-scroll-container');

    const topObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            // Check if page 1 is not loaded and we're not already loading
            // Use refs to get latest values
            const hasFirstPage = pagesRef.current.some(p => p.page_number === 1);
            if (!hasFirstPage && !isLoadingRef.current && !isLoadingFirstPageRef.current) {
              isLoadingFirstPageRef.current = true;
              onLoadFirstPageRef.current?.();
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

    topObserverRef.current = topObserver;
    topObserver.observe(topSentinel);

    return () => {
      if (topObserverRef.current) {
        topObserverRef.current.disconnect();
        topObserverRef.current = null;
      }
    };
  }, [onLoadFirstPage]); // Only depend on onLoadFirstPage, not pages or isLoading
  
  // After a batch finishes loading, reset the flag and re-observe the sentinel
  // so the observer fires again for the next batch. This allows progressive
  // loading one batch at a time when scrolling up.
  useEffect(() => {
    // Only act when loading just finished (transition from loading to not loading)
    if (isLoading) return;
    
    const hasFirstPage = pages.some(p => p.page_number === 1);
    if (hasFirstPage) {
      isLoadingFirstPageRef.current = false;
      return;
    }
    
    // Reset flag so observer callback can run again
    isLoadingFirstPageRef.current = false;
    
    // Re-observe the sentinel to force IntersectionObserver to re-check.
    // IntersectionObserver fires on initial observe, so unobserving then
    // re-observing forces it to report the current intersection state.
    const sentinel = topSentinelRef.current;
    const observer = topObserverRef.current;
    if (sentinel && observer) {
      observer.unobserve(sentinel);
      observer.observe(sentinel);
    }
  }, [isLoading, pages]);

  // Function to scroll to a specific page
  // We attach this to window so parent can call it if needed, 
  // but better to expose via ref. For now keeping it simple.
  
  // Determine text direction based on language (Arabic AND Persian are RTL)
  const textDirection = isRtlLanguage(language) ? 'rtl' : 'ltr';

  return (
    <div 
      className="mx-auto max-w-5xl px-4 py-8 xl:max-w-6xl"
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
              if (el) {
                pageRefs.current.set(page.page_number, el);
                // Re-observe with visibility observer if it exists
                if (visibilityObserverRef.current) {
                  visibilityObserverRef.current.observe(el);
                }
              } else {
                // Remove ref when element is unmounted
                pageRefs.current.delete(page.page_number);
              }
              if (isLastPage) lastElementRef(el);
            }}
            data-page={page.page_number}
          >
            <DocumentPageImage
              documentId={documentId}
              pageNumber={page.page_number}
              content={page.content}
              language={language}
              tashkeelEnabled={tashkeelEnabled}
              styleSignature={styleSignature}
            />
          </div>
        );
      })}
      
      {isLoading && (
         <div className="space-y-6">
           {pages.length === 0 ? (
             // Initial load - show multiple skeletons
             <>
               <DocumentPageSkeleton />
               <DocumentPageSkeleton />
               <DocumentPageSkeleton />
             </>
           ) : pages[0]?.page_number === 1 || !onLoadFirstPage ? (
             // Loading more at bottom - show one skeleton
             <DocumentPageSkeleton />
           ) : null}
         </div>
      )}
      
      {!hasMore && pages.length > 0 && (
        <div className="text-center py-10 border-t border-gray-100 mt-8" role="status" aria-live="polite">
          <div className="flex flex-col items-center gap-2">
            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-gray-500 text-sm font-medium">
              {t('reader.endReached', 'وصلت إلى نهاية المستند')}
            </p>
            <p className="text-gray-400 text-xs">
              {t('reader.allLoaded', 'تم تحميل جميع الصفحات')}
            </p>
          </div>
        </div>
      )}

      {pages.length === 0 && !isLoading && (
        <div className="text-center py-20 px-4" role="status" aria-live="polite">
          <div className="w-20 h-20 mx-auto mb-6 text-gray-300">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" className="w-full h-full" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">
            {t('reader.noPages', 'لا توجد صفحات لهذا المستند حاليًا')}
          </h2>
          <p className="text-gray-600 mb-2 max-w-md mx-auto">
            {t('reader.noPagesHint', 'قد يكون المستند قيد المعالجة أو حدث خطأ أثناء التحميل.')}
          </p>
          {error && (
            <div className="mb-6 max-w-md mx-auto">
              <ErrorDisplay message={error} onRetry={onRetry} />
            </div>
          )}
          <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
            {onRetry && (
              <button
                onClick={onRetry}
                className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors text-sm font-medium shadow-sm hover:shadow-md"
                aria-label={t('docs.tryAgain', 'إعادة المحاولة')}
              >
                {t('docs.tryAgain', 'إعادة المحاولة')}
              </button>
            )}
            <Link
              href={localizedPath('/documents')}
              className="px-6 py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg transition-colors text-sm font-medium inline-flex items-center gap-2 shadow-sm hover:shadow-md"
              aria-label={t('reader.backToLibrary', 'العودة إلى المكتبة')}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              {t('reader.backToLibrary', 'العودة إلى المكتبة')}
            </Link>
          </div>
        </div>
      )}

      {error && pages.length > 0 && (
        <div className="mb-6">
          <ErrorDisplay message={error} onRetry={onRetry} />
        </div>
      )}
    </div>
  );
}
