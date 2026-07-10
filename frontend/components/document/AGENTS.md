<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-03 | Updated: 2026-07-03 -->

# components/document

## Purpose
The three-column reading workspace (ReaderShell) and all reader-specific UI for `/documents/[id]`. Inline-start panel: AdvancedSearchPanel (in-document search) + AssistantColumn (AI chat). Center: DocumentViewer (paginated text + highlights) with parchment styling (DocumentPage). Inline-end: ReaderTOCColumn (table of contents + notes + stats + book info). Header: ReaderHeader (theme/font controls, bookmark, fullscreen). Supporting: reader shell context, note/highlight/tag management, selection interactions, find-bar, assistant I/O, and accessibility. **Not to be confused with `components/documents/` (plural) — the library discovery page.**

## Key Files
| File | Description |
|------|-------------|
| `ReaderShell.tsx` | Three-region layout context provider. Owns tocCollapsed state + toggleToc, manages side panel open/pinned state. Renders: header region, start column (search + assistant, docked or floating overlay), center viewport (DocumentViewer), end column (toc, collapsible). Desktop ≥1200px allows pinning; mobile always floats. |
| `DocumentPage.tsx` | Single page renderer. Handles tashkeel (Arabic diacritics) stripping for search, highlight range mapping, HTML escaping, text search matching. Renders page content with highlights baked in via dangerouslySetInnerHTML + search hits styled. |
| `DocumentViewer.tsx` | Paginated container. Infinite scroll / load-more. IntersectionObserver for visible-page tracking. Renders DocumentPage per page, skeletons while loading, error boundary. Passes highlights, search query, tashkeel state down. Click-to-search word extraction. |
| `ReaderHeader.tsx` | Top bar of reader. Book identity (title, author, series, cover), breadcrumb (current chapter). Font controls (size ±, weight, letter-spacing, line-height, tashkeel toggle). Theme picker (light/sepia/dark). Bookmark toggle. Search + fullscreen toggles. Link back to library. |
| `ReaderTOCColumn.tsx` | End column with 4 tabs: Chapters (ChapterTree), Notes (NotesToolPanel), Stats (ReadingStatsPanel), Book Info (ReaderInfoContent). Collapsing owned by ReaderShell. Shows book cover, identity, current page progress. Icon rail when collapsed. |
| `AssistantColumn.tsx` | AI chat drawer (forwardRef handle for external control — setDraft, addPin, ask). Wraps AssistantContextBar (page + pinned snippets), AssistantMessageList (chat history), AssistantInput (textarea + send). Suggested prompts (summarize, find, glossary, context). Docked or floating. Citation clicks jump to page. |
| `AssistantInput.tsx` | Autogrowing textarea + send button. Cmd/Ctrl+Enter to send. forwardRef for setDraft (pre-populate from selection). Streams from useChat hook. |
| `AssistantMessageList.tsx` | Chat history. Assistant messages rendered as Markdown (CopilotKit Markdown component) with inline citation chips; user messages plain text. Scroll-to-latest on new message. |
| `AssistantContextBar.tsx` | Sticky bar above chat showing current page + pinned text snippets (with page numbers). Click page number to jump. "Remove" button on each pin. |
| `AssistantSessionMenu.tsx` | Dropdown menu: create new session, load saved session, delete current session. Persisted to backend. |
| `ReaderAssistant.tsx` | High-level orchestrator for the assistant drawer. Owns the useChat hook state + session management. |
| `ChapterTree.tsx` | Recursive chapter list in the TOC. Active chapter highlighted. Click to jump. Indents nested chapters by depth. Uses Arabic numerals for arabic locale. |
| `NotesToolPanel.tsx` | Notes tab content. Shows user notes (sorted by page). Add note input, tag filtering, export (CSV/JSON via exportNotes API). Tags are user-defined chips. |
| `ReadingStatsPanel.tsx` | Stats tab content. Reading time, pages read, streak, estimated finish date. |
| `BookmarksToolPanel.tsx` | Bookmark list (pages user has marked). |
| `ReaderInfoContent.tsx` | Book info tab. Cover, full metadata (title, authors, language, file type, date added), description, related links. |
| `ReaderPanel.tsx` | Generic panel wrapper (shared styling/layout for start-column panels). |
| `PanelIconButton.tsx` | Icon button for panel controls (collapse, close, pin/unpin). |
| `FontThemeControls.tsx` | Theme selector (light/sepia/dark swatches) + font-size/weight/spacing sliders. Exports ReaderTheme type. |
| `SelectionPopover.tsx` | Floating menu when user selects text. Options: highlight (5 colors), "Ask AI", "Search". Triggers onCreateHighlight, onAskAssistant, onSearchSelection. Positioned via selection payload utility. |
| `HighlightTooltip.tsx` | Tooltip on highlight hover ("right-click to remove"). Portal'd into scroll container. Delegated mouseover/mouseout on `.highlight-mark` elements. |
| `SearchFindBar.tsx` | Browser-style in-document search. Input + match counter ("3 of 12"), prev/next buttons, toggle result list, close. Sticky at top-end of reader. On match, calls onGoToPage. |
| `SearchResultsList.tsx` | Expandable list of all search results below the find-bar. Click to jump to page + highlight match. |
| `AdvancedSearchPanel.tsx` | In-document search panel with facets, date range, saved searches. Fires document-level searches on filter change. |
| `AddNoteModal.tsx` | Modal to add/edit a note on a selection. Text area + highlight color picker. Save/cancel. |
| `TagChipInput.tsx` | Tag input for note tags. Chips for current tags, auto-suggest from existing tags, add new. |
| `SimilarWordsModal.tsx` | Glossary/thesaurus modal. Shows word definition + related terms. Triggered by "Define key terms" assistant action. |
| `ReportErrorModal.tsx` | Modal for reporting OCR/rendering errors. Fields: description, error type. Submits to backend (TextCorrection). |
| `DocumentPageSkeleton.tsx` | Skeleton matching DocumentPage layout. Used while pages load. |
| `ReadingProgressBar.tsx` | Progress indicator showing current page / total pages. Updates on scroll. |
| `readerToolsTypes.ts` | Shared TypeScript types for reader panels (Note, Highlight, Tag, etc.). |

