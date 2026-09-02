# Operations Runbook

## Common Commands

### Create secrets (required before the first start)
```bash
make secrets          # or: bash scripts/init-secrets.sh
```
Idempotent; never overwrites an existing `secrets/*.txt`. Compose refuses to
start if any secret source file is missing.

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

## Secret Rotation

Secrets are files in `./secrets/`, mounted at `/run/secrets/<name>`. To rotate:

```bash
printf '%s' 'new-value' > secrets/<name>.txt
docker compose up -d backend celery_worker agent
```

`printf`, not `echo` — a trailing newline corrupts an API key sent in an HTTP
header. Both loaders strip surrounding whitespace as a safety net.

Per-secret notes:
- `django_secret_key` — rotating invalidates every active session and JWT
  (`SIGNING_KEY` is derived from it). Expect all users to be logged out.
- `postgres_password` — the password is baked into the `postgres_data` volume
  at first initialisation. Changing the file alone does **not** change the
  database. Rotate with `ALTER USER ... WITH PASSWORD` inside the running
  container first, then update the file and restart `backend`,
  `celery_worker`, and `agent`.
- `minio_root_password` — same volume caveat as postgres, via `minio_data`.
- API keys (`gemini`, `openrouter`, `anthropic`, `google_client_secret`) — no
  stored state; restart the consuming services and the new value is live.

### Migrating an existing deployment off `.env`

`scripts/init-secrets.sh` seeds each missing secret file from the matching
variable still present in `.env`, so credentials carry over unchanged and the
existing `postgres_data` volume keeps working. Run `make secrets`, confirm the
stack comes up, then delete the migrated lines from `.env`. If a secret file is
created *before* `.env` is read — or with a different value than the volume was
initialised with — `backend` will fail to connect to the database.

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
