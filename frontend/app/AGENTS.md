<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-03 | Updated: 2026-07-03 -->

# app

## Purpose
Next.js App Router tree. Implements the landing page, authentication flows (email & OAuth), documents discovery ("The Reading Room"), interactive world map, document reader (3-column parchment shell), user profile, and document upload. Each route is locale-prefixed (/:locale) via middleware rewrite. The root layout manages fonts, auth provider, i18n, and Navbar. CopilotKit providers are scoped to /documents and /documents/[id] to enable library and reader assistants.

## Key Files

| File | Description |
|------|-------------|
| `layout.tsx` | Root layout: loads the app's Google Fonts (Amiri, Fraunces, Readex Pro, IBM Plex Arabic, Aref Ruqaa, Reem Kufi, Source Serif, Manrope, Noto Kufi Arabic, Inter). Wraps app in AuthProvider, QueryProvider, I18nProvider. Resolves locale from `x-ilm-locale` header. Sets html lang/dir. Includes Navbar and scrollable content area. |
| `globals.css` | Root CSS: custom properties (font variables, color variables for parchment theme), @layer directives for Tailwind utilities, print styles. Defines paper, ink-deep, gold, maroon color tokens. |
| `page.tsx` | Landing page (`/`). Hero section with shelf of mock books (Lisān, Muqaddima, Bukhārī, etc.). Landing component sections (HeroSection, WhyIlmSection, HowItWorksSection, FinalCTASection, StarMark, LandingHeader). Framer Motion fade-in animations. Shows "Start Reading" CTA (routes to /documents if auth'd, else /auth/register). Uses `useLocalizedPath()` for locale-aware navigation. |
| `auth/layout.tsx` | Auth subtree layout (shared by login/register pages). |
| `auth/login/page.tsx` | `/auth/login` — Email login form. Wraps `<AuthPanel initialMode="signin" />` in Suspense. |
| `auth/register/page.tsx` | `/auth/register` — Email registration form. Wraps `<AuthPanel initialMode="signup" />` in Suspense. |
| `auth/google/callback/page.tsx` | `/auth/google/callback` — OAuth callback handler. Parses access token from URL hash. Extracts locale from state param. Calls `useAuth().googleLogin(accessToken)`. Redirects to /documents or /auth/register based on outcome. |
| `documents/layout.tsx` | Scopes CopilotKit provider (`libraryAgent`) to the /documents subtree. Imports CopilotKit styles. Runtime endpoint `/api/copilotkit`. |
| `documents/page.tsx` | `/documents` — **The Reading Room** (library discovery page). Lists documents with filters (category, author, language, year, etc.). Filtering sidebar, search bar, filter chips, view modes. Integrates LibraryAssistant (AI drawer). Shows "Continue Shelf" (recently read). Hybrid search modes. Persists filter preferences per-user + named presets. |
| `documents/[id]/page.tsx` | `/documents/[id]` — **Document Reader** (3-column parchment shell). Loads document pages in batches. ToC column, document viewer, assistant column. Font size/theme controls, highlights, notes, bookmarks, reading progress tracking. In-document search, selection popover, similarity modal, correction reporting. CopilotKit scoped to readerAgent. Keyboard shortcuts. Collapsible panels on mobile. |
| `map/page.tsx` | `/map` — Interactive world map showing document distribution by country. Clicking a country filters /documents by that geography. Integrates NavSearchPopover for book selection. Shows country stats (document count). Parchment palette. |
| `upload/page.tsx` | `/upload` — Document upload interface (staff/editor only, guarded by RequireAuth requireUpload). Wraps UploadZone component. Redirect to /documents on success. |
| `profile/page.tsx` | `/profile` — User profile editor (auth required). Form fields: first_name, last_name, email, avatar, password change. Field-level validation errors. |
| `api/copilotkit/route.ts` | **CopilotKit bridge**. POST handler for CopilotKit runtime. Forwards requests to the Python FastAPI sidecar (`AGENT_SERVICE_URL`, default `http://localhost:8123`). Two agents: `libraryAgent` (root), `readerAgent` (/reader). Uses HttpAgent + ExperimentalEmptyAdapter. Max duration 300s. |

## Routes Overview

| Route | Purpose | Auth Required | CopilotKit Agent |
|-------|---------|----------------|------------------|
| `/` | Landing page with hero, sections, shelf | No | None |
| `/auth/login` | Email login | No | None |
| `/auth/register` | Email registration | No | None |
| `/auth/google/callback` | OAuth redirect handler | No | None |
| `/documents` | Library discovery ("The Reading Room") | Yes | libraryAgent |
| `/documents/[id]` | Document reader (3-column shell) | Yes | readerAgent |
| `/map` | World map (document distribution by country) | Yes | None |
| `/upload` | Document upload (staff/editor only) | Yes (staff) | None |
| `/profile` | User profile editor | Yes | None |
| `/api/copilotkit` | CopilotKit runtime bridge | N/A (internal) | — |

## For AI Agents

### Working In This Directory
- **Page structure**: Each route file is a page component exported as `default`. Wrap async data loads in Suspense if needed.
- **Locale-aware navigation**: Use `useLocalizedPath()` to build hrefs: `localizedPath("/documents")` → `"/en/documents"` (or ar/fa/ur).
- **Auth guards**: Use `<RequireAuth>` for protected routes. Pass `requireUpload` for editor-only.
- **Server vs client**: Root `layout.tsx` is async (resolves locale from headers). Route `page.tsx` files are `'use client'` (interactivity, hooks, browser APIs).
- **CopilotKit scoping**: `documents/layout.tsx` wraps children in `<CopilotKit>`. Child routes can call `useCopilotAction`, `useCopilotReadable`. Agents forward to the sidecar (:8123).
- **Pagination in the reader**: `documents/[id]` loads document pages in batches with an infinite-scroll pattern (`hasMore`, `isLoadingMore`).

### Testing Requirements
- **Build**: `npm run build` must include all routes without errors (from `frontend/`, dev server stopped).
- **Type check**: `npx tsc --noEmit` catches missing imports, mismatched props.
- **E2E**: Playwright smoke test verifies landing page and auth flow.
- **Manual verification**: `npm run dev`, then walk the critical paths: landing CTA redirect (unauthenticated → /auth/register), login → /documents, filters + assistant on /documents, page loading + highlights + notes in the reader, country selection on /map, staff-gated /upload, profile form submit.

### Common Patterns
- **Locale in params**: Always resolve locale from context, not from URL pathname directly (middleware rewrites strip it).
- **Metadata**: Root layout exports metadata server-side. Child routes can export their own.
- **Suspense**: Use for async data. Fallbacks show skeletons (DocumentPageSkeleton, BookCardSkeleton).
- **Query params**: /documents encodes view mode, sort, and filter state in SearchParams (persisted in localStorage + backend preference API).
- **Animations**: Framer Motion fade-ins on landing; `motion.div` with `whileInView`, `initial`, `animate`.

## Dependencies

### Internal
- `layout.tsx` → components (Navbar, I18nProvider, HtmlLangDirSync), lib (AuthContext, getDictionary, i18n config)
- `page.tsx` → landing components (HeroSection, WhyIlmSection, HowItWorksSection, FinalCTASection, StarMark, LandingHeader)
- `auth/*` → AuthPanel component, useAuth hook, i18n navigation helpers
- `documents/page.tsx` → FilterSidebar, BookCard, ContinueShelf, LibraryAssistant, SearchCommandPalette, TanStack Query
- `documents/[id]/page.tsx` → DocumentViewer, ReaderShell, SelectionPopover, ReaderAssistant, AdvancedSearchPanel, reader hooks (useChapters, useHighlights, useNotes, useBookmarks, useReadingProgress, useReaderCopilotSessions)
- `map/page.tsx` → InteractiveWorldMap, AtlasRail, NavSearchPopover, country stats API
- `upload/page.tsx` → UploadZone, RequireAuth
- `api/copilotkit/route.ts` → @copilotkit/runtime, @ag-ui/client (HttpAgent)

### External
- **Next.js**: routing, metadata generation, static optimization
- **React**: hooks, context, suspense
- **CopilotKit**: agent runtime, frontend actions (useCopilotAction, useCopilotReadable)
- **TanStack Query**: server state management, caching
- **Framer Motion**: page animations
- **D3 Geo, React Simple Maps**: map rendering

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
