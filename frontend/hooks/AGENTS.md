<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-03 | Updated: 2026-07-03 -->

# hooks

## Purpose
Shared custom React hooks for the ILM frontend. Provides media query detection, debouncing, faceted search over documents, reading statistics tracking, and desktop breakpoint queries. All hooks are client-side (`'use client'`) and follow React hooks conventions (dependency arrays, cleanup).

## Key Files
| File | Description |
|------|-------------|
| `useMediaQuery.ts` | SSR-safe `matchMedia` wrapper. Returns `defaultValue` (default true) on server; syncs with `window.matchMedia()` on client. Unsubscribes on unmount. Safari 14 fallback (addListener). Used by `useIsDesktop()`. |
| `useIsDesktop.ts` | Breakpoint hook for desktop layout detection. Queries `(min-width: 1200px)`. Default true on server (desktop-first SSR). Used by ReaderShell to toggle 3-column vs. single-column layout. |
| `useDebounce.ts` | Generic debounce hook. Delays state update by `delay` ms. Used for search inputs (prevent excessive API calls). Clears timeout on unmount. |
| `useBooksFacetSource.ts` | Adapter for document title faceted search. Wraps `getDocuments({ search })` API call. Implements `BooksFacetSource` interface: `fetchItems(search)` → paginated document results reshaped to `{ id, name }`. `resolveId(title)` → maps display title back to document id. Used by FacetTypeahead for the "select books" filter. |
| `useReadingStats.ts` | Tracks reading session metrics: time spent, unique pages visited, reading speed (pages/min). Persists to localStorage per-document. Handles tab visibility (pause when hidden, resume on focus). Resets via `resetStats()` callback. Returns `{ stats, resetStats }`. |

## For AI Agents

### Working In This Directory
- **Hook exports**: Each file exports one hook. All are client-only (`'use client'` directive).
- **TypeScript**: Hooks are fully typed; generic where applicable (e.g., `useDebounce<T>`).
- **Cleanup**: Hooks manage cleanup (setTimeout, event listeners) via useEffect return functions.
- **SSR safety**: Hooks that touch `window` (useMediaQuery, useReadingStats) provide sensible server defaults or guard with `typeof window !== 'undefined'`.

### Testing Requirements
- **Type check**: `npx tsc --noEmit` (from `frontend/`) verifies all hook signatures and usages.
- **Unit tests**: vitest (`npm test`) — verify debounce timing/cleanup, media-query defaults and sync, facet reshaping and title→id resolution, reading-stats persistence and reset.

### Common Patterns
- **Default values**: Hooks return sensible defaults (empty arrays, 0, false) to avoid runtime errors before hydration.
- **Refs for mutable state**: useMediaQuery and useReadingStats use useRef for state that persists across renders (lastPageRef, intervalRef, pagesVisitedRef).
- **LocalStorage**: useReadingStats reads/writes localStorage wrapped in try/catch (quota exceeded).
- **Stable callbacks**: Returned callbacks are wrapped in useCallback to prevent re-renders in dependent components.

## Dependencies

### Internal
- `useDebounce` → used by FilterSidebar (document filters search)
- `useIsDesktop` → used by ReaderShell to toggle layout
- `useMediaQuery` → base hook for useIsDesktop
- `useBooksFacetSource` → used by FacetTypeahead for document selection in filters; calls `@/lib/api` getDocuments
- `useReadingStats` → used by ReadingStatsPanel in the reader

### External
- **React 18**: hooks (useEffect, useState, useRef, useCallback, useMemo)

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
