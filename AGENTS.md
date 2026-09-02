<!-- Generated: 2026-07-03 | Updated: 2026-07-03 -->

# ILM_SHAMELA

## Purpose
ILM_SHAMELA is a full-stack document intelligence platform for Islamic manuscripts and scholarly texts. It enables authenticated users to upload, process, index, and search multilingual documents (Arabic, English, Farsi, Urdu) with semantic reranking, provides paginated reader views with in-document highlighting, and includes a CopilotKit-powered library-wide AI assistant. The architecture combines a Next.js frontend (reverse-proxied by Caddy) → Django REST backend running in Docker (with PostgreSQL, Elasticsearch, Redis, MinIO) → three OCR engines (Tesseract, Chandra, Docling) for text extraction → a FastAPI agent sidecar (port 8123) for deep-agent LLM turns.

## Key Files
| File | Description |
|------|-------------|
| `README.md` | Quick-start guide, API examples, testing commands, CI workflow reference. |
| `docker-compose.yml` | Complete service stack definition: 14 services (Postgres, Elasticsearch, Redis, MinIO, 3× OCR sidecars, Django backend, Celery worker, FastAPI agent, Next.js frontend, Caddy reverse proxy). Includes all environment passthrough and healthchecks. |
| `Makefile` | 40+ targets: stack lifecycle (`up`, `down`, `restart`), logs, shells, Django management (`migrate`, `superuser`, `reindex`), tests, frontend host dev, and public deployment profiles. |
| `.env.example` | Template for the non-secret environment: OCR engine URLs/langs, model slugs, Postgres/MinIO usernames, hosts/CORS, and frontend proxy URLs. Credentials live in `secrets/`, not here. |
| `secrets/` | File-backed Docker secrets (`django_secret_key`, `postgres_password`, `minio_root_password`, `google_client_secret`, and the Gemini/OpenRouter/Anthropic API keys). Gitignored; created by `make secrets`. See `secrets/README.md`. |
| `scripts/init-secrets.sh` | Idempotent generator for `secrets/*.txt`; seeds from `.env` when a credential is still defined there. |
| `package.json` | Root-level dependency: `react-simple-maps`. (Frontend and backend have separate package management.) |
| `.gitignore` | Excludes `.env*`, `secrets/*` (all but its README), build artifacts, node_modules, Caddy local TLS, `.claude/`. |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `backend/` | Django REST API application; runs in `search_backend` container. (see `backend/AGENTS.md`) |
| `frontend/` | Next.js UI application; runs in `search_frontend` container on port 3000. (see `frontend/AGENTS.md`) |
| `docs/` | Architecture, API, security, and operations documentation. (see `docs/AGENTS.md`) |
| `ocr_services/` | Three pluggable OCR engine sidecars (tesseract, chandra, docling) via FastAPI. (see `ocr_services/AGENTS.md`) |
| `caddy/` | TLS termination, reverse proxy, and routing rules. (see `caddy/AGENTS.md`) |
| `monkeyocr/` | Alternative GPU-accelerated OCR service (switchable via Dockerfile). (see `monkeyocr/AGENTS.md`) |

## For AI Agents

### Working In This Directory
- **Stack startup**: Always use `docker compose up -d --build` or `make up-build` — never manually start containers.
- **Backend management**: Access the running backend container via `docker compose exec search_backend bash` or `make shell-backend`; never run Django commands on the host machine.
- **Environment setup**: Copy `.env.example` to `.env` for non-secret config, then run `make secrets` to create the file-backed Docker secrets in `secrets/` — compose refuses to start without them. Omit OCR URLs if you want default in-Docker services.
- **Secrets**: Never add a credential to `docker-compose.yml` or `.env`. Add it to the top-level `secrets:` block, declare it on the services that need it, pass `<VAR>_FILE=/run/secrets/<name>`, and add the variable to both `SECRET_ENV_VARS` in `backend/ilm_shamela/env_secrets.py` and `SECRET_VARS` in `backend/load_secrets.sh` (a test asserts the two lists match).
- **Service health**: Check `/api/health/live/` and `/api/health/ready/` via `curl -k https://localhost/api/health/live/`. Caddy reverse-proxies these from backend:8000.
- **Logs**: Use `make logs`, `make logs-backend`, `make logs-frontend`, `make logs-caddy` — not `docker logs` directly.

