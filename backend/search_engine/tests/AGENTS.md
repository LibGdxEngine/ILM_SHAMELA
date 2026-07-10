<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-03 | Updated: 2026-07-03 -->

# tests

## Purpose
Comprehensive test suite for the search_engine app, covering authentication, API endpoints, search modes, reader functionality, chat, keyword expansion, OCR, serialization, and async tasks. Tests use Django's `TestCase` and DRF's `APITestCase` with mocked external dependencies (Elasticsearch, embeddings, LLM).

## Key Files
| File | Description |
|------|-------------|
| `test_api_auth.py` | Authorization & permission enforcement. Verifies read-only access for authenticated users, write access restricted to editor/admin roles. Tests `IsAuthenticatedReadOnlyOrEditor` permission class, group membership checks, document upload/edit/delete gates. |
| `test_document_search.py` | Corpus-wide search endpoint (`/documents/search/`) covering all 4 search modes: exact (BM25 multi_match), semantic (kNN), hybrid (0.60*lexical + 0.40*semantic), agent-routed (natural-language query). Tests ES response mocking, filter pushdown (documents/categories/language/dates), snippet extraction, degraded-reason signal, RRF vs BM25 reranking. Patches `connections.get_connection()` and `build_embedding()`. |
| `test_in_document_search.py` | In-document search (`/documents/<id>/search/`) with mode branching by thresholds. Tests lexical-only, semantic-only, hybrid, and disabled modes. Mocks `_es_lexical_stage()` and embedding to exercise branching logic and score blending deterministically. |
| `test_keyword_expansion.py` | Keyword suggestion helper (`suggest_alternative_keywords`) via Elasticsearch `significant_text` aggregation. Tests aggregation parsing, field fallback (content.arabic → content), query term exclusion, RRF metadata shape, BM25 fallback when RRF unavailable. Mocks ES aggregation responses. |
| `test_reader_api.py` | Reader endpoints (bookmarks, notes, highlights, reading progress, preferences, filter persistence). Tests owner isolation (user_a cannot see user_b's data), unique constraints, upsert semantics (ReadingProgressUpsertView idempotency). Verifies 401/403 on unauth/cross-user access. |
| `test_library_chat.py` | Library-wide chat sessions (`/library/chat/sessions/`). Tests idempotent session creation by `thread_id` (repeated POSTs with same thread_id return the existing session). Message append by `client_id` (also idempotent). No LLM involved; purely data persistence. |
| `test_search_assist.py` | Natural-language search assistant (`/documents/search/assist/`). Tests tool selection, facet resolution against DB (author/category/language exact matching), fold-back of unresolved guesses into free text, value sanitization. Mocks `make_openrouter_chat()` to inject deterministic tool calls. |
| `test_tasks.py` | Async document processing task (`process_document_task`). Tests file parsing, OCR fallback selection, language detection, content splitting into pages, thumbnail generation, DocumentChunk creation with embeddings, ES indexing, error tracking. Mocks `build_embedding()` and `DocumentIndex`. |
| `test_ocr.py` | OCR engine client (`OCREngineClient`). Tests HTTP `/parse` and `/health` request/response handling, layout-aware metadata passthrough (markdown, tables, bounding boxes), error cases (unavailable engines, API errors). Mocks `requests.post()`. |
| `test_serializer_validation.py` | File upload validation on `DocumentSerializer`. Tests extension whitelist (.pdf, .doc, .docx, .txt), rejects unsupported types (.exe, etc.). Verifies size limits (25 MB documents, 10 MB covers). |
| `test_settings.py` | Configuration assertions. Verifies dj_rest_auth throttle rates are configured, REST_FRAMEWORK defaults are set. Smoke test for settings consistency. |

## For AI Agents

### Working In This Directory
There is **no pytest config** in this repo — use the Django test runner (dotted paths, not file paths):
1. **Run all search_engine tests**: `docker exec search_backend sh -c 'USE_SQLITE_FOR_TESTS=true python manage.py test search_engine'`
2. **Run one module**: `... python manage.py test search_engine.tests.test_document_search`
3. **Run one class/method**: `... python manage.py test search_engine.tests.test_reader_api.HighlightApiTests.test_owner_isolation`
4. **Verbosity**: append `-v 2` for per-test names.
5. **Host-side fallback** (container down): see `backend/AGENTS.md` — venv with `--system-site-packages`, plus `SECRET_KEY=test USE_SQLITE_FOR_TESTS=true SECURE_SSL_REDIRECT=false DEBUG=true`; without `SECURE_SSL_REDIRECT=false` every request 301-redirects and assertions fail with `301 != 200`.

### Testing Requirements
All test classes inherit from Django's `TestCase` (transaction rollback between tests) or DRF's `APITestCase` (client fixture + force_authenticate). Key setup patterns:

**Authentication Tests**:
```python
self.user = User.objects.create_user(username='...', password='...')
self.client.force_authenticate(user=self.user)  # or None to clear
```

**Model Fixtures**:
```python
self.doc = Document.objects.create(title='...', file='...', content='...')
self.author = Author.objects.create(name='...')
self.doc.authors.add(self.author)
```

**Elasticsearch Mocking**:
```python
@mock.patch('search_engine.views.connections.get_connection')
def test_foo(self, mock_conn):
    mock_conn.return_value.search.return_value = {'hits': {'hits': [...]}}
```

**Embedding Mocking**:
```python
@mock.patch('search_engine.semantic.build_embedding', return_value=[0.1] * 3072)
```

**LLM Mocking** (for `make_openrouter_chat`):
```python
@mock.patch('search_engine.llm.make_openrouter_chat')
def test_foo(self, mock_chat_factory):
    mock_chat = mock.Mock()
    mock_chat.bind_tools.return_value.invoke.return_value = SimpleNamespace(
        tool_calls=[{'name': 'tool_name', 'args': {...}, 'id': '1', 'type': 'tool_call'}]
    )
    mock_chat_factory.return_value = mock_chat
```

### Common Patterns
- **Raw ES response building**: helpers construct `{'hits': {'hits': [...]}}` dicts with document IDs, scores, and highlights, avoiding live ES.
- **Graceful fallback testing**: When embedding fails, tests expect ES-only (BM25) results. When RRF fails due to license, tests expect BM25 fallback.
- **Owner isolation**: Reader tests verify cross-user querysets come back empty, then force_authenticate as the other user to confirm 403 or empty response.
- **Pagination**: Reader tests verify paginated responses respect limits. Chat tests verify message history capping (max 20 messages).
- **Transaction rollback**: TestCase/APITestCase auto-roll back each test; no manual cleanup needed.
- **Override settings**: Tests use `@override_settings(MEDIA_ROOT='/tmp/...')` to avoid writing real files during test runs.

## Dependencies

### Internal
- `search_engine.models`: All model fixtures (Document, Author, User, etc.).
- `search_engine.views` / `views_reader` / `views_chat`: View classes under test.
- `search_engine.serializers`: Serializer validation tests.
- `search_engine.tasks`: Celery task tests.
- `search_engine.keyword_expansion`: Keyword suggestion logic.
- `search_engine.ocr`: OCR client logic.

### External
- **Django TestCase & APITestCase**: Test base classes with DB transactions and HTTP client.
- **unittest.mock**: Patch, Mock, MagicMock for mocking external APIs.
- **Django REST Framework test utilities**: `APITestCase`, `APIClient`, `force_authenticate`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
