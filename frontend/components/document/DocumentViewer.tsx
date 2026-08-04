import React, { useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { DocumentPage as DocumentPageType } from '@/lib/api';
import type { ApiHighlight } from '@/lib/api/reader';
import type { PageMention, EntityType } from '@/lib/api/extractionMentions';
import DocumentPage from './DocumentPage';
import DocumentPageSkeleton from './DocumentPageSkeleton';
import ErrorDisplay from '@/components/ErrorDisplay';
import { useI18n } from '@/components/i18n/I18nProvider';
import { useLocalizedPath } from '@/lib/i18n/navigation';
import { toLocaleDigits } from '@/lib/utils';
import { suppressSelectionPopover, releaseSelectionPopoverSuppression } from '@/lib/reader/selection';

interface DocumentViewerProps {
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
  /** Chapter title shown at the top of the parchment sheet (Reem Kufi). */
  sheetTitle?: string | null;
  /** Small eyebrow above the sheet title (e.g. the chapter's section). */
  sheetEyebrow?: string | null;
  /** Book title shown in the sheet footer. */
  bookTitle?: string;
  /** Double-click a word in the text → search it. */
  onWordSearch?: (word: string) => void;
  /** Hide the volume part of printed-edition page labels (single-volume works). */
  singleVolume?: boolean;
  /** Entity mentions by page number (overlay mode). Absent or empty = no overlay. */
  entityMentions?: Map<number, PageMention[]>;
  /** Returns a localized label for the entity type (passed through to DocumentPage). */
  getEntityLabel?: (type: EntityType) => string;
}

const WORD_CHAR = /[\p{L}\p{M}ـ]/u;

/** Resolve the whole word under a screen point (for click-to-search). */
function wordAtPoint(x: number, y: number): string | null {
  const doc = window.document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => globalThis.Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  let node: Node | null = null;
  let offset = 0;
  if (doc.caretRangeFromPoint) {
    const r = doc.caretRangeFromPoint(x, y);
    if (r) { node = r.startContainer; offset = r.startOffset; }
  } else if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y);
    if (p) { node = p.offsetNode; offset = p.offset; }
  }
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  const text = node.textContent || '';
  let start = Math.min(offset, text.length);
  let end = start;
  while (start > 0 && WORD_CHAR.test(text[start - 1])) start -= 1;
  while (end < text.length && WORD_CHAR.test(text[end])) end += 1;
  const word = text.slice(start, end).trim();
  return word.length >= 2 ? word : null;
}

export default function DocumentViewer({
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
  sheetTitle,
  sheetEyebrow,
  bookTitle,
  onWordSearch,
  singleVolume = false,
  entityMentions,
  getEntityLabel,
}: DocumentViewerProps) {
  const { t, locale } = useI18n();
  const localizedPath = useLocalizedPath();

  // Double-click a word → search it. The popover is suppressed from the 2nd
  // mousedown (before the browser's native word-selection fires
  // selectionchange), because its debounced timer can run before dblclick does.
  const handleSheetMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!onWordSearch) return;
      if (e.detail === 2) {
        const target = e.target as HTMLElement | null;
        if (target?.closest('a, button, input, textarea, mark[data-hid]')) return;
        suppressSelectionPopover();
      } else if (e.detail > 2) {
        // Triple-click paragraph selection keeps its popover.
        releaseSelectionPopoverSuppression();
      }
    },
    [onWordSearch],
  );

  const handleSheetDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!onWordSearch) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('a, button, input, textarea, mark[data-hid]')) return;
      const sel = window.getSelection();
      const selText = sel?.toString().trim() ?? '';
      // dblclick+drag selects multiple words — that's a real selection for the
      // popover flow, not a word search.
      if (/\s/.test(selText)) {
        releaseSelectionPopoverSuppression();
        return;
      }
      const word = wordAtPoint(e.clientX, e.clientY) ?? (selText.length >= 2 ? selText : null);
      if (!word) return;
      sel?.removeAllRanges(); // don't leave the native word-selection up
      onWordSearch(word);
    },
    [onWordSearch],
  );

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
  
  // Determine text direction based on language
  const textDirection = language === 'ar' ? 'rtl' : 'ltr';

  return (
    <div
      className="px-4 py-8 sm:px-6"
      dir={textDirection}
      style={{ background: 'var(--sheet-area)', minHeight: '100%' }}
    >
      <div
        className="ilm-sheet relative mx-auto"
        style={{
          maxWidth: 720,
          background: 'var(--sheet-bg)',
          border: '1px solid var(--sheet-rule)',
          borderRadius: 4,
          boxShadow: '0 8px 30px rgba(44,38,32,.10)',
          padding: '46px clamp(20px, 5vw, 54px) 40px',
        }}
        onMouseDown={handleSheetMouseDown}
        onDoubleClick={handleSheetDoubleClick}
      >
      {/* Chapter header */}
      {(sheetTitle || sheetEyebrow) && pages.length > 0 && (
        <div className="mb-7 text-center">
          {sheetEyebrow && (
            <div className="text-[12px] font-semibold tracking-[0.16em]" style={{ color: '#b0936a' }}>
              {sheetEyebrow}
            </div>
          )}
          {sheetTitle && (
            <h1 className="rr-title mt-3 text-[clamp(26px,4vw,34px)]" style={{ color: 'var(--sheet-ink)' }}>
              <bdi>{sheetTitle}</bdi>
            </h1>
          )}
          <div className="mt-4 flex items-center justify-center gap-3" aria-hidden>
            <span className="h-px w-12" style={{ background: 'var(--sheet-rule)' }} />
            <svg width="15" height="15" viewBox="0 0 24 24" fill="var(--sheet-orn)">
              <path d="M12 2l1.7 7L21 11l-7.3 2L12 22l-1.7-9L3 11l7.3-2z" />
            </svg>
            <span className="h-px w-12" style={{ background: 'var(--sheet-rule)' }} />
          </div>
        </div>
      )}

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
            <DocumentPage
              pageNumber={page.page_number}
              content={page.content}
              searchQuery={searchQuery}
              language={language}
              tashkeelEnabled={tashkeelEnabled}
              highlights={highlights.filter((h) => h.page_number === page.page_number)}
              printedRef={page.printed_ref}
              singleVolume={singleVolume}
              entityMentions={entityMentions?.get(page.page_number)}
              getEntityLabel={getEntityLabel}
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
        <div className="mt-8 py-6 text-center" role="status" aria-live="polite">
          <div className="flex flex-col items-center gap-1.5" style={{ color: 'var(--rr-ink-3, #9a8b70)' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="var(--sheet-orn)" aria-hidden="true">
              <path d="M12 2l1.7 7L21 11l-7.3 2L12 22l-1.7-9L3 11l7.3-2z" />
            </svg>
            <p className="text-[13px] font-medium" style={{ color: 'var(--rr-ink-2, #6e6354)' }}>
              {t('reader.endReached', 'وصلت إلى نهاية المستند')}
            </p>
            <p className="text-[11.5px]">
              {t('reader.allLoaded', 'تم تحميل جميع الصفحات')}
            </p>
          </div>
        </div>
      )}

      {/* Sheet footer (book name · pages) */}
      {bookTitle && pages.length > 0 && (
        <div
          className="mt-8 flex items-center justify-between pt-4 text-[11.5px]"
          style={{ borderTop: '1px solid var(--sheet-rule)', color: 'var(--rr-ink-4, #b0a487)' }}
        >
          <span className="truncate"><bdi>{bookTitle}</bdi></span>
          {totalPages ? <span>{toLocaleDigits(totalPages, locale)}</span> : null}
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
    </div>
  );
}
