<!-- Parent: ../../AGENTS.md -->
<!-- Generated: 2026-07-03 | Updated: 2026-07-03 -->

# management/commands

## Purpose
Django management commands for document lifecycle, index maintenance, and batch operations. Run via `docker exec search_backend python manage.py <command>`.

## Key Files
| File | Description |
|------|-------------|
| `process_documents.py` | Queue unprocessed documents for Celery task processing. **Usage**: `python manage.py process_documents [--all | --document-id N]`. No args lists unprocessed docs. `--all` queues all pending documents. `--document-id N` queues a specific document (idempotent; skips if already processed). Task: `process_document_task.delay(document_id)`. |
| `extract_chapters.py` | Extract chapter/TOC rows by scanning document content for headings. Detects HTML (`<h1>…<h3>`), Markdown (`# …`), and all-caps lines. Nests h1→h2→h3 hierarchy. **Usage**: `python manage.py extract_chapters [--document-id N | --all] [--replace] [--dry-run]`. `--replace` deletes existing chapters before insert. `--dry-run` reports without writing. Returns `(level, title)` tuples, ordered by document page. |
| `recreate_index.py` | Delete and recreate the Elasticsearch index, then re-index all processed documents. **Usage**: `python manage.py recreate_index [--delete-only | --create-only] [--reindex]`. `--delete-only`: delete index only, exit. `--create-only`: skip delete, create index. `--reindex`: after index creation, queue all processed documents for re-indexing via Celery. Handles ES library version differences gracefully (tries DSL first, falls back to direct API). |
| `reembed_documents.py` | Backfill semantic vectors (Document.semantic_vector + DocumentChunk.embedding) for processed documents using the OpenRouter embedding API. **Usage**: `python manage.py reembed_documents [--only-stale] [--document-id N] [--skip-chunks] [--dry-run] [--delay SECS]`. `--only-stale`: only re-embed documents/chunks whose vector dim ≠ VECTOR_DIMENSIONS (useful after model switch). `--document-id N`: re-embed single document + chunks. `--skip-chunks`: re-embed Document.semantic_vector only. `--delay SECS`: sleep between API calls (default 0.1). Requires `OPENROUTER_API_KEY`. |
| `retry_failed_documents.py` | Re-queue documents with processing_status=failed for retry. **Usage**: `python manage.py retry_failed_documents [--limit N]` (default 100). Orders by upload time; queues up to N documents via Celery. |

## For AI Agents

### Working In This Directory
1. **Docker context**: All commands run inside the `search_backend` container. Invoke with `docker exec search_backend python manage.py <command>`.
2. **Async task queueing**: `process_documents` and `retry_failed_documents` queue Celery tasks; they return immediately. Monitor actual processing via `Document.processing_status` (pending → processing → succeeded/failed) and check `processing_error` field for failure details.
3. **Elasticsearch state**: `recreate_index` manipulates the live index. Always take a backup or test on a staging environment first. `--delete-only` is destructive; `--reindex` re-processes all documents.
4. **API rate limits**: `reembed_documents` and `extract_chapters` can be long-running. Use `--dry-run` on `reembed_documents` to estimate cost (OpenRouter API calls cost tokens).
5. **Idempotency**: `extract_chapters --document-id N` skips documents that already have chapters (unless `--replace` is set). `process_documents --document-id N` skips if already processed. Safe for cron or repeated invocation.

### Testing Requirements
Test commands with small datasets first:
```bash
# List unprocessed docs (no side effects)
docker exec search_backend python manage.py process_documents

# Dry-run chapter extraction
docker exec search_backend python manage.py extract_chapters --document-id 1 --dry-run

# Dry-run re-embed
docker exec search_backend python manage.py reembed_documents --document-id 1 --dry-run

# Related test suite (Django test runner; no pytest config in this repo)
docker exec search_backend sh -c 'USE_SQLITE_FOR_TESTS=true python manage.py test search_engine.tests.test_tasks'
```

### Common Patterns
- **Dry-run pattern**: Commands accept `--dry-run` to preview changes without writing. Use for safety before bulk operations.
- **Selective processing**: `--document-id N` or `--all` flags allow single-doc or bulk processing. Default behavior (no args) is list-only.
- **Error handling**: Check `Document.processing_error` field and `processing_attempts` counter. `retry_failed_documents` re-queues; the task auto-retries with exponential backoff configured in Celery settings.
- **Progress tracking**: Long operations (re-embed, recreate index) write to stdout. Capture logs via `docker exec ... <command> 2>&1 | tee logfile.txt`.

## Dependencies

### Internal
- `search_engine.models`: Document, DocumentChunk, Chapter.
- `search_engine.tasks`: process_document_task (Celery shared_task).
- `search_engine.documents`: DocumentIndex (Elasticsearch DSL registry).
- `search_engine.semantic`: build_embedding, build_batch_embedding, VECTOR_DIMENSIONS.
- `search_engine.utils`: split_document_content_into_pages.

### External
- **Django management framework**: BaseCommand, CommandError.
- **Elasticsearch**: `django_elasticsearch_dsl` and `elasticsearch_dsl` for index operations.
- **Celery**: `.delay()` async task queueing.
- **OpenRouter API**: `reembed_documents` makes HTTPS calls via `build_embedding()` (wrapped in `langchain_openai`).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
