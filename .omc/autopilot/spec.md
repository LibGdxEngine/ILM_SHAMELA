# Reader Experience — Autopilot Spec

**Scope:** Phases 0, 1, 2, 3, 6 of the Reader Experience plan. Phases 4 (TTS) and 5 (Translation) are deferred — they require provider/cost decisions.

**Defaults locked in:**
- Frontend data layer: `@tanstack/react-query` v5
- PDF export: **deferred** — Markdown export ships now; PDF needs Dockerfile system deps (Pango/Cairo) that are out of scope for this autopilot run. UI shows Markdown-only; no broken PDF button.
- DB migrations: run against dev DB (`python manage.py migrate`)
- Backend: Django 5 + DRF + Celery + Redis (already in stack)
- Frontend: Next.js 14 App Router, React 18, TypeScript, Tailwind 3, Vitest

**Critic-applied fixes (2026-04-17):**
- All non-GET reader API calls **must** include `X-CSRFToken` header (DRF SessionAuthentication enforces CSRF). A shared `getCsrfToken()` helper is extracted from `auth.ts:157-169`.
- `Note.id` widens to `string | number`; all `onDeleteNote`/`onDeleteBookmark` props update; comparisons normalize via `String(id)`.
- Dedicated throttle scope `reader_progress: 30/min` for the progress upsert endpoint; client debounces at 5s with leading+trailing semantics.
- localStorage migration runs **globally** on first authenticated app mount (sweeps all `doc_*` keys + `reader_preferences`), not only when a specific document is opened.
- `ContinueReadingView` annotates response with `total_pages` (computed from `Document.content` page-split util).

---

## Phase 0 — Backend foundation (user-scoped data)

### 0.1 New models in `backend/search_engine/models.py`

```python
from django.conf import settings  # AUTH_USER_MODEL = 'core.User'

class ReaderPreference(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                                related_name='reader_preference')
    font_size = models.CharField(max_length=10, default='medium')   # 'small'|'medium'|'large'
    theme = models.CharField(max_length=10, default='light')        # 'light'|'sepia'|'dark'
    font_weight = models.PositiveSmallIntegerField(default=400)     # 300..700
    letter_spacing = models.FloatField(default=0.0)                 # em (-0.05..0.10)
    line_height = models.FloatField(default=1.8)                    # 1.4..2.4
    tashkeel_enabled = models.BooleanField(default=True)            # show Arabic diacritics
    extra = models.JSONField(default=dict, blank=True)              # forward-compat
    updated_at = models.DateTimeField(auto_now=True)

class Bookmark(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                             related_name='bookmarks')
    document = models.ForeignKey(Document, on_delete=models.CASCADE,
                                 related_name='bookmarks')
    page_number = models.PositiveIntegerField()
    paragraph_id = models.CharField(max_length=64, blank=True, default='')
    label = models.CharField(max_length=200, blank=True, default='')
    tags = models.JSONField(default=list, blank=True)               # list[str]
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [['user', 'document', 'page_number']]
        indexes = [models.Index(fields=['user', 'document'])]
        ordering = ['document', 'page_number']

class Note(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                             related_name='notes')
    document = models.ForeignKey(Document, on_delete=models.CASCADE,
                                 related_name='notes')
    page_number = models.PositiveIntegerField()
    paragraph_id = models.CharField(max_length=64, blank=True, default='')
    body = models.TextField()
    tags = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [models.Index(fields=['user', 'document'])]
        ordering = ['-updated_at']

class Highlight(models.Model):
    COLORS = [('yellow','yellow'),('green','green'),('blue','blue'),
              ('pink','pink'),('orange','orange')]
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                             related_name='highlights')
    document = models.ForeignKey(Document, on_delete=models.CASCADE,
                                 related_name='highlights')
    page_number = models.PositiveIntegerField()
    paragraph_id = models.CharField(max_length=64)
    char_start = models.PositiveIntegerField()
    char_end = models.PositiveIntegerField()
    color = models.CharField(max_length=10, choices=COLORS, default='yellow')
    note = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=['user', 'document']),
                   models.Index(fields=['document', 'page_number'])]
        ordering = ['document', 'page_number', 'char_start']

class ReadingProgress(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                             related_name='reading_progress')
    document = models.ForeignKey(Document, on_delete=models.CASCADE,
                                 related_name='reading_progress')
    last_page = models.PositiveIntegerField(default=1)
    last_paragraph_id = models.CharField(max_length=64, blank=True, default='')
    scroll_ratio = models.FloatField(default=0.0)        # 0..1 within page
    percent_complete = models.FloatField(default=0.0)    # 0..1 of book
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [['user', 'document']]
        indexes = [models.Index(fields=['user', '-updated_at'])]
```

