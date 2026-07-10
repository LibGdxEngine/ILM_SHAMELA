<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-03 | Updated: 2026-07-03 -->

# caddy

## Purpose
TLS termination and reverse proxy gateway for the entire ILM_SHAMELA stack. Routes HTTPS traffic to backend (Django API), frontend (Next.js SPA), and static file serving. Automatically provisions Let's Encrypt certificates for production domains and uses self-signed TLS for localhost/IP-based access during development.

## Key Files
| File | Description |
|------|-------------|
| `Caddyfile` | Single configuration file defining TLS setup, request body limits, security headers, and routing rules for Django static files, admin, media, API, and the catch-all SPA handler. Includes separate blocks for public domain (Let's Encrypt) and localhost (internal CA). |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `data/` | Caddy's persistent TLS certificate storage (auto-created by Caddy; not committed to git). |
| `config/` | Caddy's runtime configuration state (auto-created by Caddy; not committed to git). |

## For AI Agents

### Working In This Directory
- **Routing changes**: Edit `Caddyfile` to add new reverse-proxy paths or change request limits. Each major route block (admin, api, media, static, SPA fallback) is clearly labeled.
- **TLS configuration**: The Caddyfile disables auto HTTP→HTTPS redirects to allow explicit control below. Production domains use Let's Encrypt; localhost/IPs use Caddy's internal CA (self-signed).
- **Header security**: Strict-Transport-Security, X-Frame-Options, X-Content-Type-Options, and X-XSS-Protection are set globally in the `(app)` snippet and applied to all routes.
- **Static file caching**: `/static/*` paths (Django staticfiles) are marked immutable and cached for 30 days; `/media/*` paths are cached for 7 days. Both are served from the `staticfiles` volume mounted from the host `backend/staticfiles/`.
- **Request body limits**: Set to 100MB globally; increase if supporting larger document uploads.

### Testing Requirements
- **TLS verification**: `curl -k https://localhost/` should return the Next.js frontend HTML (verify with `-k` flag for self-signed cert).
- **Admin routing**: `curl -k https://localhost/admin/` should return Django admin (HTML or 302 redirect if not logged in).
- **API routing**: `curl -k https://localhost/api/health/live/` should return backend health JSON.
- **Static files**: `curl -k https://localhost/static/<file>` should serve files from `backend/staticfiles/` with correct Cache-Control headers.
- **SPA fallback**: `curl -k https://localhost/any-nonexistent-path` should return the Next.js `index.html` (SPA routing).
- **HTTPS redirect**: `curl -L http://localhost/` should redirect to `https://localhost/` (HTTP on port 80).

### Common Patterns
- **Reverse proxy**: All routes use `reverse_proxy backend:8000` (for Django) or `reverse_proxy frontend:3000` (for Next.js) over the internal Docker network (`search_net`).
- **Path-based routing**: `/admin*`, `/api/*`, `/media/*`, `/static/*` are matched with explicit handlers; anything else → frontend.
- **Admin catchall**: Admin route uses `@admin path /admin /admin/*` to catch both `/admin` (bare) and `/admin/subpaths` so the SPA catch-all doesn't interfere.
- **Encoding**: All routes use `encode zstd gzip` to compress responses (Zstandard preferred, fall back to gzip).
- **Header injection**: Security headers and cache control are applied per-route; some (encoding, body limits) are global.

## Dependencies

### Internal
- **backend** (Django on port 8000): Serves `/admin*`, `/api/*`, and `/media/*` routes.
- **frontend** (Next.js on port 3000): Serves all SPA routes and catches unmatched paths.
- **staticfiles** volume: Contains pre-collected Django static files; mounted read-only into Caddy at `/var/www/staticfiles` and served for `/static/*` paths.

### External
- **Let's Encrypt (for production domains)**: Caddy automatically obtains and renews certs for the configured domain (e.g., `ilmshamela.com`). Requires public DNS + port 443 accessible.
- **Caddy internal CA (for localhost/IPs)**: Self-signed TLS for development; no external dependency.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
