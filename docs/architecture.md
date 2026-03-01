# Architecture

## Service Topology
- `frontend` (Next.js): UI and proxy for `/api/*` and `/media/*`.
- `nginx`: TLS termination and reverse proxy.
- `backend` (Django + DRF): API, auth, metadata, reader/search endpoints.
- `celery_worker`: async processing pipeline.
- `db` (PostgreSQL): source of truth for users/documents/metadata.
- `es` (Elasticsearch): document index for search.
- `redis`: Celery broker + result backend.
- `minio`: object storage for uploaded assets.

## End-to-End Flow
1. User uploads a document via frontend.
2. Backend stores file metadata in Postgres and file in object storage.
3. Backend enqueues `process_document_task`.
4. Worker extracts text/metadata, detects language, computes semantic vector.
5. Worker updates document processing state and indexes content in Elasticsearch.
6. Search endpoints query Elasticsearch, apply filters, and rerank with semantic similarity.
7. Reader endpoints split and serve content pages for the frontend viewer.

## Processing State Model
`Document.processing_status` values:
- `pending`
- `processing`
- `succeeded`
- `failed`

Complementary fields:
- `processing_error`
- `processing_attempts`
- `processing_started_at`
- `processing_completed_at`

## Observability
- Request correlation IDs via middleware.
- Structured JSON logs.
- Prometheus-style metrics at `/api/metrics/` (admin-only).
- Health checks:
  - `/api/health/live/`
  - `/api/health/ready/`
