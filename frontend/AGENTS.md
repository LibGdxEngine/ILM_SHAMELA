<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-03 | Updated: 2026-07-03 -->

# frontend

## Purpose
Next.js 16 (App Router) TypeScript frontend for the ILM Islamic digital library platform. Implements RTL/multilingual UI (Arabic, English, Farsi, Urdu via locale-prefixed routes), JWT cookie-based auth against the Django backend, and integrates CopilotKit for AI-assisted library discovery and document reading. Landing page showcases Islamic sources; authenticated users browse, filter, read, and annotate documents with highlights, notes, and bookmarks.

## Key Files
| File | Description |
|------|-------------|
| `package.json` | Dependencies: Next.js 16, React 18, CopilotKit, TanStack Query, Tailwind, TypeScript. Scripts: dev, build, start, test (vitest), test:e2e (Playwright). |
| `next.config.js` | API rewrites (Django backend proxy on `/api/*` except `/api/copilotkit`), media path proxying, image remote patterns for localhost:8000. Standalone output in production. Trailing slash preservation. |
| `tsconfig.json` | Strict TypeScript, path alias `@/*` maps to project root, strict null checks, JSX as react-jsx. |
| `tailwind.config.ts` | Parchment & ivory design system (colors: gold, maroon, terracotta accents, warm neutrals). Font families: Arabic (Amiri, Readex Pro, IBM Plex), Latin (Fraunces, Inter, Manrope). Custom keyframes: cursor-blink, live-dot. |
| `middleware.ts` | i18n locale detection via header prefix + rewrite. Strips locale from pathname for App Router. Sets `x-ilm-locale` header for resolving locale in server components. Skips API, media, static files. |
| `playwright.config.ts` | E2E test configuration (Chromium), baseURL http://localhost:3000, trace on failure, 45s timeout, HTML reporter. |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `app/` | App Router pages and layout (see `app/AGENTS.md`) |
| `components/` | React components: landing, auth, documents discovery, document reader, search, i18n, shared UI (see `components/AGENTS.md`) |
| `lib/` | API client (Django REST endpoints), auth context, i18n config, utility functions, reader hooks (see `lib/AGENTS.md`) |
| `hooks/` | Custom hooks: media queries, debounce, books facet source, reading stats (see `hooks/AGENTS.md`) |
| `e2e/` | Playwright smoke test (`smoke.spec.ts`) |
| `public/` | Static assets: logo.svg, logo.png, images/ (landing page visuals in `images/landing/`, brand assets in `images/brand/`) |
| `styles/` | Print stylesheet (`print.css`) for document printing |

## For AI Agents

### Working In This Directory
- **Always `cd` into `frontend/` first**: the repo-root package.json has no build/test scripts, so `npm run build` from the root fails with "Missing script".
- **Type checking**: `npx tsc --noEmit` (preferred gate before commit).
- **Build command**: `npm run build`. ESLint is broken repo-wide (Next 16 removed `next lint`; ESLint v9 crashes on the legacy `eslint-config-next` config) — do not use `npm run lint`; tsc + build are the gates.
- **Dev server**: `npm run dev` (Next.js on :3000, proxies `/api/*` to the Django backend via BACKEND_PROXY_URL).
- **Tests**: `npm test` (vitest), `npm run test:e2e` (Playwright).
- **Locales**: Edit `lib/i18n/dictionaries/*.json` (ar.json, en.json, fa.json, ur.json). Locale always in URL path: `/[locale]/[route]`.
- **CopilotKit routes**: `/documents` (libraryAgent), `/documents/[id]` (readerAgent on the sidecar's `/reader` endpoint).
- **Auth**: JWT stored in HTTP-only cookies. `useAuth()` hook provides `user`, `isAuthenticated`, `login()`, `logout()`, `googleLogin()`.
- **Responsive**: Desktop breakpoint 1200px (`useIsDesktop()`). Parchment design tokens in Tailwind. Direction (`dir`) synced on `<html>` per locale.

### Testing Requirements
- **Gates**: `npx tsc --noEmit` and `npm run build` must pass before committing.
- **Do NOT run `next build` while a dev server is live** — they share `.next/`; the build refuses to start ("Another next build process is already running") yet may still exit 0. Verify with tsc + a curl against the dev server instead, or stop the dev server first.
- **Pre-existing vitest failures**: `lib/utils.test.ts` (1 failure) and `app/profile/page.test.tsx` (9 failures, "invariant expected app router to be mounted") fail on a clean tree. Confirm regressions by comparing against a clean tree, not raw pass/fail.
- **E2E smoke test**: `npm run test:e2e` (verifies landing page, auth flows).
- **Auth-gated pages**: `/documents` and the reader are behind RequireAuth — an unauthenticated curl only returns the auth shell. The `/auth/*` routes are public and fully SSR'd, so they can be verified with `curl -L`.

### Common Patterns
- **API calls**: Import from `@/lib/api` (main) or `@/lib/api/reader` (document-scoped). Use TanStack Query for caching.
- **i18n**: `useI18n()` hook for translations; locale in URL handled by middleware.
- **Auth guard**: Wrap pages in `<RequireAuth>`. Pass `requireUpload` for editor-only routes.
- **Parchment theme**: Use Tailwind tokens: `paper`, `paper-card`, `ink-deep`, `gold`, `gold-soft`, `maroon`, `green-deep`.
- **Reader shell**: 3-column layout (ToC, document, assistant) on desktop; collapsible on mobile. Font size + theme controls persisted via localStorage.
- **Avoid `@apply` for font utilities in shell scopes**: `@apply font-*` inside a scope that also defines `.font-*` rules causes a circular-dependency CssSyntaxError under Turbopack that only `next build` catches — inline the font-family declaration instead.

## Dependencies

### Internal
- `app/*` — App Router pages (layout, landing, auth flows, documents discovery, reader, map, profile, upload)
- `components/*` — Reusable UI: landing sections, auth panel, document filters, reader 3-column shell, search popover, i18n provider
- `lib/api*` — Django REST client and helpers (search, filters, reader annotations)
- `lib/i18n/*` — Locale config, dictionary loading, navigation helpers
- `lib/reader/*` — Reader state hooks (progress, highlights, notes, bookmarks, Copilot sessions)
- `hooks/*` — Shared hooks (media query, debounce, books facet source, reading stats)

### External
- **Next.js 16**: App Router, font optimization, image optimization
- **React 18**: Core UI library
- **Tailwind CSS 3.4**: Styling with custom parchment design tokens
- **CopilotKit**: AI-assisted library discovery and document annotation; routes to FastAPI sidecar (:8123)
- **TanStack Query 5**: Server state management, caching
- **Framer Motion**: Animations (fade-in, scroll-triggered reveals, live-dot pulse)
- **Lucide React**: Icon library
- **D3 Geo + React Simple Maps**: Interactive world map rendering
- **@ag-ui/client**: HttpAgent protocol for Copilot communication
- **TypeScript 5.x**: Type safety
- **Playwright**: E2E testing
- **Vitest**: Unit testing (jsdom environment)

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