**Note on `paragraph_id`:** Frontend will derive it deterministically from page content (e.g. `p{pageNumber}-{paragraphIndex}`) — no model change to `DocumentChunk` needed for Phases 0-3+6. Highlights store this string verbatim. (Cross-document anchoring via DocumentChunk hashing is out of scope here.)

### 0.2 Serializers — new file `backend/search_engine/serializers_reader.py`

`ReaderPreferenceSerializer`, `BookmarkSerializer`, `NoteSerializer`, `HighlightSerializer`, `ReadingProgressSerializer`. Each ModelSerializer; user is set server-side from `request.user`, never accepted from client.

### 0.3 Views — new file `backend/search_engine/views_reader.py`

```
ReaderPreferenceView         GET, PATCH    /api/search_engine/reader/preferences/
BookmarkViewSet              ModelViewSet  /api/search_engine/reader/bookmarks/
NoteViewSet                  ModelViewSet  /api/search_engine/reader/notes/
HighlightViewSet             ModelViewSet  /api/search_engine/reader/highlights/
ReadingProgressUpsertView    PATCH         /api/search_engine/reader/progress/<doc_id>/
ContinueReadingView          GET           /api/search_engine/reader/continue/?limit=8
NoteExportView               GET           /api/search_engine/reader/notes/export/?document=<id>&format=md|pdf
```

- All require `IsAuthenticated`.
- Querysets filtered by `user=request.user`. Object-level checks via `get_queryset`.
- Filtering: bookmarks/notes/highlights accept `?document=<id>` query param.
- Throttle scope: `'search'` for GETs, `'user'` for writes; `'reader_progress'` (new scope, `30/min`) on `ReadingProgressUpsertView`. Add the new scope to `DEFAULT_THROTTLE_RATES` in `backend/ilm_shamela/settings.py`.
- `ContinueReadingView` response includes `total_pages` per item (computed via `split_document_content_into_pages(doc.content)` length, cached per request).

### 0.4 URL wiring in `backend/search_engine/urls.py`

Use DRF `DefaultRouter` for the three ModelViewSets; append the rest as `path()` entries.

### 0.5 Migration

Single migration `0012_reader_data.py`. Run via `python manage.py migrate` after model creation.

### 0.6 Backend tests in `backend/search_engine/tests/test_reader_api.py`

Cover: unauthenticated 401, owner isolation (user A can't read user B's data), bookmark unique constraint, progress upsert, export endpoint returns `text/markdown` + `application/pdf` with non-empty body, tag round-trip.

### 0.7 Backend dependency

**No new backend deps.** Markdown export is built with stdlib f-strings/templating only. PDF export deferred — Dockerfile lacks Pango/Cairo and adding them is out of scope for this autopilot run. The `NoteExportView` only accepts `format=md`; passing `format=pdf` returns 400 with a clear "PDF export not yet available" message. UI does not surface a PDF option.

---

## Phase 1 — Frontend foundation (data layer)

### 1.1 Dependencies (`frontend/package.json`)

