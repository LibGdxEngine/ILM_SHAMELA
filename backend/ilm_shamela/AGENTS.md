<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-03 | Updated: 2026-07-03 -->

# backend/ilm_shamela

## Purpose
Django project configuration and routing. Defines settings (database, auth, logging, Elasticsearch, Celery, CORS, JWT, email, etc.); maps URLs to views; configures Celery for async tasks; and provides ASGI/WSGI entry points for async and sync application servers.

## Key Files
| File | Description |
|------|-------------|
| settings.py | **Core Django config**: DEBUG, ALLOWED_HOSTS, SECRET_KEY (required), INSTALLED_APPS (core, search_engine, dj-rest-auth, allauth, rest_framework, django-elasticsearch-dsl, corsheaders, etc.). **Database**: PostgreSQL (or SQLite if `USE_SQLITE_FOR_TESTS=true`). **Auth**: Custom User model, ModelBackend + allauth, JWT cookies, Google OAuth. **Elasticsearch**: DSL config with retry logic. **Celery**: Redis broker/backend. **REST Framework**: JWT auth, throttling (anon 20/min, user 200/min, upload 30/hr, search 600/hr). **CORS**: Allow localhost:3000, configurable via env. **Logging**: JSON formatter with request IDs. **Email**: Console backend in DEBUG, SMTP in production. **Google OAuth**: Scopes=[profile, email], access_type=online. **Middleware**: trailing slash, request ID, CORS, session, auth, CSRF. |
| urls.py | **URL routing**: `/api/search_engine/*` → search_engine.urls; `/api/auth/registration/` → dj-rest-auth registration; `/api/auth/google/` → core.GoogleLogin; `/api/auth/user/` → core.UserProfileView; `/api/auth/*` → dj-rest-auth main routes; `/api/health/live/`, `/api/health/ready/`, `/api/metrics/` → core health/metrics views; `/admin/` → Django admin. Media files served in DEBUG and via nginx alias in production. |
| celery.py | Celery app config: sets `DJANGO_SETTINGS_MODULE`, loads config from Django settings with `CELERY_` prefix, autodiscovers tasks from all apps. Includes a dummy `debug_task` for testing. |
| asgi.py | ASGI application entry point for async servers (e.g. Daphne); calls `get_asgi_application()`. |
| wsgi.py | WSGI application entry point for sync servers (Gunicorn); calls `get_wsgi_application()`. |
| __init__.py | Celery app import for shared_task registration. |

## For AI Agents

### Working In This Directory
- **Modify settings**: Environment variables take precedence (see `env_bool()`, `env_list()` helpers). Add new settings as env-gated with sensible defaults; document the env var name.
- **Add URL routes**: Edit `urls.py`; follow the pattern of prefixing app routes (`api/search_engine/`, `api/auth/`, etc.). Keep admin and health check routes flat.
- **Celery tasks**: Define in app-level `tasks.py` or `views.py`; they auto-discover and register when the app starts.
- **Port 8000**: Django listens on all interfaces (0.0.0.0:8000) by default.
- **Proxy headers**: `SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')` trusts X-Forwarded-Proto from reverse proxy (Caddy); only set `SECURE_SSL_REDIRECT` if behind HTTPS proxy.

### Testing Requirements
- **No project-level tests**: Integration tests live in individual apps (e.g. `core/tests/`, `search_engine/tests/`)
- **Test settings**: Can override via `DJANGO_SETTINGS_MODULE=ilm_shamela.test_settings` if a separate test settings file exists; currently uses the main settings file with `USE_SQLITE_FOR_TESTS=true`

### Common Patterns
- **Environment variable extraction**: `os.environ.get('KEY', default)` or `env_bool('KEY', default)` or `env_list('KEY', [default, list])`
- **Required env vars**: `SECRET_KEY` raises `ImproperlyConfigured` if missing
- **Database config**: All four vars must be set for production PostgreSQL; tests can use SQLite via env flag
- **Elasticsearch host auto-prefixing**: If `ELASTICSEARCH_HOST` env var doesn't start with `http://` or `https://`, `http://` is prepended
- **JWT token lifetimes**: Access 60 min, Refresh 1 day; rotation enabled, old tokens blacklisted
- **CORS origins**: Defaults to localhost:3000; fully configurable via `CORS_ALLOWED_ORIGINS` and `CORS_ALLOWED_ORIGIN_REGEXES` env vars; allow all with `CORS_ALLOW_ALL_ORIGINS=true`
- **Throttling tiers**: Separate rates for anon, user, upload, search, reader_progress; all 429 on limit
- **Trailing slash**: Normalized by middleware in-place before URL resolution (no redirect)

## Dependencies

### Internal
- **core.middleware, core.logging, core.metrics**: Imported in settings (MIDDLEWARE, LOGGING, custom handlers)
- **core.models.User**: Set as `AUTH_USER_MODEL`
- **core.serializers**: Custom serializers referenced in `REST_AUTH` config
- **search_engine**: Installed app, URLs included
- **All installed apps**: Auto-discover management commands, migrations, tasks

### External
- **Django 5.x**: Core ORM, middleware, URL routing, settings
- **DRF**: REST framework config
- **Celery + Redis**: Task broker and result backend
- **Elasticsearch + django-elasticsearch-dsl**: Search indexing and queries
- **django-allauth + dj-rest-auth**: OAuth and JWT auth
- **django-cors-headers**: CORS middleware
- **Gunicorn**: Production WSGI server (4 workers, 120s timeout)
- **PostgreSQL**: Primary database connection

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
