# API Reference (Core)

Base path: `/api/`

## Authentication
- `POST /auth/login/`
- `POST /auth/logout/`
- `GET /auth/user/`
- `PATCH /auth/user/` (authenticated user updates own profile fields)
- `POST /auth/registration/`
- `POST /auth/google/`

### Profile update payload (`PATCH /auth/user/`)
- Allowed writable fields:
  - `name` (alias; splits into `first_name` + `last_name`)
  - `first_name`
  - `last_name`
  - `email`
  - `avatar` (URL string)
  - `current_password` + `new_password` + `new_password_confirm` (all three required for password change)
- Read-only fields:
  - `pk`
  - `username`

All `search_engine` endpoints require authenticated users.

## Documents
- `GET /search_engine/documents/`
- `POST /search_engine/documents/` (editor/admin)
- `GET /search_engine/documents/{id}/`
- `PATCH /search_engine/documents/{id}/` (editor/admin)
- `DELETE /search_engine/documents/{id}/` (editor/admin)
- `GET /search_engine/documents/{id}/status/`
- `GET /search_engine/documents/{id}/pages/?page=1&page_size=5`
- `GET /search_engine/documents/{id}/search/?q=...`

### PDF-overlay mode (OCR layout)
- `POST /search_engine/documents/` accepts an optional `ocr_layout` file — a
  datalab/marker OCR JSON with per-block bounding boxes. Only valid alongside a
  `.pdf` `file` (max size `MAX_OCR_LAYOUT_FILE_SIZE_MB`, default 50 MB). When
  present, processing skips Tika/OCR, builds page text + geometry from the
  JSON, and renders each PDF page to a WebP image.
- Document detail/list responses expose read-only `has_layout`.
- For `has_layout` documents, each entry in the `pages/` response additionally
  carries:
  - `image_url`: rendered page image (`/media/documents/pages/{doc_id}/…`)
  - `layout`: `{width, height, blocks: [{id, type, bbox: [x0,y0,x1,y1], text,
    char_start, char_end}]}` — offsets index into the page `content`
    (block texts joined by `\n`), and `bbox` is in the `width`×`height`
    coordinate space.
- `GET /search_engine/documents/search/?q=...&mode=exact|semantic|hybrid&documents=<comma-ids>`
- `GET /search_engine/documents/suggest/?q=...`

### Corpus search (`GET /search_engine/documents/search/`)
- `q` (required): free-text query.
- `mode` (optional, default `hybrid`): `exact` (BM25 only), `semantic` (kNN only),
  or `hybrid` (BM25 + kNN fused with RRF). An invalid value returns `400`.
- `documents` (optional): comma-separated document ids to scope the search to
  (pushed into the Elasticsearch filter so relevance is computed within scope).
- Also accepts the shared filters `authors`, `categories`, `language`,
  `date_from`, `date_to` (all except `authors` are pushed into Elasticsearch).

### Search response additions
Each result can include:
- `score_lexical` (`null` in `semantic` mode)
- `score_semantic` (`null` in `exact` mode)
- `score_final`
- `snippet` (first highlighted fragment; typically `null` in `semantic` mode)
- `explanations.matched_fields`
- `explanations.method` (`bm25` | `knn` | `rrf+knn`)

When `mode=semantic` is requested but embeddings are unavailable, the response is
an empty result set with a top-level `degraded_reason: "embedding_unavailable"`.

## Authors and Categories
- `GET /search_engine/authors/`
- `GET /search_engine/authors/{id}/`
- `GET /search_engine/categories/`

## Library Assistant Chat
Durable, per-user transcript for the library-wide CopilotKit assistant. These
sessions are **document-less** (the agent researches the whole catalogue). The
deep-agent sidecar owns the LLM turn over AG-UI, so Django never calls a model —
these endpoints only persist the history that hydrates the CopilotKit thread on
reload. All require authentication and are scoped to the current user.

- `GET /search_engine/library/chat/sessions/` — list the user's sessions (most
  recently updated first). Each: `{id, thread_id, title, created_at, updated_at, message_count}`.
- `POST /search_engine/library/chat/sessions/` — body `{thread_id, title?}`.
  **Idempotent** by `(user, thread_id)`: returns `201` for a new row or `200`
  with the existing row. `thread_id` is the CopilotKit/AG-UI thread id.
- `GET /search_engine/library/chat/sessions/{session_id}/` — retrieve one.
- `PATCH /search_engine/library/chat/sessions/{session_id}/` — rename (`{title}`).
- `DELETE /search_engine/library/chat/sessions/{session_id}/` — delete (cascades
  to messages).
- `GET /search_engine/library/chat/sessions/{session_id}/messages/` — messages in
  chronological order. Each: `{id, client_id, role, content, created_at}`.
- `POST /search_engine/library/chat/sessions/{session_id}/messages/` — bulk-persist
  already-produced turns. Body `{messages: [{client_id, role, content}, ...]}`.
  **Idempotent** by `(session, client_id)`; derives the session title from the
  first user message and bumps `updated_at`. Returns `{title, messages: [...]}`.

## Operations
- `GET /health/live/`
- `GET /health/ready/`
- `GET /metrics/` (admin-only)