Add `@tanstack/react-query@^5`. No other runtime deps.

### 1.2 Provider in `frontend/app/layout.tsx`

Wrap inside `AuthProvider`:
```tsx
<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
```
`queryClient` instantiated in a new client component `frontend/lib/queryClient.tsx` so SSR doesn't choke.

### 1.3 New API helpers in `frontend/lib/api/reader.ts`

**CSRF requirement:** Every non-GET helper MUST include `X-CSRFToken` header read from the `csrftoken` cookie (DRF SessionAuthentication enforces CSRF). Extract `getCsrfToken()` from `frontend/lib/auth.ts:157-169` into a shared `frontend/lib/csrf.ts` and import from both modules.

Typed wrappers + Zod-free TS types matching backend serializers:
```
listBookmarks(documentId), createBookmark(payload), deleteBookmark(id), updateBookmark(id, patch)
listNotes(documentId), createNote(payload), updateNote(id, patch), deleteNote(id)
listHighlights(documentId), createHighlight(payload), deleteHighlight(id), updateHighlight(id, patch)
getReaderPreferences(), updateReaderPreferences(patch)
upsertReadingProgress(documentId, payload)
listContinueReading(limit)
exportNotes(documentId, format)  // returns Blob
```
All include `credentials: 'include'` and CSRF header on writes (factor `csrfHeaders()` helper).

### 1.4 Reader resource hooks in `frontend/lib/reader/`

- `useBookmarks(documentId)` → `{data, add, remove, update, isLoading}` with optimistic updates
- `useNotes(documentId)` → similar
- `useHighlights(documentId)` → similar
- `useReaderPreferences()` → global, single object
- `useReadingProgress(documentId)` → `{data, save}`; `save` is a debounced mutation (5000ms)
- `useContinueReading(limit?)` → query
- All mutations call `queryClient.setQueryData` synchronously then reconcile on settle.

### 1.5 LocalStorage migration shim — `frontend/lib/reader/migrate.ts`

**Two-tier migration to catch all legacy data, not just current document:**

**Tier 1 — Global sweep, runs once per logged-in user:**
On first authenticated mount of the app (in `AuthContext` after `getUser()` succeeds), if `localStorage.getItem('reader_migrated_all_v1') !== '1'`:
1. Scan `localStorage` keys matching `/^doc_(\d+)_(bookmarks|notes)$/`.
2. For each match, parse JSON; if non-empty, POST entries to the API in a `Promise.allSettled` batch.
3. Backend dedupes bookmarks via `unique_together(user, document, page_number)` — duplicates return 400 and are ignored client-side.
4. Read `localStorage.reader_preferences` (used by `page.tsx:42`); if present, PATCH to `/reader/preferences/`.
5. On success of the whole batch, set `localStorage.setItem('reader_migrated_all_v1', '1')`. Old keys are NOT deleted (offline fallback preserved).

**Tier 2 — Per-document fallback:**
On first authenticated mount of the reader for a `documentId` (after the global sweep has run), if `localStorage.getItem('reader_migrated_v1_' + id) !== '1'`, retry just that document's keys (covers the case where Tier 1 was interrupted).

Both tiers are best-effort: failures log to console and do not block the UI.

---

## Phase 2 — Bookmarks/Notes sync + tags + Markdown/PDF export

### 2.1 Wire panels to API

In `frontend/app/documents/[id]/page.tsx`:
- Replace local `useState<Bookmark[]>` and `useState<Note[]>` + the localStorage effects (lines 107–110, 418–458) with `useBookmarks(documentId)` / `useNotes(documentId)`.
- Replace `handleAddNote`, `handleDeleteNote`, `handleToggleCurrentBookmark`, `handleRemoveBookmark` with hook mutations.
- Trigger `migrateReaderLocal(documentId)` once on mount.

### 2.2 Update prop shapes

