import React, { useEffect, useState, useRef } from 'react';

interface ReadingProgressProps {
  currentPage: number;
  totalPages: number;
  documentId: number;
  scrollContainerId?: string;
}

export default function ReadingProgress({ currentPage, totalPages, documentId, scrollContainerId = 'document-scroll-container' }: ReadingProgressProps) {
  const [progress, setProgress] = useState(0);
  const rafRef = useRef<number | null>(null);
  const lastUpdateRef = useRef<number>(0);

  // Calculate progress based on current page and scroll position within that page
  const calculateProgress = () => {
    if (typeof window === 'undefined' || totalPages === 0 || currentPage === 0) return 0;
    
    const scrollContainer = document.getElementById(scrollContainerId);
    if (!scrollContainer) return 0;

    // Find the current page element
    const currentPageElement = document.querySelector(`[data-page="${currentPage}"]`) as HTMLElement;
    if (!currentPageElement) {
      // Fallback: calculate based on page number only
      return ((currentPage - 1) / totalPages) * 100;
    }

    const scrollTop = scrollContainer.scrollTop;
    const containerRect = scrollContainer.getBoundingClientRect();
    const pageRect = currentPageElement.getBoundingClientRect();
    
    // Calculate the page's top position relative to the scroll container's content
    // getBoundingClientRect gives viewport-relative positions, so we need to account for scroll
    const pageTopInContainer = pageRect.top - containerRect.top + scrollTop;
    
    // Calculate how far we've scrolled into the current page
    const scrollPositionInPage = scrollTop - pageTopInContainer;
    
    // Get the height of the current page
    const pageHeight = currentPageElement.offsetHeight || pageRect.height;
    
    // Calculate progress within the current page (0 to 1)
    // If we're before the page, progress is 0; if we're past it, progress is 1
    const progressInPage = Math.max(0, Math.min(1, scrollPositionInPage / pageHeight));
    
    // Calculate base progress from completed pages
    // (currentPage - 1) because if we're on page 1, we've completed 0 pages
    const baseProgress = ((currentPage - 1) / totalPages) * 100;
    
    // Add progress within the current page
    // Each page represents (1 / totalPages) of total progress
    const progressInCurrentPage = (progressInPage / totalPages) * 100;
    
    const calculatedProgress = baseProgress + progressInCurrentPage;
    return Math.min(100, Math.max(0, calculatedProgress));
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const scrollContainer = document.getElementById(scrollContainerId);
    if (!scrollContainer) return;

    // Throttled scroll handler using requestAnimationFrame
    const handleScroll = () => {
      const now = Date.now();
      // Throttle to ~60fps (16ms)
      if (now - lastUpdateRef.current < 16) {
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
        }
        rafRef.current = requestAnimationFrame(() => {
          const newProgress = calculateProgress();
          setProgress(newProgress);
          lastUpdateRef.current = Date.now();
        });
        return;
      }

      const newProgress = calculateProgress();
      setProgress(newProgress);
      lastUpdateRef.current = now;
    };

    // Initial calculation
    const initialProgress = calculateProgress();
    setProgress(initialProgress);

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
    
    // Also listen for resize events to recalculate when container size changes
    const handleResize = () => {
      const newProgress = calculateProgress();
      setProgress(newProgress);
    };
    window.addEventListener('resize', handleResize, { passive: true });

    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [scrollContainerId, currentPage, totalPages]); // Recalculate when page changes

  // Save reading position to localStorage when progress changes significantly
  useEffect(() => {
    if (totalPages > 0 && currentPage > 0 && progress > 0) {
      try {
        localStorage.setItem(`reading_progress_${documentId}`, JSON.stringify({
          page: currentPage,
          progress: progress,
          timestamp: Date.now()
        }));
      } catch (err) {
        // Ignore localStorage errors (e.g., in private browsing)
        console.warn('Failed to save reading progress:', err);
      }
    }
  }, [currentPage, totalPages, documentId, progress]);

  if (totalPages === 0) {
    return null;
  }

  return (
    <div className="sticky top-0 z-10 bg-white/90 dark:bg-gray-800/90 backdrop-blur-md border-b border-gray-200 dark:border-gray-700">
      <div className="max-w-4xl mx-auto px-4 py-2">
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden relative">
            <div
              className="h-full bg-indigo-600 dark:bg-indigo-500 transition-all duration-300 ease-out"
              style={{ width: `${progress}%` }}
              role="progressbar"
              aria-valuenow={Math.round(progress)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Reading progress: ${Math.round(progress)}%`}
            />
            {/* Visual reading position indicator */}
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-indigo-600 dark:bg-indigo-500 rounded-full border-2 border-white dark:border-gray-800 shadow-sm transition-all duration-300 ease-out"
              style={{ left: `calc(${progress}% - 6px)` }}
              title={`Page ${currentPage} of ${totalPages}`}
            />
          </div>
          <span className="text-xs font-medium text-gray-600 dark:text-gray-400 min-w-[60px] text-right">
            {Math.round(progress)}%
          </span>
        </div>
      </div>
    </div>
  );
}
