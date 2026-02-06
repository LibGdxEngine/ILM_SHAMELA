import { useState, useEffect, useRef, useCallback } from 'react';

export interface ReadingStats {
  timeSpent: number; // in milliseconds
  pagesRead: number; // unique pages visited
  readingSpeed: number; // pages per minute
  sessionStartTime: number;
}

const STORAGE_KEY_PREFIX = 'reading_stats_';

/**
 * Hook to track reading statistics for a document
 */
export function useReadingStats(documentId: number, currentPage: number) {
  const [stats, setStats] = useState<ReadingStats>({
    timeSpent: 0,
    pagesRead: 0,
    readingSpeed: 0,
    sessionStartTime: Date.now(),
  });

  const sessionStartRef = useRef<number>(Date.now());
  const pagesVisitedRef = useRef<Set<number>>(new Set());
  const lastPageRef = useRef<number>(currentPage);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isActiveRef = useRef<boolean>(true);

  // Load stats from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(`${STORAGE_KEY_PREFIX}${documentId}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        setStats(parsed);
        sessionStartRef.current = parsed.sessionStartTime || Date.now();
        pagesVisitedRef.current = new Set(parsed.pagesVisited || []);
      } else {
        // Initialize new session
        sessionStartRef.current = Date.now();
        pagesVisitedRef.current = new Set();
        setStats({
          timeSpent: 0,
          pagesRead: 0,
          readingSpeed: 0,
          sessionStartTime: Date.now(),
        });
      }
    } catch (err) {
      console.warn('Failed to load reading stats:', err);
      sessionStartRef.current = Date.now();
      pagesVisitedRef.current = new Set();
    }
  }, [documentId]);

  // Track page visits
  useEffect(() => {
    if (currentPage !== lastPageRef.current && currentPage > 0) {
      pagesVisitedRef.current.add(currentPage);
      lastPageRef.current = currentPage;
      
      // Update stats
      setStats(prev => {
        const timeSpent = Date.now() - sessionStartRef.current;
        const pagesRead = pagesVisitedRef.current.size;
        const readingSpeed = timeSpent > 0 ? (pagesRead / (timeSpent / 60000)) : 0;
        
        return {
          ...prev,
          pagesRead,
          timeSpent,
          readingSpeed,
        };
      });
    }
  }, [currentPage]);

  // Update time spent periodically
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    intervalRef.current = setInterval(() => {
      if (isActiveRef.current) {
        setStats(prev => {
          const timeSpent = Date.now() - sessionStartRef.current;
          const pagesRead = pagesVisitedRef.current.size;
          const readingSpeed = timeSpent > 0 ? (pagesRead / (timeSpent / 60000)) : 0;
          
          return {
            ...prev,
            timeSpent,
            pagesRead,
            readingSpeed,
          };
        });
      }
    }, 1000); // Update every second

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  // Save stats to localStorage whenever they change
  useEffect(() => {
    try {
      const dataToStore = {
        ...stats,
        pagesVisited: Array.from(pagesVisitedRef.current),
        lastUpdated: Date.now(),
      };
      localStorage.setItem(`${STORAGE_KEY_PREFIX}${documentId}`, JSON.stringify(dataToStore));
    } catch (err) {
      console.warn('Failed to save reading stats:', err);
    }
  }, [stats, documentId]);

  // Handle visibility change (pause when tab is hidden)
  useEffect(() => {
    const handleVisibilityChange = () => {
      isActiveRef.current = !document.hidden;
      if (!document.hidden) {
        // Resume session
        sessionStartRef.current = Date.now() - stats.timeSpent;
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [stats.timeSpent]);

  // Reset stats
  const resetStats = useCallback(() => {
    sessionStartRef.current = Date.now();
    pagesVisitedRef.current.clear();
    setStats({
      timeSpent: 0,
      pagesRead: 0,
      readingSpeed: 0,
      sessionStartTime: Date.now(),
    });
    try {
      localStorage.removeItem(`${STORAGE_KEY_PREFIX}${documentId}`);
    } catch (err) {
      console.warn('Failed to clear reading stats:', err);
    }
  }, [documentId]);

  return {
    stats,
    resetStats,
  };
}