Extend `frontend/components/document/readerToolsTypes.ts`:
```ts
export interface Bookmark { id?: number; page: number; createdAt: number; tags: string[]; label?: string; }
export interface Note { id: string | number; page: number; content: string; createdAt: number; tags: string[]; }
```

**Type-widening propagation (must update everywhere):**
- `NotesToolPanel.tsx:11`: `onDeleteNote: (id: string | number) => void`
- `ReaderBottomBar.tsx`: `onDeleteNote` prop signature widens
- `page.tsx:364` `handleDeleteNote(id: string | number)` and the API hook receives the same.
- All ID comparisons normalized via `String(a) === String(b)` since legacy localStorage IDs are strings (`Date.now().toString()`) and new API IDs are integers.

Backwards-compat: API returns `body` for note text → adapt at API layer to `content` (or rename uses).

### 2.3 Tag chip UI

New `frontend/components/document/TagChipInput.tsx` — input + comma-separated chip list. Used in:
- `BookmarksToolPanel.tsx` (above the bookmark grid, filters bookmarks by selected tag)
- `NotesToolPanel.tsx` (above input, attaches tags to new note; clickable chip filter)

### 2.4 Export button

Add an export button at the top of `NotesToolPanel.tsx`:
- Single button "Export as Markdown" (PDF deferred — see 0.7).
- Calls `exportNotes(documentId, 'md')`, downloads via `URL.createObjectURL` + temporary `<a download>`.
- Disabled when `notes.length === 0`.

### 2.5 i18n keys

Add to all 4 dictionaries (`ar.json`, `en.json`, `fa.json`, `ur.json`):
```
reader.tags, reader.addTag, reader.tagFilter, reader.export, reader.exportMarkdown, reader.exportFailed
```

### 2.6 Tests

- `frontend/components/document/BookmarksToolPanel.test.tsx`: tag filter shows only matching bookmarks, add tag persists.
- `frontend/components/document/NotesToolPanel.test.tsx`: export button calls `exportNotes`, tag chips render.

---

## Phase 3 — Resume + Continue Reading shelf

### 3.1 Resume on document open

In `frontend/app/documents/[id]/page.tsx`:
- After document + first batch loaded, if `useReadingProgress(documentId).data?.last_page` exists AND no `?page=` URL param, scroll to that page (use existing `handleGoToPage`).
- Show toast: "Resumed from page N — start over?" with action to scroll to top. Use the existing `ReaderBottomBar` toast pattern.

### 3.2 Save progress

In the existing `setVisiblePageNum` flow (line 100): debounce-call `useReadingProgress(documentId).save({last_page: visiblePageNum, percent_complete: visiblePageNum/totalPages})` every 5s when `visiblePageNum` changes.

### 3.3 Continue Reading shelf on home

New component `frontend/components/ContinueReadingShelf.tsx`:
- Renders only for authenticated users (`useAuth().isAuthenticated`).
- Calls `useContinueReading(8)`.
- Horizontal scroll row of cards (reuse cover styling from `BookCard.tsx`).
- Each card: cover, title, author, "{percent}% read · page {n} of {total}" subtitle.
- Click → `/{locale}/documents/{id}` (uses `useLocalizedPath`).

Mount in `frontend/app/page.tsx`: insert just below the hero search section (after the AI demo strip, before the "values" section is fine), wrapped in a `border-t` block to match the rest of the landing page rhythm.

### 3.4 i18n keys

```
reader.resumedFromPage, reader.startOver, home.continueReading, home.percentRead, home.pageOfTotal
```

### 3.5 Tests

- `ContinueReadingShelf.test.tsx`: returns null when not authenticated, renders cards from mock data.

---

## Phase 6 — Diacritics toggle + typography controls

### 6.1 Strip tashkeel client-side

