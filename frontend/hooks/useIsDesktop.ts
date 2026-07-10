'use client';

import { useMediaQuery } from './useMediaQuery';

/**
 * The reader shell's desktop breakpoint (docked panels, multi-column layout).
 * Shared by the reader page and `ReaderShell` so the threshold stays in one
 * place. Defaults to `true` on the server to match the SSR desktop-first paint.
 */
export const DESKTOP_QUERY = '(min-width: 1200px)';

export function useIsDesktop(): boolean {
  return useMediaQuery(DESKTOP_QUERY, true);
}

export default useIsDesktop;
