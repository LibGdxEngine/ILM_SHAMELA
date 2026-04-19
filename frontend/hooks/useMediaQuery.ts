'use client';

import { useEffect, useState } from 'react';

/**
 * SSR-safe `matchMedia` hook. Returns `defaultValue` on the server
 * (typically set to the desktop value to avoid layout shift on first paint
 * for SSR-heavy hydration). After mount, it subscribes to `matchMedia`.
 */
export function useMediaQuery(query: string, defaultValue = true): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined') return defaultValue;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(query);
    const handler = (event: MediaQueryListEvent) => setMatches(event.matches);
    // Sync current value on mount in case it changed between render and effect.
    setMatches(mql.matches);
    if (mql.addEventListener) {
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    }
    // Safari < 14
    mql.addListener(handler);
    return () => mql.removeListener(handler);
  }, [query]);

  return matches;
}

export default useMediaQuery;