In `frontend/components/document/DocumentPage.tsx`, before passing `content` to `highlightText`, conditionally strip diacritics:
```ts
const TASHKEEL = /[\u064B-\u065F\u0670]/g;
const visibleContent = tashkeelEnabled ? content : content.replace(TASHKEEL, '');
```
`tashkeelEnabled` flows down from `useReaderPreferences` via the page → DocumentViewer → DocumentPage prop chain.

### 6.2 Extend `FontThemeControls.tsx`

Add three new sections (only render extras when there is enough vertical room — they always render but inside a small `<details>` "Advanced" disclosure to keep the popover tight):
- Tashkeel toggle (switch, only shown when document language is `ar`)
- Letter-spacing slider (`-0.05em` to `0.10em`, step `0.005em`, default `0`)
- Line-height slider (`1.4` to `2.4`, step `0.05`, default `1.8`)
- Font-weight buttons (300, 400, 500, 700)

Update prop signature; persist to `useReaderPreferences().update(patch)`.

### 6.3 Apply via CSS variables

In the document scroll container (page.tsx ~line 583), set CSS vars on `style`:
```
--reader-letter-spacing, --reader-line-height, --reader-font-weight
```
In `DocumentPage.tsx` content `<div>`:
```
style={{ fontSize: '...', letterSpacing: 'var(--reader-letter-spacing)',
         lineHeight: 'var(--reader-line-height)',
         fontWeight: 'var(--reader-font-weight)' }}
```

### 6.4 i18n keys

```
reader.tashkeel, reader.letterSpacing, reader.lineHeight, reader.fontWeight,
reader.advanced
```

### 6.5 Tests

- `FontThemeControls.test.tsx`: tashkeel toggle visible only for ar; sliders update preferences.

---

## Cross-cutting

### Migration strategy for existing localStorage users
- On first authenticated reader load post-deploy, push localStorage data to API once (Phase 1.5 shim). Old keys remain so existing offline state isn't lost.

### Server-time vs client-time
- Notes' `createdAt` from API is ISO string; frontend converts to `Date.parse` for the `number` shape used in existing components. Single conversion at the API layer.

### ID changes
- Existing local Notes use `Date.now().toString()`. New backend Notes use integer PKs. The `Note.id` type widens to `string | number`. Components compare with `===` already, so no change needed beyond the type.

### Optimistic update reconciliation
- Mutation onMutate snapshots cache; onError rolls back; onSettled invalidates the query. Standard TanStack pattern.

### Out of scope (explicit deferrals)
- Phase 4 (TTS) — needs provider decision.
- Phase 5 (translation) — needs API key + provider decision.
- PDF export (Phase 2.4) — needs Pango/Cairo system deps in Dockerfile.
- Adding `paragraph_id` to `DocumentChunk` — only needed for cross-doc semantic anchoring; current scope uses string-derived IDs (`p${pageNumber}-${paragraphIndex}`).
- Highlights re-anchoring after document re-OCR — `Highlight.char_start/char_end` are tied to the current page text; if `Document.content` changes, existing highlights may misalign. Acceptable known limitation.

### Phase 2 (Highlights) — IS in scope this run
The highlights model + serializer + viewset + URL are part of Phase 0/1 foundation. The reader-side selection toolbar + deep-link rendering are Block F. Highlights ship with the rest of this autopilot.

---

## Acceptance criteria (verified in Phase 4)

1. Bookmarks/notes/highlights/preferences round-trip via API; survive logout+login.
2. Reading position persists across reload; "continue reading" shelf shows last 8 books.
3. Tashkeel toggle removes/restores diacritics in Arabic content live.
4. Typography sliders apply changes live and persist across reload.
5. Tag filter narrows bookmark/note list.
6. Markdown export downloads a valid `.md` with all notes for a document.
7. PDF export either downloads a valid PDF or returns 503 with i18n'd UI message.
8. User A's data is invisible to user B (backend test + manual verify).
9. All existing reader tests still pass; lint + typecheck + build green.
10. No regressions to existing search/upload/profile flows.
