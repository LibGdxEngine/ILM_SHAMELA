<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-03 | Updated: 2026-07-03 -->

# components/documents

## Purpose
The "Reading Room" library discovery page (/documents) and all discovery-specific UI. Includes the hero section (LibraryHero), topic shortcuts (ReadingRoomTopicBar), the main filter sidebar (FilterSidebar with facet pickers, date range, saved presets), the books grid/carousel (Shelf, ContinueShelf, BookSpine), the bespoke library AI assistant (LibraryAssistant — a headless CopilotKit drawer replacing the default popup), and in-page search tools (SearchCommandPalette, AssistantSessionMenu for library chat sessions). **Not to be confused with `components/document/` (singular) — the in-book reader.**

## Key Files
| File | Description |
|------|-------------|
| `FilterSidebar.tsx` | Left sidebar with faceted search. Status segment pills, language/category/author facets with search, date range picker, saved filter presets (save/apply/delete), "Clear All" button. Calls onToggleCategory, onToggleLanguage, onToggleAuthor, onDateFromChange, etc. on the parent documents page. |
| `FacetTypeahead.tsx` | Server-backed autocomplete for categories and authors. Typing queries fetchItems (debounced), shows live matches from the full DB, not just the current page. Selection by name (compatible with URL params). Reused by FilterSidebar for both authors and categories. |
| `DatePickerField.tsx` | Inline date picker (from/to). Trigger button, popped calendar with day cells, month/year navigation. Styling from filterTokens (parchment palette). |
| `filterTokens.tsx` | Shared design tokens for filter UI: pill colors (PILL_ON/PILL_OFF), input styles (FACET_INPUT_CLASS), date-picker trigger/popover classes, calendar day-cell class function. Colors are Reading Room parchment/gold literals (no Tailwind tokens). |
| `LibraryAssistant.tsx` | Bespoke, on-brand replacement for CopilotKit's default popup. Gold khatim-star launcher (fixed-position inline-end/bottom corner) opens a full-height edge drawer (Framer Motion slide). Headless via `useCopilotChat()` so the backend path (/api/copilotkit → FastAPI agent) stays untouched. Markdown rendering, session menu, fully RTL-aware. |
| `LibraryHero.tsx` | Top section of Reading Room. Book/topic count + headline + subtext + CTA. States: empty (no books), growing (<10 books), established (10+). Reem Kufi font, parchment colors. |
| `ReadingRoomTopicBar.tsx` | Chip row for "Browse by topic" — real categories from the backend (getCategories). Clicking toggles category filter (server-side refetch). Selected topics always visible; default limit 9. |
| `ContinueShelf.tsx` | Carousel of recently read books, scoped to the /documents page. Uses Shelf wrapper. |
| `Shelf.tsx` | Generic section wrapper: eyebrow + title + action button. Children grid (MD: 2 cols, LG: 4 cols) or mobile horizontal scroll. |
| `BookSpine.tsx` | Compact vertical book representation. Spine (thin) or cover (wide). Used in narrow layouts or carousels. |
| `SearchCommandPalette.tsx` | Quick search modal (Cmd+K) for jump-to-book. Input + live list of matching documents. Keyboard nav (↑/↓/Enter). |
| `AssistantSessionMenu.tsx` | Dropdown to create/load/delete library chat sessions (counterpart of the reader's session menu, scoped to the documents page). |

## For AI Agents

### Working In This Directory
- **Facet filtering**: FilterSidebar is fully controlled — it receives facet values and fires onToggle* callbacks; the parent documents page owns state and refetches via React Query.
- **URL persistence**: Filter state is encoded in URL params (e.g. `?category=...&language=ar`). FacetTypeahead selections update the URL via parent callbacks.
- **Saved presets**: Preset dropdown calls onSavePreset/onApplyPreset/onDeletePreset (backend CRUD via the filter-presets API). Presets include status, facets, date range.
- **Library assistant**: LibraryAssistant is a headless drawer using `useCopilotChat()` to talk to /api/copilotkit → FastAPI libraryAgent sidecar (:8123, OpenRouter LLM). The page's useCopilotAction handlers stay untouched. Use the messageText() utility to extract plain text from CopilotKit messages.
- **Reading Room theming**: Filter/hero/assistant colors are hardcoded Reading Room palette values (from filterTokens.tsx) so fixed-position elements (the drawer) match the shell regardless of DOM ancestry.
- **Infinite scroll**: The documents grid infinite-scrolls; FilterSidebar's onClearAll resets state + refetches the first page.

### Testing Requirements
- **Gates**: `npx tsc --noEmit` and `npm run build` from `frontend/` before commit.
- **Live verification** (requires login — /documents is auth-gated): facets load and toggle filters (documents refetch); date picker updates results; save/load/delete presets; topic chips toggle category filters; LibraryAssistant launcher opens the drawer, messages send, Escape/outer-click closes; ContinueShelf shows recently read; Cmd+K palette with keyboard nav; RTL layout (Arabic/Farsi) — drawer slides from the correct edge, direction correct.
- **Search performance**: FacetTypeahead debounce is ~300–400ms; verify no excessive network requests while typing.

### Common Patterns
- **React Query caching**: FacetTypeahead uses keepPreviousData so switching facets doesn't cause jank.
- **Parchment palette**: All filter UI hardcodes Reading Room colors from filterTokens.tsx (explicit hex, not Tailwind tokens).
- **Framer Motion in LibraryAssistant**: Direction-aware slide-in (RTL slides from the right), staggered message animations, AnimatePresence for mount/unmount.
- **Server-backed facet search**: FacetTypeahead queries the server for matches so users can filter by any category/author in the DB, not just what's loaded.
- **Session persistence**: AssistantSessionMenu saves the session to the backend; reloading restores chat history.

## Dependencies

### Internal
- `lib/api.ts` — Document types, getAuthors, getCategories.
- `lib/api/documentFilters.ts` — SavedFilterPreset type; filter preset CRUD endpoints.
- `lib/documents/useLibraryChat.ts` — library assistant hook (CopilotKit wrapper); messageText() utility.
- `lib/documents/useAssistantDock.ts` — drawer position/visibility state.
- `lib/i18n/languageName.ts` — language names in the current locale.
- `lib/utils.ts` — toLocaleDigits.
- `lib/i18n/` + `components/i18n/I18nProvider.tsx` — translations + direction.
- `components/landing/StarMark.tsx` — khatim star logo (reused in the LibraryAssistant launcher).
- `filterTokens.tsx` — shared design token constants.

### External
- **framer-motion** — drawer slide, message stagger.
- **@copilotkit/react-ui / react-core** — Markdown rendering, useCopilotChat.
- **@tanstack/react-query** — facet typeahead + shelf data.
- **next/navigation** — command palette navigation.
- **react** — createPortal for drawer positioning.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
