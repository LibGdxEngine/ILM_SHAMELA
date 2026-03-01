# Security Notes

## Baseline Controls
- `SECRET_KEY` is required at startup.
- Default API permissions are authenticated.
- Write operations on documents are restricted to editor/admin roles.
- CORS defaults to explicit allowlists (`CORS_ALLOWED_ORIGINS`).
- CSRF and session cookie security defaults to secure in non-debug mode.
- DRF throttling enabled (`anon`, `user`, plus scoped throttles such as `upload` and `search`).
- File upload validation enforces extension and size caps.

## Required Runtime Inputs
- `SECRET_KEY`
- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`

## Role Model
- Reader: authenticated read access.
- Editor/Admin: upload/update/delete access.
- Admin/staff: metrics endpoint access.

## Recommended Production Hardening
- Use strong `SECRET_KEY` from secret manager.
- Set strict `ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS`, and `CORS_ALLOWED_ORIGINS`.
- Enable HTTPS redirect and HSTS in production (`SECURE_SSL_REDIRECT=true`).
- Restrict `/api/metrics/` by network policy in addition to auth.
