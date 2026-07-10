<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-03 | Updated: 2026-07-03 -->

# components

## Purpose
Core reusable UI component library for the ILM platform. Includes navigation infrastructure (Navbar, RequireAuth), layout shells (ShellHeader), book discovery cards, a global search interface, an interactive world map (Atlas), multi-language support, authentication panels, and landing page sections. Components are client-side where interaction is required; theming via CSS variables (--accent, --shell-surface) so shells (Reading Room, Catalog, Atlas) provide consistent visual identity across routes.

## Key Files
| File | Description |
|------|-------------|
| `Navbar.tsx` | Global navigation bar; hidden on redesigned shell routes (/documents, /map, /auth, /). Shows user menu, language switcher, links (library/discover/notes) when visible. |
| `RequireAuth.tsx` | Auth guard wrapper for protected routes. Redirects unauthenticated users to login; additionally checks `can_upload` flag if `requireUpload` prop set. |
| `ShellHeader.tsx` | Unified in-page header for redesigned shells (Reading Room, Catalog, Atlas). Themes from CSS vars (--accent, --shell-*), renders star logo, search slot, language pills, optional theme toggle, avatar menu. |
| `BookCard.tsx` | Document card for library discovery. Shows cover, title, author, language, file type watermark, reading progress bar (if progressPercent prop), metadata footer. |
| `BookListRow.tsx` | Horizontal row layout variant of BookCard for shelf display. |
| `BookCardSkeleton.tsx` | Skeleton loader placeholder for BookCard while fetching. |
| `ContinueReadingShelf.tsx` | Shelf of recently read books (Continue Reading). Auth-gated, pull-based (useContinueReading hook), displays up to 8 items with gradient fallback covers. |
| `InteractiveWorldMap.tsx` | Interactive world map (Atlas page). React-simple-maps + Framer Motion. Selectable countries, tooltips with book counts, color states (selected/active/inactive). Handles zoom/pan state. |
| `AtlasRail.tsx` | Right rail for Atlas page. Region list, document count tally, author cards for selected country. Fetches documents on country change. |
| `MapSidePanel.tsx` | Side panel for Atlas; coordinates with AtlasRail. |
| `mapData.ts` | Static/typed data for Atlas regions and country metadata. |
| `SearchInterface.tsx` | Top-level search component. Query input + debounce → searchDocuments API call, display results. |
| `Announcer.tsx` | Accessibility live region for announcing dynamic changes to screen readers. |
| `AppHeaderAvatarMenu.tsx` | User avatar dropdown in header. Shows user email, language selector, logout. Locale switch rewrites pathname (strip → withLocale → push). |
| `UploadZone.tsx` | Document upload form. Drag-drop, file input, metadata fields (title, authors, categories, language, OCR engine selection). Form validation, progress tracking. |
| `ReadingProgress.tsx` | Calculates reading progress (0–100%) from current page and scroll position. Used by reader to track continuation point. |
| `ErrorDisplay.tsx` | Styled error message container with optional retry button. |
| `ShellLanguagePills.tsx` | Inline language pill set (ع / EN / فا / اردو). Locale rewrite on click (preserves query + hash). Configurable subset via `only` prop. |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `auth/` | Authentication screens. Single component: AuthPanel.tsx (two-panel layout, signin/signup toggle, brand + form side-by-side with Framer Motion; tab switch rewrites URL via history.replaceState to avoid remount). |
| `i18n/` | Internationalization. I18nProvider (context + dictionary lookup + `useI18n` hook), LanguageSwitcher (full menu), HtmlLangDirSync (sets `lang` + `dir` on root). |
| `landing/` | Landing page (/). Six pieces: LandingHeader (hero logo + nav), HeroSection (typing text + CTA), HowItWorksSection, WhyIlmSection, FinalCTASection, StarMark (reusable khatim star). |
| `search/` | Top-level search affordances. NavSearchPopover (in-reader / in-catalog search box with book picker), SearchFacetControls (search refinement). |
| `document/` | Document reader UI — 3-column parchment shell (see `document/AGENTS.md`). **Not to be confused with `documents/`.** |
| `documents/` | Library discovery ("The Reading Room") UI for /documents (see `documents/AGENTS.md`). **Not to be confused with `document/`.** |

