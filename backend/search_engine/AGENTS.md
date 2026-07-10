<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-03 | Updated: 2026-07-03 -->

# search_engine

## Purpose
The `search_engine` app is the core module of ILM Shamela's Islamic digital library platform. It handles document lifecycle management (upload, OCR processing, embedding, indexing), corpus-wide search (Elasticsearch with hybrid lexical/semantic modes), reader functionality (pages, chapters, bookmarks, highlights, notes, reading progress), in-document search, and AI-powered chat (per-document assistant and library-wide assistant via CopilotKit agent sidecar). It integrates with OpenRouter LLMs, Elasticsearch for full-text and vector search, Celery for async tasks, and external OCR sidecars (Tika, Tesseract, Chandra, Docling).

## Key Files
| File | Description |
|------|-------------|
| `models.py` | Core ORM: Document, Author, Category, DocumentChunk, Highlight, Note, Bookmark, ReadingProgress, ChatSession, ChatMessage, LibraryChatSession, Chapter, SavedFilterPreset, TextCorrection, DocumentAlternateName, CountryDocumentCount. Defines Document lifecycle (pending→processing→succeeded/failed), OCR engine choice (auto/none/tesseract/chandra/docling), and embeddings storage. |
| `views.py` | Corpus search endpoints: DocumentListCreateView, DocumentDetailView, DocumentSearchView (4 modes: exact/semantic/hybrid/agent-routed), DocumentSearchAssistView (natural-language filter assistant), DocumentInDocumentSearchView (hybrid in-book search), DocumentSuggestionsView (auto-complete), DocumentStatusView, CountryDocumentStatsView. Implements multi_match_query with field boosts, ES filter pushdown, snippet extraction, RRF/BM25 reranking. |
| `views_reader.py` | Reader endpoints: DocumentChapterListView (TOC), HighlightViewSet, NoteViewSet, BookmarkViewSet, TextCorrectionViewSet, ReadingProgressUpsertView, ReaderPreferenceView, DocumentFilterPreferenceView, SavedFilterPresetViewSet, ContinueReadingView, NoteExportView. User-scoped read/write with isolation checks. |
| `views_chat.py` | Chat endpoints: ChatSessionListCreateView, ChatMessageListCreateView (SSE streaming), ChatSessionDetailView; LibraryChatSessionListCreateView, LibraryChatMessageListCreateView. Per-document RAG (full-doc vs retrieval over DocumentChunk embeddings), per-chunk vector search, agent tool calls (metadata, chapters, search), tool-call loop termination (max 3 rounds), citation extraction from Markdown links and `<cite>` tags. |
| `serializers.py` | Request/response serializers: DocumentSerializer, DocumentListSerializer, DocumentDetailSerializer (includes author/category nesting), AuthorSerializer, AuthorDetailSerializer, AuthorListSerializer, CategoryListSerializer, DocumentAlternateNameSerializer. File validation (max 25 MB docs, 10 MB covers, .pdf/.doc/.docx/.txt only). |
| `serializers_reader.py` | Reader serializers: HighlightSerializer, NoteSerializer, BookmarkSerializer, ReadingProgressSerializer, ReaderPreferenceSerializer, DocumentFilterPreferenceSerializer, SavedFilterPresetSerializer, ChapterSerializer (recursive nesting), TextCorrectionSerializer, ChatSessionSerializer, ChatMessageSerializer, LibraryChatSessionSerializer, LibraryChatMessageSerializer. Includes chat history filtering (max 20 messages), citation parsing. |
| `documents.py` | Elasticsearch DSL mapping: DocumentIndex registers Document model with fields (title, content, language, authors, categories, description, written_date, alternate_names, semantic_vector). Multi-field analyzers (standard + arabic). DenseVector field (dims=VECTOR_DIMENSIONS=3072). Automatic indexing disabled; manual control via Celery task. |
| `semantic.py` | Embedding layer via OpenRouter `google/gemini-embedding-2` (3072-dim vectors), wrapped through `langchain_openai.OpenAIEmbeddings`. Batch API calls with 0.1s delay, 8000-char input limit. Falls back to `[]` (disable semantic scoring) when API unavailable. Per-chunk and per-document embeddings. |
| `tasks.py` | Async document processing (Celery `@shared_task`): PDF page detection, text extraction via Tika (with OCR fallback), OCR engine selection + dispatch to sidecars, language detection, content splitting into pages, PDF thumbnail generation, DocumentChunk creation with embeddings, Document.semantic_vector backfill, ES indexing, error tracking + retry. |
| `keyword_expansion.py` | Corpus-grounded keyword suggestions via ES `significant_text` aggregation (JLH score) over Arabic-analyzed content. Feeds the library agent's "I don't know this term" fallback. Top-K terms from candidate documents found via lexical+semantic kNN; uses a sampler to bound cost. |
| `llm.py` | Shared OpenRouter chat-model factory: `make_openrouter_chat()` returns LangChain `ChatOpenAI` pointed at OpenRouter with attribution headers. Used by both reader chat and agent sidecar. |
| `agent_tools.py` | Single tool schema for chat agent: `search_in_document()` performs hybrid in-book search (0.60*lexical + 0.40*semantic blend). Closes document over the callable so LLM never supplies document ID. Returns ranked page snippets + total_matches count. |
| `ocr.py` | OCR engine registry: abstract `OCREngineClient` (HTTP client for sidecar `/parse` + `/health` endpoints). Supports Tika, Tesseract, Chandra, Docling. Registry entries keyed by env var (e.g., `TIKA_OCR_URL`). Handles layout-aware metadata passthrough (markdown, tables, bounding boxes). |
| `permissions.py` | Permission classes: `IsAuthenticatedReadOnlyOrEditor` (all read/safe for authenticated users, write only for editor/admin roles). Helper `has_editor_privileges()` checks superuser/staff/group membership. |
| `signals.py` | Django signals maintaining `CountryDocumentCount` denormalization: triggered by M2M author changes, author nationality updates, deletions. Keeps per-country document stats in sync. |
| `urls.py` | URL routing: `/documents/`, `/documents/<id>/pages/`, `/documents/<id>/chapters/`, `/documents/<id>/chat/sessions/`, `/documents/<id>/search/`, `/documents/search/`, `/documents/search/assist/`, `/library/chat/sessions/`, `/reader/bookmarks/`, `/reader/notes/`, `/reader/highlights/`, `/reader/preferences/`, etc. |
| `admin.py` | Django admin registration: AuthorAdmin, CategoryAdmin, DocumentAdmin (with Chapter/AlternateNameInline tabs), ChatSessionAdmin. Search, filter, and fieldset organization for bulk metadata maintenance. |
| `apps.py` | AppConfig; imports signals on `ready()` to register M2M and lifecycle handlers. |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `management/commands/` | Maintenance commands (see its AGENTS.md) |
| `tests/` | Test suite (see its AGENTS.md) |
| `migrations/` | Auto-generated Django ORM migrations (production read-only) |

