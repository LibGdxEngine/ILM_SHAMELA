import { DocumentPage } from './api';

interface CachedBatch {
  pages: DocumentPage[];
  timestamp: number;
  ttl: number;
}

interface DocumentPagesResponse {
  total_pages: number;
  current_page: number;
  page_size: number;
  pages: DocumentPage[];
}

/**
 * Page cache for storing recently loaded document pages
 * Implements LRU (Least Recently Used) eviction strategy
 */
class PageCache {
  private cache: Map<string, CachedBatch> = new Map();
  private maxSize: number;
  private defaultTTL: number; // in milliseconds

  constructor(maxSize: number = 50, defaultTTL: number = 5 * 60 * 1000) {
    this.maxSize = maxSize;
    this.defaultTTL = defaultTTL;
  }

  /**
   * Generate cache key for a document batch
   */
  private getKey(documentId: number, batchNumber: number): string {
    return `doc_${documentId}_batch_${batchNumber}`;
  }

  /**
   * Get cached pages for a batch
   */
  get(documentId: number, batchNumber: number): DocumentPagesResponse | null {
    const key = this.getKey(documentId, batchNumber);
    const cached = this.cache.get(key);

    if (!cached) {
      return null;
    }

    // Check if expired
    const now = Date.now();
    if (now - cached.timestamp > cached.ttl) {
      this.cache.delete(key);
      return null;
    }

    return {
      pages: cached.pages,
      total_pages: 0, // Will be set by caller
      current_page: batchNumber,
      page_size: cached.pages.length,
    };
  }

  /**
   * Store pages in cache
   */
  set(
    documentId: number,
    batchNumber: number,
    pages: DocumentPage[],
    ttl?: number
  ): void {
    const key = this.getKey(documentId, batchNumber);

    // Evict oldest entries if cache is full
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      // Remove oldest entry (first in Map)
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      pages,
      timestamp: Date.now(),
      ttl: ttl || this.defaultTTL,
    });
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Clear cache entries for a specific document
   */
  clearDocument(documentId: number): void {
    const keysToDelete: string[] = [];
    for (const key of this.cache.keys()) {
      if (key.startsWith(`doc_${documentId}_`)) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach((key) => this.cache.delete(key));
  }

  /**
   * Remove expired entries
   */
  cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, cached] of this.cache.entries()) {
      if (now - cached.timestamp > cached.ttl) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach((key) => this.cache.delete(key));
  }

  /**
   * Get cache size
   */
  size(): number {
    return this.cache.size;
  }
}

/**
 * Request deduplication: tracks in-flight requests to prevent duplicate API calls
 */
class RequestDeduplicator {
  private pendingRequests: Map<string, Promise<any>> = new Map();

  /**
   * Get or create a request promise
   */
  getOrCreate<T>(
    key: string,
    requestFn: () => Promise<T>
  ): Promise<T> {
    // Check if request is already in-flight
    const existing = this.pendingRequests.get(key);
    if (existing) {
      return existing as Promise<T>;
    }

    // Create new request
    const promise = requestFn().finally(() => {
      // Remove from pending when completed
      this.pendingRequests.delete(key);
    });

    this.pendingRequests.set(key, promise);
    return promise;
  }

  /**
   * Check if a request is pending
   */
  isPending(key: string): boolean {
    return this.pendingRequests.has(key);
  }

  /**
   * Cancel a pending request (if possible)
   */
  cancel(key: string): void {
    this.pendingRequests.delete(key);
  }

  /**
   * Clear all pending requests
   */
  clear(): void {
    this.pendingRequests.clear();
  }
}

// Singleton instances
export const pageCache = new PageCache();
export const requestDeduplicator = new RequestDeduplicator();

// Cleanup expired cache entries periodically (every 5 minutes)
if (typeof window !== 'undefined') {
  setInterval(() => {
    pageCache.cleanup();
  }, 5 * 60 * 1000);
}