## For AI Agents

### Working In This Directory
- **`document/` vs `documents/`**: `document/` (singular) is the in-book reader; `documents/` (plural) is the library discovery page. Easy to confuse — check which page you're changing first.
- **Client components**: All components are marked `'use client'` unless they are pure server (rare).
- **Theming**: Shell components (ShellHeader, ShellLanguagePills, etc.) theme from CSS variables (--accent, --shell-surface, --shell-line, --shell-muted) so they adapt to Reading Room/Catalog/Atlas without hardcoded colors.
- **i18n pattern**: Use `useI18n()` to get `locale`, `direction` ('rtl'/'ltr'), and `t()` translation function. Always pass fallback strings to `t()`.
- **Localized paths**: Use `useLocalizedPath()` to build hrefs; use `withLocale()` for rewrites on locale change.
- **Auth checks**: Use `useAuth()` for `isAuthenticated`, `user` (with `can_upload` flag), `logout`.
- **RTL support**: Tailwind `rtl:` variants are NOT registered in this app; use JS direction check + logical properties (e.g. `marginInlineEnd`) or explicit inline styles.

### Testing Requirements
- **Gates** (lint is broken repo-wide): `npx tsc --noEmit` and `npm run build` from `frontend/` must pass before committing.
- **Live check**: Component changes affecting visible UI must be verified in the dev server on the route(s) the component appears on (e.g., BookCard on /documents, ShellHeader on /map).
- **i18n correctness**: New i18n keys must exist in all four dictionaries (ar.json, en.json, fa.json, ur.json) in `lib/i18n/dictionaries/`.
- **Auth state**: Auth guards (RequireAuth, user menu logic) must be tested by logging out/in and verifying redirects.

### Common Patterns
- **Graceful fallbacks**: ShellHeader fonts fall back to sans-serif; BookCard uses color-hash fallback gradients for missing covers.
- **Portals**: Overlay/tooltip content uses createPortal so it isn't clipped by scroll containers.
- **Skeleton loaders**: BookCardSkeleton, DocumentPageSkeleton mirror their real counterparts' layout so nothing shifts on load.
- **Framer Motion**: Staggered animations, slide-ins, presence control (AnimatePresence). Easing: `[0.22, 1, 0.36, 1]`.
- **Stable callbacks**: Components passing callbacks down (onCategoryChange, onCountrySelect) stabilize them with useCallback/useMemo.
- **Async data**: ContinueReadingShelf, AtlasRail use React Query (useQuery) with staleTime + keepPreviousData for smoothness.

## Dependencies

### Internal
- `lib/api.ts` — Document, Author, Category types; fetch functions (searchDocuments, getAuthors, getCategories, uploadDocument).
- `lib/AuthContext` — useAuth hook for user state, login/logout.
- `lib/i18n/` — config (Locale type, localeToDirection, withLocale), getDictionary, Dictionary type, languageName hook.
- `lib/reader/useChat.ts` — for the reader's AI chat (document/AssistantColumn).
- `lib/documents/useLibraryChat.ts` — for the discovery assistant (documents/LibraryAssistant).
- `lib/coverPalettes.ts` — paletteFor() color scheme for BookCard backgrounds.
- `lib/utils.ts` — formatRelativeDate, fileTypeLabel, toLocaleDigits, extractSnippet, highlightText.
- `lib/atlasRegions.ts` — regionDisplayName, regionColor for AtlasRail.
- `hooks/useIsDesktop.ts` — breakpoint checks.

### External
- **next/navigation** — useRouter, usePathname for client-side routing.
- **framer-motion** — motion, AnimatePresence, Variants for animations.
- **react-simple-maps** — ComposableMap, Geography, ZoomableGroup for InteractiveWorldMap.
- **lucide-react** — Icons.
- **@copilotkit/react-ui / react-core** — CopilotKit UI + hooks (LibraryAssistant).
- **@tanstack/react-query** — useQuery, keepPreviousData for data fetching.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
