<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-03 | Updated: 2026-07-03 -->

# lib

## Purpose
Core utilities and hooks for the ILM frontend: authentication (JWT cookie login via dj-rest-auth), API layer (relative-URL fetch wrappers with CSRF tokens), document caching, reader experience state (bookmarks, highlights, notes, chat, progress), i18n (ar/en/fa/ur with RTL support), and document search/filter persistence. All reader-state writes go through DRF SessionAuthentication (credentials: 'include' + X-CSRFToken header). See `reader/AGENTS.md` for reader-specific hooks.

## Key Files
| File | Description |
|------|-------------|
| `api.ts` | Core API types (Document, Author, Category, DocumentPage, MediaUrl) and `normalizeMediaUrl()` helper; relative-URL pattern to avoid CORS. |
| `auth.ts` | JWT/dj-rest-auth wrappers: login, register, logout, getUser, googleLogin, updateUserProfile with typed request/response shapes and AuthValidationError. |
| `AuthContext.tsx` | React Context provider for auth state; hydrates user on mount, triggers reader localStorage migration once per session, exposes refreshUser/login/logout/register/googleLogin. |
| `cache.ts` | LRU page-cache for document pages (50-entry, 5min TTL by default) with get/set/clear. |
| `csrf.ts` | CSRF token reader (getCookie, getCsrfToken) and header builder (csrfHeaders) for DRF SessionAuthentication writes; safe to call server-side. |
| `utils.ts` | Localization helpers: `toLocaleDigits()` (ar/fa/ur digit swaps), `fileTypeLabel()`, `formatRelativeDate()` (relative timestamps with i18n). |
| `queryClient.tsx` | TanStack Query client provider; staleTime 30s, no refetch-on-focus, 1 retry. |
| `documentsSearchParams.ts` | DocumentsSearchState interface and `buildDocumentsSearchParams()` to serialize /documents filters into clean URLs (q, refine, mode, authors, categories, etc). |
| `coverPalettes.ts` | Cover gradient palettes by Islamic discipline (fiqh, hadith, tafsir, history, philosophy, literature, biography, language, creed, sufism, usul). |
| `atlasRegions.ts` | Region-label mapping (English country → Arabic/Persian/Urdu historical names) and REGION_DOT_COLORS for the interactive map. |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `api/` | Backend wrappers: `reader.ts` (reader CRUD types + endpoints), `documentFilters.ts` (filter preference + preset CRUD), `library-chat.ts` (library chat session persistence), `libraryAnswer.ts` (library answer helpers). No own AGENTS.md. |
| `documents/` | Document-page hooks: useAssistantDock (drawer state), useClassicsDocuments, useLibraryChat (CopilotKit agent sessions), useRecentDocuments. No own AGENTS.md. |
| `i18n/` | Localization: config (locales ar/en/fa/ur, direction, date-locale), types, getDictionary (load JSON), languageName (lookup hook), navigation (useLocalizedPath). `dictionaries/` holds ar.json, en.json, fa.json, ur.json. No own AGENTS.md. |
| `reader/` | Reader-state hooks and utilities (see `reader/AGENTS.md`). |

## For AI Agents

### Working In This Directory
- **Relative URLs + CSRF**: Fetch wrappers use `getApiBaseUrl()` — '' in the browser (same-origin) or NEXT_PUBLIC_API_URL during SSR. Every write (POST/PATCH/DELETE) includes `csrfHeaders()` because the backend enforces DRF SessionAuthentication + CSRF.
- **TanStack Query**: Reader state uses React Query with keys from `reader/queryKeys.ts`. Mutations follow the onMutate → onError → onSettled pattern for optimistic UI.
- **Auth flow**: Login/register via `auth.ts` → set user in AuthContext → (once per session) trigger `migrateAllReaderLocalStorage()` to push legacy localStorage data to the API.
- **i18n**: All locale-aware formatting (digits, dates, navigation) goes through `lib/i18n/` utilities. ar/fa/ur are RTL; en is LTR. Dictionaries are static JSON loaded at module scope. New keys must be added to all four dictionaries.
- **Document filtering**: Use `buildDocumentsSearchParams()` to serialize filter state into URLs (persisted at /documents via `api/documentFilters.ts` endpoints).

### Testing Requirements
```bash
cd frontend
npm test            # vitest, jsdom environment, setup in vitest.setup.ts
npx tsc --noEmit    # type gate
```
Note: there are pre-existing failures in `lib/utils.test.ts` — compare against a clean tree before attributing failures to your change.

### Common Patterns
- **Optimistic mutations**: onMutate stores previous state, onError reverts, onSettled invalidates. See useBookmarks, useHighlights, useNotes, useReaderPreferences for the template.
- **Debounced saves**: useReadingProgress debounces with leading (immediate) + trailing (5s) semantics to bound write volume.
- **Reader localStorage → API migration**: On first auth per session, legacy keys (doc_<id>_{bookmarks,notes}, reader_preferences) are migrated to the backend via `reader/migrate.ts`.
- **Drawer/dock state**: useAssistantDock persists open/pinned/edge to localStorage (`ilm.docs.assistantDock`).
- **Query cache seeding**: useReadingProgress has no GET endpoint; the cache is seeded by upsert results and the continue-reading list.

## Dependencies

### Internal
- `lib/reader/` — reader state hooks, migrate, selection, queryKeys
- `components/i18n/I18nProvider` — I18nProvider, useI18n hook (used by languageName.ts, navigation.ts)
- `lib/api/` — reader.ts, library-chat.ts, documentFilters.ts, libraryAnswer.ts

### External
- `@tanstack/react-query` — useQuery, useMutation, useQueryClient, QueryClientProvider
- `@copilotkit/react-core` — CopilotKit chat internals (useLibraryChat)
- Next.js — usePathname, useRouter ('next/navigation')
- React 18 — Context, hooks

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
