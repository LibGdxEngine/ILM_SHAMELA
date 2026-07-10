<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-03 | Updated: 2026-07-03 -->

# backend

## Purpose
The Django REST Framework backend for ILM Shamela, an Islamic digital library platform. Runs in a Docker container (`search_backend`) with PostgreSQL for data, Elasticsearch for full-text/semantic search, Redis for caching/task queues, and MinIO for S3-compatible document storage. Serves REST APIs for document search, user authentication (JWT + Google OAuth), reader chat/highlighting, and the CopilotKit library assistant. Includes a FastAPI sidecar (`agent_service/`) that exposes LangChain deepagents agents for both library discovery and in-book reading assistance.

## Key Files
| File | Description |
|------|-------------|
| manage.py | Django CLI entrypoint; routes to `ilm_shamela.settings` |
| Dockerfile | Python 3.11 slim image with PostgreSQL client, Java (Tika), Poppler, and all Python dependencies; runs `entrypoint.sh` on startup |
| entrypoint.sh | Waits for PostgreSQL readiness, validates env config, runs migrations, seeds default roles/superuser, collects static files, then starts server (dev: runserver, prod: gunicorn + 4 workers) or executes passed command (e.g. celery worker) |
| requirements.txt | All Python dependencies: Django 5.x, DRF, psycopg2, Celery, Redis, Elasticsearch, django-allauth (Google OAuth), dj-rest-auth (JWT), Tika, LangChain, deepagents, FastAPI (for agent sidecar) |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| core/ | User authentication, profiles, health checks, metrics, and middleware (see `core/AGENTS.md`) |
| search_engine/ | Document search (Elasticsearch), document upload/indexing, reader chat, highlighting, pagination — the core search/read flow |
| ilm_shamela/ | Django project package: settings, URL routing, Celery config, ASGI/WSGI (see `ilm_shamela/AGENTS.md`) |
| agent_service/ | FastAPI sidecar for CopilotKit deep agents: library discovery and in-book reading assistants on OpenRouter LLM (see `agent_service/AGENTS.md`) |
| migrations/ | Generated Django migration files; do not document individually |

## For AI Agents

### Working In This Directory
- **Run Django CLI commands via Docker**: `docker exec search_backend python manage.py <command>` (e.g. `migrate`, `shell`, `createsuperuser`)
- **Database**: PostgreSQL on host `db:5432` (env: `POSTGRES_HOST`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`); NOT accessible from host machine — all DB work goes through the container
- **Elasticsearch**: On host `es:9200` (env: `ELASTICSEARCH_HOST`); NOT accessible from host
- **Redis**: On host `redis:6379` (env: `REDIS_HOST`, `REDIS_PORT`)
- **Environment variables**: See `entrypoint.sh` for critical ones (`SECRET_KEY`, `POSTGRES_*`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, etc.)
- **Celery tasks**: Run async tasks via the Celery worker (spawned as separate service or manually via `docker exec search_backend celery -A ilm_shamela worker`)
- **FastAPI sidecar**: Runs on port 8123; started via `docker-compose` as the `agent` service (`uvicorn agent_service.main:app`)

### Testing Requirements
- **Backend tests**: `docker exec search_backend sh -c 'USE_SQLITE_FOR_TESTS=true python manage.py test'` (or `make test-backend` from the repo root). Container workdir is `/app` (the bind-mounted `backend/`), so app labels are `core`, `search_engine` — never prefix paths with `backend/`.
- **Scoped runs**: `... python manage.py test search_engine` or a dotted path like `search_engine.tests.test_reader_api`. There is no pytest config in this repo — use the Django test runner.
- **Host-side fallback** (container down): create a venv with `--system-site-packages`, install the missing deps (elasticsearch-dsl, django-elasticsearch-dsl, dj-rest-auth, django-allauth, langdetect, celery, redis, tika, django-storages, django-cors-headers, djangorestframework-simplejwt), then run `SECRET_KEY=test USE_SQLITE_FOR_TESTS=true SECURE_SSL_REDIRECT=false DEBUG=true python manage.py test`. Without `SECURE_SSL_REDIRECT=false` every test request 301-redirects (settings default it to `not DEBUG`).
- **No host-side Postgres/ES**: Tests that touch DB or Elasticsearch MUST run inside the container; ES/embedding calls are mocked in tests

### Common Patterns
- **Settings from env**: `os.environ.get('KEY', 'default')` or `env_bool()`, `env_list()` helper functions in `ilm_shamela/settings.py`
- **Structured JSON logging**: All logs go through a `JSONFormatter` that includes `request_id` (from `core.middleware.RequestIDMiddleware`) and contextual fields (user_id, document_id, task_id, etc.)
- **Request IDs**: Added to request/response headers (`X-Request-ID`) for distributed tracing; regenerated per request or passed via header
- **Prometheus metrics**: Emit via `core.metrics.increment_metric()`; export at `/api/metrics/` (admin-only)
- **Trailing-slash normalization**: `/api/*` requests get an in-place trailing slash append (not redirect) to work around Next.js dev-server proxy behavior
- **Custom User model**: `core.models.User` (extends Django `AbstractUser`); always use `get_user_model()` or import the concrete class
- **Google OAuth setup**: Run `python manage.py setup_google_oauth` (or automatically in entrypoint if env vars set) to seed the `SocialApp` record for allauth
- **Role-based access**: Default groups `reader`, `editor`, `admin` seeded by `python manage.py setup_roles`

## Dependencies

### Internal
- **core → search_engine**: Core serializers import `has_editor_privileges()` from `search_engine.permissions` to determine if a user can upload docs
- **agent_service → search_engine**: Agent tools directly import and call `execute_corpus_search()`, `search_within_document()`, and other search/ranking logic from `search_engine.views` and `search_engine.models`
- **ilm_shamela.urls → core, search_engine**: URL conf imports views from both apps

### External
- **Django 5.x**: Core framework (ORM, auth, middleware, admin, templating)
- **DRF (djangorestframework)**: Serializers, ViewSets, authentication, pagination, permissions, throttling
- **PostgreSQL (psycopg2-binary)**: Primary database
- **Elasticsearch 8.x + django-elasticsearch-dsl**: Full-text and semantic search indexing
- **Celery 5.x + Redis**: Async task queue (document indexing, chat reply generation, etc.)
- **django-allauth + dj-rest-auth + djangorestframework-simplejwt**: User registration, Google OAuth2, JWT auth (access + refresh token cookies)
- **Tika 2.6+**: PDF/document text extraction in search_engine indexing
- **LangChain + deepagents + CopilotKit + FastAPI + uvicorn**: Agent sidecar runtime
- **Gunicorn**: Production WSGI server (dev: Django runserver)

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
