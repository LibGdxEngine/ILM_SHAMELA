'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getDocument,
  getDocumentPages,
  searchInDocument,
  Document,
  DocumentPage as DocumentPageType,
  DocumentSearchResponse,
} from '@/lib/api';
import DocumentViewer from '@/components/document/DocumentViewer';
import DocumentSidebar from '@/components/document/DocumentSidebar';

const PAGE_BATCH_SIZE = 5;

export default function DocumentDetailPage() {
  const params = useParams();
  const documentId = parseInt(params.id as string);

  // Data State
  const [document, setDocument] = useState<Document | null>(null);
  const [pages, setPages] = useState<DocumentPageType[]>([]);
  const [totalPages, setTotalPages] = useState(0);
  
  // View State
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentBatchPage, setCurrentBatchPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  
  // Use refs to avoid unnecessary function recreations
  const hasMoreRef = useRef(hasMore);
  const isLoadingMoreRef = useRef(isLoadingMore);
  const isFetchingRef = useRef(false); // Track if a request is in-flight
  
  // Update refs when state changes
  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);
  
  useEffect(() => {
    isLoadingMoreRef.current = isLoadingMore;
  }, [isLoadingMore]);
  
  // Current visible page (for sidebar)
  const [visiblePageNum, setVisiblePageNum] = useState(1);
  
  // Page navigation input state
  const [pageInputValue, setPageInputValue] = useState('');
  const [pageInputError, setPageInputError] = useState<string | null>(null);

  // Search State
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<DocumentSearchResponse | null>(null);

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

  // Fetch Pages Batch
  const fetchPagesBatch = useCallback(async (batchPageNum: number, resetArgs: boolean = false) => {
    // Prevent concurrent requests - if already fetching, return early
    if (isFetchingRef.current) {
      return;
    }
    
    // If just loading more and we know there's no more, stop.
    // However, if resetting, we proceed.
    // Use refs to get latest values without causing function recreation
    if ((!resetArgs && !hasMoreRef.current) || (isLoadingMoreRef.current && !resetArgs)) return;
    
    // Mark as fetching
    isFetchingRef.current = true;
    setIsLoadingMore(true);
    
    try {
      const response = await getDocumentPages(documentId, batchPageNum, PAGE_BATCH_SIZE);
      
      setTotalPages(response.total_pages);
      
      if (resetArgs) {
        setPages(response.pages);
      } else {
        setPages(prev => [...prev, ...response.pages]);
      }
      
      // Check if we have more pages
      // If the batch returned fewer items than requested, we reached the end.
      // Also check if the last page loaded is the last page available.
      if (response.pages.length < PAGE_BATCH_SIZE || response.current_page * response.page_size >= response.total_pages) {
         // Note: response.current_page from API might be the batch index if implemented that way, 
         // let's rely on checking if we have loaded all total_pages.
         // response.pages returns actual pages.
         // Let's check the last page number in the response.
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
      
      setCurrentBatchPage(batchPageNum);

    } catch (err) {
      console.error('Error fetching pages:', err);
    } finally {
      setIsLoadingMore(false);
      isFetchingRef.current = false; // Clear fetching flag
    }
  }, [documentId]); // Removed hasMore and isLoadingMore from deps - using refs instead

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
  
  // Jump to specific page
  const handleGoToPage = async (pageNumber: number) => {
    if (!pageNumber || Number.isNaN(pageNumber)) {
      return;
    }

    // Check if page is already loaded
    const existingPage = pages.find(p => p.page_number === pageNumber);
    if (existingPage) {
      // Scroll to it
      const el = window.document.querySelector(`[data-page="${pageNumber}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth' });
        setVisiblePageNum(pageNumber);
      }
    } else {
      // Prevent concurrent requests
      if (isFetchingRef.current) {
        return;
      }
      
      // Load batch containing this page
      const targetBatch = Math.ceil(pageNumber / PAGE_BATCH_SIZE);
      
      setPages([]);
      isFetchingRef.current = true;
      setIsLoadingMore(true);
      
      try {
        const response = await getDocumentPages(documentId, targetBatch, PAGE_BATCH_SIZE);
        setPages(response.pages);
        setTotalPages(response.total_pages);
        setCurrentBatchPage(targetBatch);
        setVisiblePageNum(pageNumber);
        
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

        setTimeout(() => {
          const el = window.document.querySelector(`[data-page="${pageNumber}"]`);
          if (el) el.scrollIntoView({ behavior: 'auto' });
        }, 100);

      } catch (err) {
        console.error("Failed to jump to page", err);
      } finally {
        setIsLoadingMore(false);
        isFetchingRef.current = false;
      }
    }
  };

  const handleLoadMore = useCallback(() => {
    fetchPagesBatch(currentBatchPage + 1);
  }, [fetchPagesBatch, currentBatchPage]);

  // Handle load first page when scrolling to top
  // const handleLoadFirstPage = useCallback(() => {
  //   // Check if page 1 is already loaded
  //   const hasFirstPage = pages.some(p => p.page_number === 1);
  //   if (hasFirstPage || isLoadingMore) {
  //     return;
  //   }
    
  //   // Load first batch
  //   fetchPagesBatch(1, true);
  // }, [pages, isLoadingMore, fetchPagesBatch]);

  // Handle page number input navigation
  const handlePageInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPageInputError(null);
    
    const pageNum = parseInt(pageInputValue.trim());
    
    if (isNaN(pageNum)) {
      setPageInputError('Please enter a valid page number');
      return;
    }
    
    if (pageNum < 1 || (totalPages > 0 && pageNum > totalPages)) {
      setPageInputError(`Page must be between 1 and ${totalPages}`);
      return;
    }
    
    handleGoToPage(pageNum);
    setPageInputValue('');
  };

  const handlePageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPageInputValue(e.target.value);
    setPageInputError(null);
  };

  // Initial Load - only run when documentId changes
  useEffect(() => {
    fetchDocument();
    // Start fresh
    fetchPagesBatch(1, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

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
      <div className="min-h-screen flex items-center justify-center text-red-500">
        {error}
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-100 dark:bg-gray-900 overflow-hidden">
      {/* Main Content (Viewer) */}
      <div className="flex-1 h-full overflow-y-auto relative bg-gray-100 dark:bg-gray-900" id="document-scroll-container">
        
        {/* Top Bar */}
        <div className="sticky top-0 z-10 bg-white/90 dark:bg-gray-800/90 backdrop-blur-md border-b border-gray-200 dark:border-gray-700 px-6 py-3 flex items-center justify-between shadow-sm">
           <Link
              href="/documents"
              className="inline-flex items-center gap-2 text-gray-600 dark:text-gray-300 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors text-sm font-medium"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Library
            </Link>
            
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate max-w-md mx-4">
              {document.title}
            </div>
            
            <div className="flex items-center gap-3">
               <span className="text-xs text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded-md">
                 Page {visiblePageNum} of {totalPages}
               </span>
               <div className="h-4 w-px bg-gray-300 dark:bg-gray-600"></div>
               <form onSubmit={handlePageInputSubmit} className="flex items-center gap-2">
                 <div className="relative">
                   <input
                     type="number"
                     min="1"
                     max={totalPages}
                     value={pageInputValue}
                     onChange={handlePageInputChange}
                     placeholder="Go to page..."
                     className={`w-24 px-2 py-1 text-xs border rounded-md focus:outline-none focus:ring-1 ${
                       pageInputError
                         ? 'border-red-500 focus:ring-red-500 dark:border-red-400'
                         : 'border-gray-300 dark:border-gray-600 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white'
                     }`}
                   />
                   {pageInputError && (
                     <div className="absolute top-full left-0 mt-1 px-2 py-1 text-xs text-red-600 dark:text-red-400 bg-white dark:bg-gray-800 border border-red-300 dark:border-red-600 rounded shadow-lg z-20 whitespace-nowrap">
                       {pageInputError}
                     </div>
                   )}
                 </div>
                 <button
                   type="submit"
                   className="px-2 py-1 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded-md transition-colors"
                 >
                   Go
                 </button>
               </form>
               <div className="h-4 w-px bg-gray-300 dark:bg-gray-600"></div>
               <div className="flex items-center text-xs text-gray-400">
                  Read Only
               </div>
            </div>
        </div>

        <DocumentViewer
          pages={pages}
          isLoading={isLoadingMore}
          hasMore={hasMore}
          searchQuery={searchResults?.query || ''}
          onLoadMore={handleLoadMore}
          onPageVisible={setVisiblePageNum}
          // onLoadFirstPage={handleLoadFirstPage}
          language={document.language}
        />
        
      </div>

      {/* Sidebar - Right Side (Fixed Width) */}
      <div className="w-80 md:w-96 h-full flex-shrink-0 z-20 border-l border-gray-200 dark:border-gray-700">
        <DocumentSidebar
          document={document}
          currentPage={visiblePageNum}
          searchResults={searchResults}
          isSearching={isSearching}
          onSearch={handleSearch}
          onGoToPage={handleGoToPage}
        />
      </div>
    </div>
  );
}
