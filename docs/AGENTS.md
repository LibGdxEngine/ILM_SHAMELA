<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-03 | Updated: 2026-07-03 -->

# docs

## Purpose
Operational and design documentation for the ILM_SHAMELA platform. Includes high-level architecture diagrams, API reference, security posture, operations runbook, and design system inspiration (derived from Anthropic's Claude product design).

## Key Files
| File | Description |
|------|-------------|
| `architecture.md` | Service topology (frontend, caddy, backend, celery, db, es, redis, minio), end-to-end document processing flow, processing state model, and observability endpoints. |
| `api.md` | Complete REST API reference: auth, documents, authors, categories, library-wide chat sessions, health/metrics endpoints. Includes search modes (exact, semantic, hybrid), filter parameters, response fields, and score explanations. |
| `security.md` | Baseline controls (SECRET_KEY requirement, API auth defaults, CORS, CSRF, throttling), role model (Reader, Editor/Admin, Admin/staff), and production hardening recommendations. |
| `operations.md` | Common commands (stack start, retry failed jobs, config validation), health/readiness checks, Prometheus metrics, and failure handling strategy. |
| `design-system.md` | Design inspiration from Anthropic's Claude product: warm parchment palette, serif/sans/mono typography, button/component styling, and color roles (primary, secondary, surface, neutral, semantic). |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `assets/` | Placeholder for screenshots and landing page assets (`landing-image-credits.md` documents attribution). |

## For AI Agents

### Working In This Directory
- **Architecture changes**: Update `architecture.md` if adding/removing services or changing the processing flow.
- **API changes**: Keep `api.md` in sync with Django `urls.py` and view/serializer changes; document new endpoints with method, path, auth requirement, and response shape.
- **Security updates**: Reflect new env vars, role changes, or hardening steps in `security.md`.
- **Operations runbook**: Extend with new management commands or troubleshooting steps as they emerge.
- **Design consistency**: Use `design-system.md` as a reference for frontend/component changes; maintain warm palette and serif/sans distinction.

### Testing Requirements
- No unit/integration tests for docs (this is reference material).
- **Validation**: Before committing doc changes, verify they match actual code: API endpoints should exist in backend views; environment variables should match `.env.example` and `docker-compose.yml`; architecture should match `docker-compose.yml` service definitions.

### Common Patterns
- All docs assume a running Docker stack (`docker compose up -d`).
- API examples use `curl -k https://localhost/api/...` with cookies for auth.
- Health/readiness are exposed by dedicated Django views (`core/views_health.py`).
- Metrics are Prometheus-format plaintext from `/api/metrics/` (admin-only).

## Dependencies

### Internal
- References backend service (`backend/`), frontend (`frontend/`), OCR services (`ocr_services/`), Caddy (`caddy/`).
- Documentation of Docker stack assumes `docker-compose.yml` service definitions remain accurate.

### External
- Design system inspired by Anthropic Claude product; no external dependencies (documentation only).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
