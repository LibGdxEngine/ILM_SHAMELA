# Operations Runbook

## Common Commands

### Start stack
```bash
docker compose up --build
```

### Re-run failed processing jobs
```bash
docker compose exec -T backend python manage.py retry_failed_documents --limit 100
```

### Validate runtime configuration
```bash
docker compose exec -T backend python manage.py check_config
```

## Health and Readiness
- Liveness: `/api/health/live/`
- Readiness: `/api/health/ready/`

Readiness checks currently validate:
- Database connectivity
- Elasticsearch connectivity

## Metrics
- Endpoint: `/api/metrics/`
- Access: admin/staff user
- Format: Prometheus plaintext

Current exported metrics include:
- `http_requests_total`
- `http_request_duration_ms_sum`
- `http_request_duration_ms_count`
- `document_processing_success_total`
- `document_processing_failure_total`
- `document_processing_retries_total`

## Failure Handling
- Processing retries use exponential backoff on transient failures.
- Terminal failures are persisted in document state (`processing_status=failed`).
- Dead-letter requeue is manual via `retry_failed_documents` command.
