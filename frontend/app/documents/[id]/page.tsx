'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  getDocument,
  getDocumentPages,
  searchInDocument,
  Document,
  DocumentPage as DocumentPageType,
  DocumentSearchResponse,
  DocumentPagesResponse,
} from '@/lib/api';
import { pageCache, requestDeduplicator } from '@/lib/cache';
import DocumentViewer from '@/components/document/DocumentViewer';
import DocumentSidebar from '@/components/document/DocumentSidebar';
import Announcer from '@/components/Announcer';
import '@/styles/print.css';

const PAGE_BATCH_SIZE = 5;
const FONT_SIZE_MIN = 14;
const FONT_SIZE_MAX = 24;
const FONT_SIZE_STEP = 2;
const DEFAULT_FONT_SIZE = 16;

export default function DocumentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const documentId = parseInt(params.id as string);
  const isValidId = !isNaN(documentId) && documentId > 0;

  // Data State
  const [document, setDocument] = useState<Document | null>(null);
  const [pages, setPages] = useState<DocumentPageType[]>([]);
  const [totalPages, setTotalPages] = useState(0);
  
  // View State
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pagesError, setPagesError] = useState<string | null>(null);
  const [currentBatchPage, setCurrentBatchPage] = useState(1);
  const [loadingBatchPage, setLoadingBatchPage] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  const [hasExhaustedRetries, setHasExhaustedRetries] = useState(false);
  
  // Use refs to avoid unnecessary function recreations
  const hasMoreRef = useRef(hasMore);
  const isLoadingMoreRef = useRef(isLoadingMore);
  const scrollRestoreRef = useRef(false); // Track if we're restoring scroll
  const urlUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isUserScrollingRef = useRef(false); // Track if user is actively scrolling
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pagesRef = useRef(pages); // Track latest pages array for use in callbacks
  const retryCountRef = useRef(0); // Track retry count using ref to avoid function recreation
  const hasExhaustedRetriesRef = useRef(false); // Track if retries are exhausted using ref
  const isRetryingRef = useRef(false); // Track if a retry is in progress
  const initialLoadAttemptedRef = useRef(false); // Track if initial load has been attempted
  
  // Update refs when state changes
  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);
  
  useEffect(() => {
    isLoadingMoreRef.current = isLoadingMore;
  }, [isLoadingMore]);
  
  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);
  
  // Current visible page (for sidebar)
  const [visiblePageNum, setVisiblePageNum] = useState(1);
  
  // Page navigation input state
  const [pageInputValue, setPageInputValue] = useState('');
  const [pageInputError, setPageInputError] = useState<string | null>(null);

  // Search State
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<DocumentSearchResponse | null>(null);

  // Sidebar state with localStorage persistence
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(`sidebar_collapsed_${documentId}`);
      return saved !== 'true'; // Default to open if not saved
    }
    return true;
  });

  // Save sidebar state to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(`sidebar_collapsed_${documentId}`, (!isSidebarOpen).toString());
    }
  }, [isSidebarOpen, documentId]);

  // Keyboard shortcut handler (Ctrl/Cmd+B to toggle sidebar)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        setIsSidebarOpen(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Font size state
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);

  // Fetch Metadata
  const fetchDocument = useCallback(async () => {
    try {
      const doc = await getDocument(documentId);
      setDocument(doc);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load document');
    } finally {
      setIsLoading(false);
    }
  }, [documentId]);

  // Fetch Pages Batch with caching and deduplication
  const fetchPagesBatch = useCallback(async (batchPageNum: number, resetArgs: boolean = false, isManualRetry: boolean = false) => {
    // If we've exhausted retries and this is not a manual retry, stop
    if (hasExhaustedRetriesRef.current && !isManualRetry) {
      return;
    }
    
    // Prevent concurrent retries for the same batch
    if (resetArgs && isRetryingRef.current && !isManualRetry) {
      return;
    }
    
    // Track initial load attempt
    if (resetArgs && batchPageNum === 1) {
      initialLoadAttemptedRef.current = true;
    }
    
    // If just loading more and we know there's no more, stop.
    // However, if resetting, we proceed.
    // Use refs to get latest values without causing function recreation
    if ((!resetArgs && !hasMoreRef.current) || (isLoadingMoreRef.current && !resetArgs)) return;
    
    const cacheKey = `doc_${documentId}_batch_${batchPageNum}`;
    
    // Check cache first
    const cached = pageCache.get(documentId, batchPageNum);
    if (cached && cached.pages.length > 0) {
      setTotalPages(cached.total_pages || totalPages);
      
      if (resetArgs) {
        setPages(cached.pages);
      } else {
        setPages(prev => {
          // Avoid duplicates
          const existingPageNumbers = new Set(prev.map(p => p.page_number));
          const newPages = cached.pages.filter(p => !existingPageNumbers.has(p.page_number));
          return [...prev, ...newPages];
        });
      }
      
      // Update hasMore based on cached data
      if (cached.pages.length > 0) {
        const lastPage = cached.pages[cached.pages.length - 1];
        if (cached.total_pages && lastPage.page_number >= cached.total_pages) {
          setHasMore(false);
        } else {
          setHasMore(true);
        }
      }
      
      // Reset retry count on successful load
      setRetryCount(0);
      setHasExhaustedRetries(false);
      
      setCurrentBatchPage(batchPageNum);
      return;
    }
    
    // Use request deduplication to prevent duplicate API calls
    try {
      const response = await requestDeduplicator.getOrCreate(
        cacheKey,
        async () => {
          setIsLoadingMore(true);
          setLoadingBatchPage(batchPageNum);
          setPagesError(null);
          return await getDocumentPages(documentId, batchPageNum, PAGE_BATCH_SIZE);
        }
      );
      
      setTotalPages(response.total_pages);
      
      // Cache the response
      pageCache.set(documentId, batchPageNum, response.pages);
      
      if (resetArgs) {
        setPages(response.pages);
      } else {
        setPages(prev => {
          // Avoid duplicates
          const existingPageNumbers = new Set(prev.map(p => p.page_number));
          const newPages = response.pages.filter(p => !existingPageNumbers.has(p.page_number));
          return [...prev, ...newPages];
        });
      }
      
      // Check if we have more pages
      if (response.pages.length < PAGE_BATCH_SIZE || response.current_page * response.page_size >= response.total_pages) {
         if (response.pages.length > 0) {
            const lastPage = response.pages[response.pages.length - 1];
            if (lastPage.page_number >= response.total_pages) {
               setHasMore(false);
            } else {
               setHasMore(true);
            }
         } else {
            setHasMore(false);
         }
      } else {
        setHasMore(true);
      }
      
      // Reset retry count on successful load with pages
      if (response.pages.length > 0) {
        setRetryCount(0);
        setHasExhaustedRetries(false);
        retryCountRef.current = 0;
        hasExhaustedRetriesRef.current = false;
        isRetryingRef.current = false;
      } else if (resetArgs && !isManualRetry) {
        // Track retries when pages are empty on initial load (only for automatic retries)
        const newRetryCount = retryCountRef.current + 1;
        retryCountRef.current = newRetryCount;
        setRetryCount(newRetryCount);
        
        // If we've hit 3 retries, mark as exhausted and prevent further automatic loads
        if (newRetryCount >= 3) {
          setHasExhaustedRetries(true);
          hasExhaustedRetriesRef.current = true;
          setHasMore(false); // Prevent intersection observer from triggering more loads
        }
        isRetryingRef.current = false;
      } else {
        isRetryingRef.current = false;
      }
      
      setCurrentBatchPage(batchPageNum);

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load pages';
      setPagesError(errorMessage);
      console.error('Error fetching pages:', err);
      
      // Track retries only for empty pages (when resetArgs is true and not manual retry)
      if (resetArgs && !isManualRetry) {
        const newRetryCount = retryCountRef.current + 1;
        retryCountRef.current = newRetryCount;
        setRetryCount(newRetryCount);
        
        // If we've hit 3 retries, mark as exhausted and prevent further automatic loads
        if (newRetryCount >= 3) {
          setHasExhaustedRetries(true);
          hasExhaustedRetriesRef.current = true;
          setHasMore(false); // Prevent intersection observer from triggering more loads
        }
        isRetryingRef.current = false;
      } else {
        isRetryingRef.current = false;
      }
    } finally {
      setIsLoadingMore(false);
      setLoadingBatchPage(null);
    }
  }, [documentId, totalPages]); // Removed hasMore, isLoadingMore, retryCount, hasExhaustedRetries from deps - using refs instead

  // Search Logic with request cancellation
  const searchAbortControllerRef = useRef<AbortController | null>(null);
  
  const performSearch = useCallback(async (query: string) => {
    // Cancel any ongoing search
    if (searchAbortControllerRef.current) {
      searchAbortControllerRef.current.abort();
    }

    if (!query.trim()) {
      setSearchResults(null);
      setIsSearching(false);
      return;
    }

    // Create new abort controller for this search
    const abortController = new AbortController();
    searchAbortControllerRef.current = abortController;

    setIsSearching(true);
    try {
      const results = await searchInDocument(documentId, query, abortController.signal);
      
      // Only update if this request wasn't aborted
      if (!abortController.signal.aborted) {
        setSearchResults(results);
      }
    } catch (err) {
      // Don't update state if request was aborted (this is expected)
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      // Don't update state if request was aborted via signal
      if (abortController.signal.aborted) {
        return;
      }
      console.error('Search error:', err);
      setSearchResults({ matches: [], total_matches: 0, query });
    } finally {
      if (!abortController.signal.aborted) {
        setIsSearching(false);
      }
    }
  }, [documentId]);

  const handleSearch = useCallback((query: string) => {
    performSearch(query);
  }, [performSearch]);
  
  // Update URL with page number (debounced)
  const updateURLPage = useCallback((pageNum: number, replace: boolean = false) => {
    if (urlUpdateTimeoutRef.current) {
      clearTimeout(urlUpdateTimeoutRef.current);
    }
    
    urlUpdateTimeoutRef.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (pageNum === 1) {
        params.delete('page');
      } else {
        params.set('page', pageNum.toString());
      }
      
      const newUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
      if (replace) {
        router.replace(newUrl);
      } else {
        router.push(newUrl);
      }
    }, 300);
  }, [router, searchParams]);

  // Store scroll position
  const storeScrollPosition = useCallback((pageNum: number) => {
    if (typeof window === 'undefined') return;
    const scrollContainer = window.document.getElementById('document-scroll-container');
    if (scrollContainer) {
      const scrollPos = scrollContainer.scrollTop;
      const key = `scroll_${documentId}_${pageNum}`;
      try {
        sessionStorage.setItem(key, scrollPos.toString());
      } catch (err) {
        console.warn('Failed to store scroll position:', err);
      }
    }
  }, [documentId]);

  // Restore scroll position
  const restoreScrollPosition = useCallback((pageNum: number) => {
    if (typeof window === 'undefined') return;
    const key = `scroll_${documentId}_${pageNum}`;
    try {
      const stored = sessionStorage.getItem(key);
      if (stored) {
        const scrollPos = parseInt(stored, 10);
        scrollRestoreRef.current = true;
        const scrollContainer = window.document.getElementById('document-scroll-container');
        if (scrollContainer) {
          setTimeout(() => {
            scrollContainer.scrollTop = scrollPos;
            scrollRestoreRef.current = false;
          }, 100);
        }
      }
    } catch (err) {
      console.warn('Failed to restore scroll position:', err);
    }
  }, [documentId]);

  // Jump to specific page with caching support
  const handleGoToPage = useCallback(async (pageNumber: number, updateURL: boolean = true) => {
    if (!pageNumber || Number.isNaN(pageNumber)) {
      return;
    }

    // Store current scroll position before navigation
    if (visiblePageNum !== pageNumber) {
      storeScrollPosition(visiblePageNum);
    }

    // Update URL immediately (synchronously) when navigating via go-to box
    if (updateURL) {
      // Clear any pending URL updates
      if (urlUpdateTimeoutRef.current) {
        clearTimeout(urlUpdateTimeoutRef.current);
        urlUpdateTimeoutRef.current = null;
      }
      
      // Update URL immediately for go-to navigation
      const params = new URLSearchParams(searchParams.toString());
      if (pageNumber === 1) {
        params.delete('page');
      } else {
        params.set('page', pageNumber.toString());
      }
      
      const newUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
      router.replace(newUrl);
    }

    // Optimistically update visible page number
    setVisiblePageNum(pageNumber);
    
    // Show loading immediately
    setIsLoadingMore(true);
    setPagesError(null);

    // Check if page is already loaded
    const existingPage = pages.find(p => p.page_number === pageNumber);
    if (existingPage) {
      // Scroll to it only if not user scrolling
      setIsLoadingMore(false);
      if (!isUserScrollingRef.current) {
        // Use requestAnimationFrame to ensure DOM is ready
        requestAnimationFrame(() => {
          setTimeout(() => {
            const el = window.document.querySelector(`[data-page="${pageNumber}"]`);
            if (el) {
              if (scrollRestoreRef.current) {
                // If restoring scroll, use auto behavior
                el.scrollIntoView({ behavior: 'auto' });
              } else {
                el.scrollIntoView({ behavior: 'smooth' });
              }
              // Focus the page element for accessibility
              (el as HTMLElement).focus();
            }
          }, 50);
        });
      }
      return;
    }
    
    // Load batch containing this page
    const targetBatch = Math.ceil(pageNumber / PAGE_BATCH_SIZE);
    const cacheKey = `doc_${documentId}_batch_${targetBatch}`;
    
    // Check cache first
    const cached = pageCache.get(documentId, targetBatch);
    if (cached && cached.pages.length > 0) {
      setPages(cached.pages);
      setTotalPages(cached.total_pages || totalPages);
      setCurrentBatchPage(targetBatch);
      
      if (cached.pages.length > 0) {
        const lastPage = cached.pages[cached.pages.length - 1];
        if (cached.total_pages && lastPage.page_number >= cached.total_pages) {
          setHasMore(false);
        } else {
          setHasMore(true);
        }
      }
      
      setIsLoadingMore(false);
      
      // Only scroll if user is not actively scrolling
      if (!isUserScrollingRef.current) {
        // Use requestAnimationFrame and longer timeout to ensure DOM is updated
        requestAnimationFrame(() => {
          setTimeout(() => {
            const el = window.document.querySelector(`[data-page="${pageNumber}"]`);
            if (el) {
              if (scrollRestoreRef.current) {
                restoreScrollPosition(pageNumber);
              } else {
                el.scrollIntoView({ behavior: 'smooth' });
              }
              (el as HTMLElement).focus();
            } else {
              // If element not found, try again after a longer delay
              setTimeout(() => {
                const el = window.document.querySelector(`[data-page="${pageNumber}"]`);
                if (el) {
                  el.scrollIntoView({ behavior: 'smooth' });
                  (el as HTMLElement).focus();
                }
              }, 200);
            }
          }, 100);
        });
      }
      return;
    }
    
    // Use request deduplication
    try {
      const response = await requestDeduplicator.getOrCreate(
        cacheKey,
        async () => {
          setLoadingBatchPage(targetBatch);
          return await getDocumentPages(documentId, targetBatch, PAGE_BATCH_SIZE);
        }
      );
      
      // Cache the response
      pageCache.set(documentId, targetBatch, response.pages);
      
      setPages(response.pages);
      setTotalPages(response.total_pages);
      setCurrentBatchPage(targetBatch);
      
      if (response.pages.length > 0) {
         const lastPage = response.pages[response.pages.length - 1];
         if (lastPage.page_number >= response.total_pages) {
            setHasMore(false);
         } else {
            setHasMore(true);
         }
      } else {
         setHasMore(false);
      }

      setIsLoadingMore(false);
      setLoadingBatchPage(null);

      // Only scroll if user is not actively scrolling
      if (!isUserScrollingRef.current) {
        // Use requestAnimationFrame and longer timeout to ensure DOM is updated
        requestAnimationFrame(() => {
          setTimeout(() => {
            const el = window.document.querySelector(`[data-page="${pageNumber}"]`);
            if (el) {
              if (scrollRestoreRef.current) {
                restoreScrollPosition(pageNumber);
              } else {
                el.scrollIntoView({ behavior: 'smooth' });
              }
              (el as HTMLElement).focus();
            } else {
              // If element not found, try again after a longer delay
              setTimeout(() => {
                const el = window.document.querySelector(`[data-page="${pageNumber}"]`);
                if (el) {
                  el.scrollIntoView({ behavior: 'smooth' });
                  (el as HTMLElement).focus();
                }
              }, 200);
            }
          }, 100);
        });
      }

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to jump to page';
      setPagesError(errorMessage);
      setIsLoadingMore(false);
      setLoadingBatchPage(null);
      console.error("Failed to jump to page", err);
    }
  }, [pages, documentId, visiblePageNum, totalPages, storeScrollPosition, restoreScrollPosition, searchParams, router]);

  const handleLoadMore = useCallback(() => {
    // Don't load more if retries are exhausted and pages are empty
    if (hasExhaustedRetriesRef.current && pagesRef.current.length === 0) {
      return;
    }
    fetchPagesBatch(currentBatchPage + 1);
  }, [fetchPagesBatch, currentBatchPage]);

  const handleRetryPages = useCallback(() => {
    setPagesError(null);
    // Reset retry count for manual retries
    setRetryCount(0);
    setHasExhaustedRetries(false);
    retryCountRef.current = 0;
    hasExhaustedRetriesRef.current = false;
    isRetryingRef.current = false;
    if (pages.length === 0) {
      fetchPagesBatch(1, true, true); // true = isManualRetry
    } else {
      fetchPagesBatch(currentBatchPage, false, true); // true = isManualRetry
    }
  }, [fetchPagesBatch, currentBatchPage, pages.length]);

  // Handle load previous batch when scrolling to top.
  // Loads ONE batch at a time (immediately before the lowest loaded page).
  // The scroll observer in DocumentViewer re-triggers this for each subsequent batch.
  const handleLoadFirstPage = useCallback(async () => {
    // Don't load if retries are exhausted and pages are empty
    if (hasExhaustedRetriesRef.current && pagesRef.current.length === 0) {
      return;
    }
    
    // Use pagesRef to get latest pages state
    const currentPages = pagesRef.current;
    
    // Check if page 1 is already loaded
    const hasFirstPage = currentPages.some(p => p.page_number === 1);
    if (hasFirstPage) {
      return;
    }
    
    // If no pages are loaded, we can't load a "previous" batch.
    if (currentPages.length === 0) return;

    // Find the lowest page number currently loaded
    const lowestPage = Math.min(...currentPages.map(p => p.page_number));
    if (lowestPage <= 1) return;
    
    // Calculate the batch immediately before the lowest loaded page
    const lowestBatch = Math.ceil(lowestPage / PAGE_BATCH_SIZE);
    const targetBatch = lowestBatch - 1;
    if (targetBatch < 1) return;
    
    const cacheKey = `doc_${documentId}_batch_${targetBatch}`;
    
    // Check cache first
    const cached = pageCache.get(documentId, targetBatch);
    if (cached && cached.pages.length > 0) {
      setTotalPages(cached.total_pages || totalPages);
      
      // Merge pages, avoiding duplicates, maintaining sorted order
      setPages(prev => {
        const existingPageNumbers = new Set(prev.map(p => p.page_number));
        const newPages = cached.pages.filter(p => !existingPageNumbers.has(p.page_number));
        if (newPages.length === 0) return prev;
        const combined = [...newPages, ...prev];
        combined.sort((a, b) => a.page_number - b.page_number);
        return combined;
      });
      return;
    }
    
    // Fetch from API
    try {
      setIsLoadingMore(true);
      setLoadingBatchPage(targetBatch);
      setPagesError(null);
      
      const response = await requestDeduplicator.getOrCreate(
        cacheKey,
        async () => {
          return await getDocumentPages(documentId, targetBatch, PAGE_BATCH_SIZE);
        }
      );
      
      setTotalPages(response.total_pages);
      pageCache.set(documentId, targetBatch, response.pages);
      
      // Merge pages, avoiding duplicates, maintaining sorted order
      setPages(prev => {
        const existingPageNumbers = new Set(prev.map(p => p.page_number));
        const newPages = response.pages.filter(p => !existingPageNumbers.has(p.page_number));
        const combined = [...newPages, ...prev];
        combined.sort((a, b) => a.page_number - b.page_number);
        return combined;
      });

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load pages';
      setPagesError(errorMessage);
      console.error('Error fetching previous batch:', err);
    } finally {
      setIsLoadingMore(false);
      setLoadingBatchPage(null);
    }
  }, [documentId, totalPages]);

  // Handle page number input navigation
  const handlePageInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPageInputError(null);
    
    const pageNum = parseInt(pageInputValue.trim());
    
    if (isNaN(pageNum)) {
      setPageInputError('Please enter a valid page number');
      return;
    }
    
    if (pageNum < 1) {
      setPageInputError('Page number must be at least 1');
      return;
    }
    
    if (totalPages > 0 && pageNum > totalPages) {
      setPageInputError(`Page must be between 1 and ${totalPages}`);
      return;
    }
    
    // If totalPages is 0, document is still loading, but we can still attempt navigation
    // The handleGoToPage function will handle loading the appropriate batch
    handleGoToPage(pageNum);
    setPageInputValue('');
  };

  const handlePageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPageInputValue(e.target.value);
    setPageInputError(null);
  };

  // Print handler
  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  // Share handler
  const handleShare = useCallback(async () => {
    const url = `${window.location.origin}${window.location.pathname}${window.location.search}#page=${visiblePageNum}`;
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: document?.title || 'Document',
          text: `Check out page ${visiblePageNum} of ${document?.title || 'this document'}`,
          url: url,
        });
      } catch (err) {
        // User cancelled or error occurred
        if ((err as Error).name !== 'AbortError') {
          console.error('Error sharing:', err);
        }
      }
    } else {
      // Fallback to copy to clipboard
      try {
        await navigator.clipboard.writeText(url);
        // Show a brief notification (you could use a toast library here)
        alert('Page URL copied to clipboard!');
      } catch (err) {
        console.error('Failed to copy URL:', err);
        alert('Failed to copy URL. Please copy it manually from the address bar.');
      }
    }
  }, [visiblePageNum, document]);

  // Cleanup scroll timeout on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  // Font size handlers
  const increaseFontSize = useCallback(() => {
    setFontSize(prev => {
      const newSize = Math.min(prev + FONT_SIZE_STEP, FONT_SIZE_MAX);
      try {
        localStorage.setItem(`doc_${documentId}_fontSize`, newSize.toString());
      } catch (err) {
        console.warn('Failed to save font size:', err);
      }
      return newSize;
    });
  }, [documentId]);

  const decreaseFontSize = useCallback(() => {
    setFontSize(prev => {
      const newSize = Math.max(prev - FONT_SIZE_STEP, FONT_SIZE_MIN);
      try {
        localStorage.setItem(`doc_${documentId}_fontSize`, newSize.toString());
      } catch (err) {
        console.warn('Failed to save font size:', err);
      }
      return newSize;
    });
  }, [documentId]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle keys when user is typing in inputs/textarea
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      if (typeof window === 'undefined') return;
      const scrollContainer = window.document.getElementById('document-scroll-container');
      if (!scrollContainer) return;

      switch (e.key) {
        case 'ArrowUp':
        case 'PageUp':
          e.preventDefault();
          scrollContainer.scrollBy({ top: -window.innerHeight * 0.9, behavior: 'smooth' });
          break;
        case 'ArrowDown':
        case 'PageDown':
          e.preventDefault();
          scrollContainer.scrollBy({ top: window.innerHeight * 0.9, behavior: 'smooth' });
          break;
        case 'Home':
          e.preventDefault();
          handleGoToPage(1);
          break;
        case 'End':
          e.preventDefault();
          if (totalPages > 0) {
            handleGoToPage(totalPages);
          }
          break;
        case 'Escape':
          e.preventDefault();
          setIsSidebarOpen(prev => !prev);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [totalPages, handleGoToPage]);

  // Load font size from localStorage on mount
  useEffect(() => {
    if (documentId) {
      try {
        const saved = localStorage.getItem(`doc_${documentId}_fontSize`);
        if (saved) {
          const size = parseInt(saved, 10);
          if (size >= FONT_SIZE_MIN && size <= FONT_SIZE_MAX) {
            setFontSize(size);
          }
        }
      } catch (err) {
        console.warn('Failed to load font size:', err);
      }
    }
  }, [documentId]);

  // Sync visiblePageNum with URL param
  useEffect(() => {
    const pageParam = searchParams.get('page');
    if (pageParam) {
      const pageNum = parseInt(pageParam, 10);
      if (!isNaN(pageNum) && pageNum > 0 && pageNum !== visiblePageNum && totalPages > 0 && pageNum <= totalPages) {
        // Only navigate if page is different and document is loaded
        if (document && totalPages > 0) {
          handleGoToPage(pageNum, false);
        }
      }
    }
  }, [searchParams, document, totalPages]); // Note: intentionally not including visiblePageNum and handleGoToPage to avoid loops

  // Update URL when visiblePageNum changes (debounced)
  useEffect(() => {
    if (document && totalPages > 0 && visiblePageNum > 0) {
      updateURLPage(visiblePageNum, true);
    }
  }, [visiblePageNum, document, totalPages, updateURLPage]);

  // Handle browser back/forward navigation
  useEffect(() => {
    const handlePopState = () => {
      const pageParam = searchParams.get('page');
      if (pageParam) {
        const pageNum = parseInt(pageParam, 10);
        if (!isNaN(pageNum) && pageNum > 0 && totalPages > 0 && pageNum <= totalPages) {
          handleGoToPage(pageNum, false);
          restoreScrollPosition(pageNum);
        }
      } else if (visiblePageNum !== 1) {
        handleGoToPage(1, false);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [searchParams, totalPages, visiblePageNum, handleGoToPage, restoreScrollPosition]);

  // Reset retry state when documentId changes
  useEffect(() => {
    setRetryCount(0);
    setHasExhaustedRetries(false);
    retryCountRef.current = 0;
    hasExhaustedRetriesRef.current = false;
    isRetryingRef.current = false;
    initialLoadAttemptedRef.current = false;
  }, [documentId]);
  
  // Update refs when state changes
  useEffect(() => {
    retryCountRef.current = retryCount;
  }, [retryCount]);
  
  useEffect(() => {
    hasExhaustedRetriesRef.current = hasExhaustedRetries;
  }, [hasExhaustedRetries]);

  // Initial Load - only run when documentId changes
  useEffect(() => {
    if (!isValidId) {
      setError('Invalid document ID. Please check the URL and try again.');
      setIsLoading(false);
      return;
    }
    
    // Prevent duplicate initial loads if already attempted and retries exhausted
    if (initialLoadAttemptedRef.current && hasExhaustedRetriesRef.current) {
      return;
    }
    
    // Check for page param in URL
    const pageParam = searchParams.get('page');
    const initialPage = pageParam ? parseInt(pageParam, 10) : 1;
    
    fetchDocument();
    
    // If page param exists and is valid, load that page, otherwise start at page 1
    if (pageParam && !isNaN(initialPage) && initialPage > 0) {
      const targetBatch = Math.ceil(initialPage / PAGE_BATCH_SIZE);
      fetchPagesBatch(targetBatch, true).then(() => {
        // After pages load, navigate to the page (only if not user scrolling)
        if (!isUserScrollingRef.current) {
          setTimeout(() => {
            const el = window.document.querySelector(`[data-page="${initialPage}"]`);
            if (el) {
              el.scrollIntoView({ behavior: 'auto' });
              setVisiblePageNum(initialPage);
            } else {
              setVisiblePageNum(initialPage);
            }
          }, 100);
        } else {
          setVisiblePageNum(initialPage);
        }
      });
    } else {
      fetchPagesBatch(1, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, isValidId]);

  if (isLoading || !document) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="flex flex-col items-center">
          <div className="w-10 h-10 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-gray-500">Loading document...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="flex flex-col items-center text-center px-4 max-w-md">
          <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Error Loading Document</h3>
          <p className="text-gray-600 dark:text-gray-400 mb-6">{error}</p>
          <Link
            href="/documents"
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors inline-flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to Library
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-gray-100 dark:bg-gray-900 overflow-hidden" style={{ '--document-font-size': `${fontSize}px` } as React.CSSProperties}>
      {/* Top Bar - Fixed, always visible, below navbar */}
      <div className="fixed top-20 left-0 right-0 z-40 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-3 flex items-center justify-between shadow-sm">
           <Link
              href="/documents"
              className="inline-flex items-center gap-2 text-gray-600 dark:text-gray-300 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors text-sm font-medium"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Library
            </Link>
            
            <h1 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate max-w-md mx-4">
              {document.title}
            </h1>
            
            <div className="flex items-center gap-3">
               {/* Loading progress indicator */}
               {isLoadingMore && loadingBatchPage !== null && totalPages > 0 && (
                 <>
                   <span className="text-xs text-gray-500 bg-indigo-50 dark:bg-indigo-900/20 px-2 py-1 rounded-md">
                     Loading page {Math.min((loadingBatchPage - 1) * PAGE_BATCH_SIZE + 1, totalPages)} of {totalPages}
                   </span>
                   <div className="h-4 w-px bg-gray-300 dark:bg-gray-600"></div>
                 </>
               )}
               
               <span 
                 className="text-xs text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded-md"
                 aria-label={`Page ${visiblePageNum} of ${totalPages}`}
               >
                 Page {visiblePageNum} of {totalPages}
               </span>
               <div className="h-4 w-px bg-gray-300 dark:bg-gray-600"></div>
               
               {/* Font size controls */}
               <div className="flex items-center gap-1 border border-gray-300 dark:border-gray-600 rounded-md">
                 <button
                   onClick={decreaseFontSize}
                   disabled={fontSize <= FONT_SIZE_MIN}
                   className="px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                   title="Decrease font size"
                 >
                   <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                   </svg>
                 </button>
                 <span className="px-2 py-1 text-xs text-gray-600 dark:text-gray-300 min-w-[2rem] text-center">
                   {fontSize}px
                 </span>
                 <button
                   onClick={increaseFontSize}
                   disabled={fontSize >= FONT_SIZE_MAX}
                   className="px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                   title="Increase font size"
                 >
                   <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                   </svg>
                 </button>
               </div>
               <div className="h-4 w-px bg-gray-300 dark:bg-gray-600"></div>
               
               <form onSubmit={handlePageInputSubmit} className="flex items-center gap-2">
                 <div className="relative flex items-center">
                   <label htmlFor="page-input" className="sr-only">Go to page number</label>
                   <div className="relative">
                     <input
                       id="page-input"
                       type="number"
                       min="1"
                       {...(totalPages > 0 ? { max: totalPages } : {})}
                       value={pageInputValue}
                       onChange={handlePageInputChange}
                       placeholder="Page #"
                       aria-label="Go to page number"
                       aria-describedby={pageInputError ? 'page-input-error' : undefined}
                       disabled={isLoadingMore}
                       className={`w-20 px-3 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 transition-all ${
                         pageInputError
                           ? 'border-red-500 focus:ring-red-500 dark:border-red-400 bg-red-50 dark:bg-red-900/20'
                           : 'border-gray-300 dark:border-gray-600 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white focus:border-indigo-500 dark:focus:border-indigo-400'
                       } ${isLoadingMore ? 'opacity-50 cursor-not-allowed' : ''}`}
                     />
                     {pageInputError && (
                       <div 
                         id="page-input-error"
                         role="alert"
                         className="absolute top-full left-0 mt-1.5 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 bg-white dark:bg-gray-800 border border-red-300 dark:border-red-600 rounded-lg shadow-lg z-50 whitespace-nowrap"
                       >
                         {pageInputError}
                       </div>
                     )}
                   </div>
                 </div>
                 <button
                   type="submit"
                   aria-label="Go to page"
                   disabled={isLoadingMore || !pageInputValue.trim()}
                   className="px-4 py-1.5 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 flex items-center gap-1.5 min-w-[3rem] justify-center"
                 >
                   {isLoadingMore ? (
                     <>
                       <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                       </svg>
                       <span>Go</span>
                     </>
                   ) : (
                     'Go'
                   )}
                 </button>
               </form>
               <div className="h-4 w-px bg-gray-300 dark:bg-gray-600"></div>
               
               {/* Print button */}
               <button
                 onClick={handlePrint}
                 className="p-1.5 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors no-print"
                 aria-label="Print document"
                 title="Print document"
               >
                 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                 </svg>
               </button>
               
               {/* Share button */}
               <button
                 onClick={handleShare}
                 className="p-1.5 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors no-print"
                 aria-label="Share page"
                 title="Share current page"
               >
                 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                 </svg>
               </button>
               
               <div className="h-4 w-px bg-gray-300 dark:bg-gray-600"></div>
               
               {/* Sidebar toggle button */}
               <button
                 onClick={() => setIsSidebarOpen(prev => !prev)}
                 className="p-1.5 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors no-print"
                 aria-label={isSidebarOpen ? 'Close sidebar' : 'Open sidebar'}
                 title={isSidebarOpen ? 'Close sidebar (Ctrl+B)' : 'Open sidebar (Ctrl+B)'}
               >
                 {isSidebarOpen ? (
                   <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                   </svg>
                 ) : (
                   <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                   </svg>
                 )}
               </button>
               
               <div className="h-4 w-px bg-gray-300 dark:bg-gray-600"></div>
               <div className="flex items-center text-xs text-gray-400">
                  Read Only
               </div>
            </div>
      </div>

      {/* Main Content (Viewer) */}
      <main 
        id="document-scroll-container"
        className="h-screen overflow-y-auto relative bg-gray-100 dark:bg-gray-900 pt-[137px]" 
        role="main"
        aria-label="Document viewer"
        onScroll={() => {
          // Mark that user is actively scrolling
          isUserScrollingRef.current = true;
          // Clear any pending scroll operations
          if (scrollTimeoutRef.current) {
            clearTimeout(scrollTimeoutRef.current);
          }
          // Reset flag after scroll stops
          scrollTimeoutRef.current = setTimeout(() => {
            isUserScrollingRef.current = false;
          }, 150);
        }}
      >
        <DocumentViewer
          pages={pages}
          isLoading={isLoadingMore}
          hasMore={hasMore}
          searchQuery={searchResults?.query || ''}
          onLoadMore={handleLoadMore}
          onPageVisible={setVisiblePageNum}
          onLoadFirstPage={handleLoadFirstPage}
          language={document.language}
          error={pagesError}
          onRetry={handleRetryPages}
          loadingBatchPage={loadingBatchPage}
          totalPages={totalPages}
        />
        
      </main>

      {/* Sidebar - Overlay Mode */}
      {isSidebarOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50 z-30 transition-opacity"
            onClick={() => setIsSidebarOpen(false)}
            aria-hidden="true"
          />
          {/* Sidebar */}
          <div className={`fixed top-20 right-0 h-[calc(100vh-5rem)] w-80 md:w-96 z-40 transform transition-transform duration-300 ease-in-out ${
            isSidebarOpen ? 'translate-x-0' : 'translate-x-full'
          }`}>
            <DocumentSidebar
              document={document}
              currentPage={visiblePageNum}
              searchResults={searchResults}
              isSearching={isSearching}
              onSearch={handleSearch}
              onGoToPage={handleGoToPage}
              isOpen={isSidebarOpen}
            />
          </div>
        </>
      )}
    </div>
  );
}
