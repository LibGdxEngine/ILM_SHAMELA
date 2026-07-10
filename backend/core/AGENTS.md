<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-03 | Updated: 2026-07-03 -->

# backend/core

## Purpose
User authentication, profiles, and platform infrastructure. Handles JWT + Google OAuth login/registration via dj-rest-auth and allauth; custom user model; profile endpoints for read/update with password change; health checks (liveness, readiness) with database and Elasticsearch probes; Prometheus metrics export; and middleware for request ID correlation and API trailing-slash normalization.

## Key Files
| File | Description |
|------|-------------|
| models.py | Custom `User` model extending Django's `AbstractUser` with `created_at`, `updated_at` timestamps |
| admin.py | Register `User` model with Django admin |
| apps.py | App config |
| serializers.py | **CustomLoginSerializer**: email/password validation with friendly errors (checks for usable password, account active status). **CustomRegisterSerializer**: email + first/last name. **CustomUserDetailsSerializer**: profile fields + name alias + password change + avatar support (Google social account picture or dedicated field). **UserProfileSerializer**: dedicated GET/PATCH endpoint for authenticated user profile updates. |
| views.py | **UserProfileView**: DRF `RetrieveUpdateAPIView` for `/api/auth/user/` (get/patch profile); **GoogleLogin**: Google OAuth2 adapter with account linking (auto-merge existing users by email, update/create SocialAccount). |
| views_health.py | **LivenessView** (`/api/health/live/`): always 200 OK. **ReadinessView** (`/api/health/ready/`): probes PostgreSQL + Elasticsearch; returns 200 if all ready, 503 otherwise. **MetricsView** (`/api/metrics/`): admin-only Prometheus text format export. |
| logging.py | **RequestIDFilter**: attaches request ID to log records. **JSONFormatter**: compact structured JSON logs with timestamp, level, logger, request_id, message, and context fields (user_id, document_id, task_id, etc.). |
| middleware.py | **APITrailingSlashMiddleware**: appends trailing slash to `/api/*` in-place (no redirect) before URL resolution to preserve POST bodies. **RequestIDMiddleware**: generates or reads `X-Request-ID` header, attaches to request, measures latency, emits Prometheus metrics (http_requests_total, http_request_duration_ms). |
| request_id.py | Context variable (`_request_id_var`) for thread-safe request ID storage; `get_request_id()`, `set_request_id()`, `reset_request_id()` utilities. |
| metrics.py | Thread-safe metric accumulation: `increment_metric(name, value, **labels)` → `export_prometheus_metrics()` as text format. Used by middleware and views to track request counts/latencies by method/path/status. |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| management/commands/ | Django management commands: `check_config` (validate env vars), `setup_google_oauth` (seed SocialApp), `setup_roles` (seed default groups) (see `management/commands/AGENTS.md`) |
| tests/ | Test suite: `test_profile_api.py` (profile endpoints, password change, duplicate email rejection). Folded into this doc, not a separate AGENTS.md. |
| migrations/ | Generated Django migration files; do not document individually |

## For AI Agents

### Working In This Directory
- **Custom user model**: Always use `from django.contrib.auth import get_user_model; User = get_user_model()` or `from core.models import User`
- **Google OAuth setup**: Ensure `setup_google_oauth` management command has run, or manually create a `SocialApp` record with provider='google' in the database
- **JWT cookies**: `jwt-auth` (access token) and `jwt-refresh-token` (refresh token) are set on login/registration; secure + httponly in production
- **Metrics**: Middleware auto-emits on every request; manually call `increment_metric()` for custom counters
- **Request IDs**: Automatically attached by middleware; available as `request.request_id` in views and in logs via `get_request_id()` from any thread
- **Health probes**: Both liveness and readiness are designed for Kubernetes/container orchestrators; readiness blocks traffic until DB + ES are up

### Testing Requirements
- **Run tests**: `docker exec search_backend sh -c 'USE_SQLITE_FOR_TESTS=true python manage.py test core'`
- **Test database**: SQLite in-memory (via `USE_SQLITE_FOR_TESTS=true`) or PostgreSQL test DB (default, if `docker-compose` is up)
- **Fixtures**: Tests create their own users and social accounts; no persistent data required
- **Profile API endpoint**: Tests hit `/api/auth/user/` (requires authentication via `force_authenticate` in tests)

### Common Patterns
- **Email normalization**: `.strip().lower()` before uniqueness checks
- **Name handling**: First/last name pair, but also support single `name` alias that splits on space
- **Password change**: Requires all three fields: current_password, new_password, new_password_confirm
- **Social account linking**: Google social account stores extra_data (id, email, name, picture); picture field can be updated by authenticated user
- **Avatar**: Retrieved from `user.avatar` field (if exists) or from Google SocialAccount's extra_data['picture']
- **Friendly error messages**: Use Django's `_()` for i18n; LoginSerializer rejects "no account found", "account deactivated", "Google-auth-only account" messages

## Dependencies

### Internal
- **search_engine.permissions**: `has_editor_privileges()` imported in serializer to check if user can upload documents
- **Imports in serializers.py** (deferred to avoid circular imports): `search_engine.permissions.has_editor_privileges` is imported inside `to_representation()` method

### External
- **Django 5.x**: User model, ORM, middleware
- **DRF**: Serializers, generic views, authentication, permissions
- **django-allauth**: Social account models and providers (Google OAuth)
- **dj-rest-auth + djangorestframework-simplejwt**: JWT authentication, login/registration endpoints
- **PostgreSQL**: User and SocialAccount tables

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
