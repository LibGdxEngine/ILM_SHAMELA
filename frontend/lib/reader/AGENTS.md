<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-03 | Updated: 2026-07-03 -->

# lib/reader

## Purpose
Reader-experience state management (bookmarks, highlights, notes, chat sessions, reading progress, preferences) and helper utilities. All hooks use TanStack Query (keys from `queryKeys.ts`) with CSRF-protected DRF API endpoints in `../api/reader.ts`. Also includes text-selection helpers (`selection.ts`), localStorage→API migration (`migrate.ts`), and chat-management hooks (`useChat.ts`, `useReaderCopilotSessions.ts`).

## Key Files
| File | Description |
|------|-------------|
| `queryKeys.ts` | Centralized TanStack Query cache keys: preferences, bookmarks(docId), notes(docId), highlights(docId), progress(docId), continueReading(), chapters(docId). All namespaced under 'reader' as const tuples. |
| `migrate.ts` | One-shot migration of legacy reader localStorage (doc_<id>_{bookmarks,notes}, reader_preferences) to the API; best-effort with console.warn on error, no throws. |
| `selection.ts` | DOM text-selection helpers: findPageRoot (walk to data-page), offsetWithinRoot (text offset via TreeWalker), paragraphIndexFor (count preceding `<br />`), getSelectionPayload (returns page_number, paragraph_id, char_start/end, text). Produces SelectionPayload anchors for highlights/notes. |
| `useBookmarks.ts` | React Query hook for document bookmarks; data[], isLoading, add/remove/update mutations with optimistic updates + revert on error. Temp negative IDs for pending entries. |
| `useChapters.ts` | Read-only query hook for the chapter tree (ApiChapter[]); includes findActiveChapter(tree, currentPage) walker; 5-min stale time. |
| `useChat.ts` | Full reader chat lifecycle: sessions + messages, streaming SSE consumer (pendingAssistantText), tool status labels, context scope, pinned context (ChatPin[]). Complex session/message/streaming state machine — read the file before modifying. |
| `useContinueReading.ts` | Read-only query for the continue-reading list (ApiContinueReading[], optional limit). |
| `useHighlights.ts` | React Query hook for color-tagged text highlights; add/remove/update with optimistic updates. Payloads include color, note, page_number, paragraph_id, char_start/end. |
| `useNotes.ts` | React Query hook for free-form notes anchored to pages/paragraphs; supports tags[] and timestamps. |
| `useReaderCopilotSessions.ts` | Owns ONLY the chat sessions list (messages live in the CopilotKit AG-UI thread). Sits above the CopilotKit provider so session.thread_id survives provider remount on session switch; exposes sessions, activeSession, context scope, pins, session management. Adapted from useChat.ts minus the streaming path. |
| `useReaderPreferences.ts` | Read/write hook for reader display settings (font_size, theme, font_weight, letter_spacing, line_height, tashkeel_enabled); optimistic patch + revert. |
| `useReadingProgress.ts` | Upsert hook for reading progress (last_page, timestamp) with leading+trailing debounce (5s): first save() fires immediately, subsequent calls queue a trailing fire. No GET endpoint; cache seeded by upsert results and the continue-reading list. |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `__tests__/` | Vitest test files. Currently: `queryKeys.test.ts` (readerKeys tuple shapes and 'reader' namespace). |

## For AI Agents

### Working In This Directory
- **Query keys**: Always import from `queryKeys.ts` for cache coherence. Keys are `as const` tuples; invalidate with `{ queryKey: readerKeys.bookmarks(docId) }`.
- **Selection payload**: For highlight/note UX, use `getSelectionPayload(...)` from selection.ts to compute page_number, paragraph_id, char_start/end, text — paired with `data-page` attributes.
- **Migration**: `migrateAllReaderLocalStorage()` is called once per signed-in session from AuthContext.tsx. Don't call manually.
- **Chat state machine**: useChat.ts manages bootstrap (load sessions → latest message batch), streaming (SSE parse + delta accumulation), session switch (reset state), pin/scope mutations (optimistic patch + ref-mirroring).
- **CopilotKit integration**: useReaderCopilotSessions.ts is intentionally split from message handling; the session object lives above the CopilotKit provider so remount on session switch doesn't lose it. Messages hydrate from Django inside the provider (ReaderAssistant component).

### Testing Requirements
```bash
cd frontend
npm test                        # all vitest tests
npm test -- queryKeys.test.ts   # single file
```
Vitest config: jsdom environment, globals enabled, setup in vitest.setup.ts, alias `@/` → project root.

### Common Patterns
- **Optimistic mutations**: All CRUD hooks follow onMutate (save previous, compute optimistic) → onError (revert) → onSettled (invalidate). Temp IDs are negative.
- **Async cancellation**: onMutate calls `cancelQueries({ queryKey })` to abort in-flight reads before updating local state, preventing races.
- **Ref mirroring**: useChat.ts and useReaderCopilotSessions.ts hold sessionRef/sessionsRef to serve fresh state to synchronous action handlers in the same tick, avoiding stale render closures.
- **TreeWalker selection**: selection.ts walks text nodes via `document.createTreeWalker(NodeFilter.SHOW_TEXT)` to compute character offsets robustly, unaffected by highlight `<mark>` wrapping.

## Dependencies

### Internal
- `lib/api/reader.ts` — All API types and fetch wrappers (ApiBookmark, ApiHighlight, ApiNote, ApiChatSession, etc.)
- `lib/reader/queryKeys.ts` — readerKeys for invalidation
- `lib/AuthContext.tsx` — useAuth hook for isAuthenticated check
- `lib/csrf.ts` — csrfHeaders() on writes

### External
- `@tanstack/react-query` — useQuery, useMutation, useQueryClient
- `@copilotkit/react-core` — CopilotKit chat internals (useChat.ts, useReaderCopilotSessions.ts)
- React 18 — hooks

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