### Testing Requirements
- **Backend tests**: `make test-backend` (runs `USE_SQLITE_FOR_TESTS=true python manage.py test` inside the backend container).
- **Frontend tests**: `make test-frontend` (vitest unit tests in the frontend container). Note: there are pre-existing failures in `lib/utils.test.ts` and `app/profile/page.test.tsx` — confirm regressions against a clean tree, not raw pass/fail.
- **Lint is broken**: `make lint` runs `npm run lint`, which fails environment-wide (Next 16 removed `next lint`; ESLint v9 crashes on the legacy config). Use `cd frontend && npx tsc --noEmit && npm run build` as the frontend gates instead.
- **Full integration**: Start stack with `make up-build`, then verify endpoints: `curl -k https://localhost/` (frontend), `curl -k https://localhost/api/health/live/` (backend health).
- **Smoke test**: `docker compose build` tests image layer caching without starting services.

### Common Patterns
- **Async processing**: Document uploads enqueue a Celery task (`process_document_task`) on the Redis broker; the `search_celery_worker` container processes it asynchronously.
- **Multi-language OCR**: Each OCR sidecar (tesseract, chandra, docling) supports Arabic, English, Farsi, Urdu via language packs or model options. The backend selects the engine via `OCR_DEFAULT_ENGINE` or explicit endpoint configuration.
- **Elasticsearch integration**: Documents are indexed as they complete processing; search queries use BM25 (lexical), kNN (semantic), or RRF (hybrid) ranking.
- **Caddy routing**: Static files (`/static/*`) → django staticfiles; Admin (`/admin*`) → django; API (`/api/*`) → django; everything else → Next.js frontend (SPA catch-all).
- **Agent sidecar**: The FastAPI service on port 8123 (container: `search_agent`) handles CopilotKit deep-agent LLM turns; the Next.js backend bridges `/api/copilotkit` to `http://agent:8123` via the `AGENT_SERVICE_URL` env var.
- **Production deployment**: Use `make deploy-public` or `make redeploy-public` with `--profile docling` to include the Docling OCR engine; Caddy obtains a Let's Encrypt cert for the configured domain.

## Dependencies

### Internal
- All services depend on `db` (PostgreSQL 15) for state.
- `backend`, `celery_worker`, and `agent` depend on `redis` for the Celery broker.
- `backend` and `celery_worker` depend on `es` (Elasticsearch 8.11.1) for indexing/search.
- `backend` and `celery_worker` depend on all OCR sidecars (tesseract required; chandra, docling optional) for text extraction.
- `celery_worker` depends on `backend` being started (for task definitions).
- `frontend` depends on `backend` (as `NEXT_PUBLIC_API_URL`) and `agent` (via `/api/copilotkit` handler).
- `caddy` depends on `backend`, `frontend`, and routes `/api/*` → backend, `/admin*` → backend, `/media/*` → backend, `/static/*` → staticfiles volume, everything else → frontend.

### External
- **OpenRouter API** (optional, via `OPENROUTER_API_KEY`): LLM chat backend for the reader's "المساعد الذكي" (Smart Assistant) tab. Defaults to `google/gemini-2.5-flash-lite`.
- **Gemini Embedding API** (optional, via `GEMINI_API_KEY`): Semantic embeddings for hybrid search reranking. If absent, semantic search returns degraded results.
- **Anthropic API** (optional, via `ANTHROPIC_API_KEY`): Fallback chat model for older code paths (mostly deprecated in favor of OpenRouter).
- **Google OAuth** (optional, via `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`): Third-party authentication.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