## For AI Agents

### Working In This Directory
1. **Async tasks run in Docker**: Document processing, OCR, embedding, and ES indexing all run via Celery workers. Trigger with the `process_documents` management command. Monitor task state via Django ORM (`Document.processing_status`, `processing_error`, `processing_attempts`).
2. **Elasticsearch is external**: The index name is `documents` (from `DocumentIndex._index._name`). Use `connections.get_connection()` to get the ES client. Rebuild index with `python manage.py recreate_index --reindex`.
3. **Search modes have distinct code paths**: exact (BM25 multi_match), semantic (kNN + cosine), hybrid (0.60*lexical + 0.40*semantic), agent-routed (natural-language query to `set_library_filters` tool). Check the `DocumentSearchView` branching logic in `views.py`.
4. **Embeddings use OpenRouter**: 3072-dim vectors via `google/gemini-embedding-2`. Batch API with rate limiting (0.1s delay). Falls back to `[]` gracefully if `OPENROUTER_API_KEY` is unset or the API is unreachable.
5. **Reader data is user-scoped**: Highlights, notes, bookmarks, reading progress, and chat sessions all check `request.user` and return 403 on cross-user access. Always filter querysets by `user=request.user`.
6. **OCR engines are pluggable**: Each engine is an `OCREngineClient` (thin HTTP wrapper). To add a new engine: register it in `ocr.py` with a name and env-var URL, then set `Document.ocr_engine` at upload time.
7. **Chat streaming is SSE**: `ChatMessageListCreateView.post()` returns `StreamingHttpResponse` with `text/event-stream` MIME type. Events: `delta` (text chunks), `done` (message_id + citations), `error` (error text).
8. **Citation formats**: In-document chat stores citations as `<cite page="N">text</cite>`. The sidecar (CopilotKit reader agent) uses Markdown links `[label](#p-N)` which the client sanitizer strips; both are parsed for history consistency.