## For AI Agents

### Working In This Directory
- **ReaderShell context**: useReaderShell() exposes tocCollapsed, toggleToc, panelOpen, panelPinned, togglePanelPin, search state. All panels read this context to stay in sync.
- **Selection → AI**: SelectionPopover calls onAskAssistant with selected text; AssistantColumn's forwardRef handle (`ask` method) receives it and sends to useChat.
- **Page jumping**: onPageVisible fires when a page enters viewport (updates currentPage). onGoToPage (from SearchFindBar, ChapterTree, citation clicks) scrolls to a specific page.
- **Highlights lifecycle**: onCreateHighlight → POST highlight, returns ID. HighlightTooltip listens for mouseover on `.highlight-mark` + right-click context menu to delete. Highlights are baked into DocumentPage's dangerouslySetInnerHTML.
- **Notes + tags**: NotesToolPanel calls onAddNote / onDeleteNote. Tags stored as strings on the note; TagChipInput filters/autocompletes from existing user tags.
- **Tashkeel (diacritics)**: DocumentPage builds a char-index mapping to keep search + highlight offsets correct when diacritics are toggled off. Tashkeel state persisted to localStorage (ReaderHeader owns the toggle).
- **Theme + font state**: ReaderHeader persists theme/font settings to localStorage. FontThemeControls returns ReaderTheme (light/sepia/dark) + numeric values.
- **Fullscreen mode**: ReaderShell's fullscreen prop hides TOC + all panels. Toggled by ReaderHeader.

### Testing Requirements
- **Gates**: `npx tsc --noEmit` and `npm run build` from `frontend/` before commit.
- **Visual verification**: Open a reader page (`/documents/[id]`, requires login) and check: parchment styling + theme swatches; TOC tabs toggle without remounting (assistant chat state persists); text selection shows SelectionPopover with highlight colors + AI/search options; highlights render, hover shows tooltip, right-click deletes; find-bar searches in-document and jumps pages; assistant sends messages and renders markdown with citation chips; font controls persist across reload; bookmark toggle; fullscreen hides panels.
- **Search + scroll**: In-document search jumps to the right page; assistant citations scroll to cited pages.

### Common Patterns
- **Infinite scroll**: DocumentViewer uses IntersectionObserver on the last page element to trigger onLoadMore, with skeletons while batch-loading.
- **Text processing**: DocumentPage's tashkeel mapping keeps selection offsets, highlights, and search matches consistent; all text is HTML-escaped before injection.
- **Portal usage**: SelectionPopover, HighlightTooltip, AddNoteModal use createPortal to escape overflow clipping.
- **Delegated events**: HighlightTooltip uses delegated mouseover/mouseout + right-click listeners on `.highlight-mark` elements, since highlights are injected HTML, not React nodes.
- **Ref forwarding**: AssistantColumn uses forwardRef + useImperativeHandle to expose setDraft, addPin, ask so the parent page can trigger assistant actions from selections.
- **Scope**: AdvancedSearchPanel is in-document only; library filters live in `components/documents/FilterSidebar`.

## Dependencies

### Internal
- `lib/api.ts` — Document, DocumentPage, DocumentSearchResponse types; document fetching.
- `lib/api/reader.ts` — ApiHighlight, ApiChapter, Note, Tag; highlight/note/tag CRUD endpoints.
- `lib/reader/useChat.ts` — AI conversation + SSE streaming.
- `lib/reader/selection.ts` — selection payload computation (page/paragraph/char offsets).
- `lib/reader/useHighlights.ts` and sibling hooks — reader-state CRUD + caching.
- `lib/utils.ts` — toLocaleDigits, formatRelativeDate.
- `lib/i18n/` + `components/i18n/I18nProvider.tsx` — translations, locale + direction context.
- `hooks/useIsDesktop.ts` — docking vs floating decisions in ReaderShell.
- `components/search/NavSearchPopover.tsx` — in-reader search nav.
- `readerToolsTypes.ts` — local types.

### External
- **framer-motion** — AnimatePresence, motion for panel animations + fullscreen transitions.
- **@copilotkit/react-ui** — Markdown component for assistant responses.
- **@tanstack/react-query** — chapters, reading stats queries.
- **next/navigation** — useRouter for navigation.
- **react** — context for ReaderShell state; createPortal for overlays.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