### Testing Requirements
Run all tests with:
```bash
docker exec search_backend sh -c 'USE_SQLITE_FOR_TESTS=true python manage.py test search_engine'
```
There is no pytest config in this repo — use the Django test runner with dotted paths (e.g. `... test search_engine.tests.test_document_search`). See `tests/AGENTS.md` for per-file coverage and mocking recipes.

Key fixtures:
- `User.objects.create_user()` for authenticated tests.
- `Document.objects.create()` with `content=` populated; use `split_document_content_into_pages()` to generate page chunks.
- Mock `connections.get_connection()` for ES tests (hand-build response dicts).
- Mock `build_embedding()` to avoid OpenRouter API calls.
- Mock `make_openrouter_chat()` for LLM tests.

### Common Patterns
- **Hybrid search scoring**: `0.60 * normalized_es_score + 0.40 * cosine_similarity(query_vec, chunk_vec)`. Implemented in `search_within_document()` and the corpus search path in `views.py`.
- **ES filter pushdown**: `build_es_filter_clauses()` mirrors `apply_document_filters()` to scope results at index time (preserves ranking). Authors excluded from ES push-down (text field lacks keyword sub-field); author filtering stays Django-side only.
- **Snippet extraction**: ES `highlight` with `<mark>` tags. Falls back to first N chars if highlight unavailable.
- **Graceful degradation**: If embedding API fails, vector search is skipped but lexical search continues (RRF fallback to BM25). Signal via `"degraded_reason": "embedding unavailable"` in response.
- **RRF license requirement**: Reciprocal Rank Fusion requires a non-basic Elasticsearch license. When the ES license is insufficient, BM25 is used as fallback automatically in `execute_corpus_search()`.
- **Per-request agent registry**: `build_tool_registry(document, user)` wraps `search_in_document()` with the document closed over. LLM never supplies document ID—only query.
- **Page-number tracking**: All text extraction preserves `page_number` (from `split_document_content_into_pages()`). DocumentChunk stores it; citations reference page number; reader UI jumps to page.
- **Language-agnostic indexing**: `DocumentIndex` has separate analyzers for standard and Arabic. Queried via multi_match with both fields. Language auto-detected during upload (`langdetect` library).

## Dependencies

### Internal
- `core.metrics`: increment_metric() for telemetry.
- `core.request_id`: set/reset request ID for distributed tracing.
- All models cross-reference each other (Document ↔ Author/Category M2M, Chapter ↔ Document FK, DocumentChunk ↔ Document FK, Highlight/Note/Bookmark/ChatSession ↔ Document + User FK).

### External
- **Elasticsearch**: Via `django-elasticsearch-dsl` and `elasticsearch-dsl` libraries. Index name: `documents`. Requires connectivity; fallback behavior depends on context (read-only: return empty results; writes: fail with 500).
- **Celery + Redis**: Async task queue for document processing. Task: `process_document_task(document_id)`.
- **OpenRouter**: LLM provider via `langchain_openai.ChatOpenAI`. Models configured by `OPENROUTER_CHAT_MODEL`, `OPENROUTER_AGENT_MODEL`, and embedding model `OPENROUTER_EMBEDDING_MODEL` (default: `google/gemini-embedding-2`).
- **OCR sidecars**: Tika, Tesseract, Chandra, Docling (external services listening on `/parse` + `/health` HTTP endpoints).
- **Django REST Framework**: Generics, viewsets, serializers, permissions, throttling.
- **Pillow / pdf2image**: Thumbnail and first-page PDF preview generation.
- **tika**: Fallback text extraction when PDF is image-heavy.
- **langdetect**: Language detection on content at upload.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
