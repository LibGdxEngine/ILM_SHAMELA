# Plan: Remove nginx from the project

**Status:** Draft
**Date:** 2026-05-22
**Scope:** Small — most of nginx is already gone; this is cleanup.

## Requirements Summary

Remove all remaining nginx artifacts. Caddy at `caddy/Caddyfile` already handles every route nginx used to serve (static, admin, media, api, frontend catch-all) on ports 80/443 with auto TLS. Backend and frontend are proxy-agnostic — no app code changes needed.

## Current State (verified)

| Artifact | Location | Action |
|---|---|---|
| `nginx/certs/selfsigned.crt` | tracked in git | Remove from git + filesystem |
| `nginx/certs/selfsigned.key` | untracked, owned by root, 600 | Remove from filesystem (needs `sudo`) |
| `nginx/` directory | filesystem only | Remove |
| `docker compose build ... nginx` | `.github/workflows/ci.yml:87` | Drop `nginx` from the build target list |
| `nginx/certs/*.key` | `.gitignore` | Remove the line (directory will be gone) |
| nginx service in `docker-compose.yml` | already absent | No action |
| nginx refs in backend/frontend | none found | No action |
| nginx refs in docs/scripts | none found | No action |

## Acceptance Criteria

- [ ] `nginx/` directory does not exist
- [ ] `git ls-files nginx/` returns empty
- [ ] `grep -rIn "nginx" .` (excluding `.git`, `node_modules`, `.next`) returns zero hits
- [ ] `.github/workflows/ci.yml:87` no longer includes `nginx` in the build target list
- [ ] `docker compose up` brings the stack up cleanly with Caddy as the only reverse proxy
- [ ] `https://localhost/` serves the frontend (Next.js)
- [ ] `https://localhost/api/...` reaches Django
- [ ] `https://localhost/admin/` reaches Django admin
- [ ] `https://localhost/static/...` serves Django static files
- [ ] `https://localhost/media/...` serves uploaded media

## Implementation Steps

1. **Untrack the cert in git**
   ```
   git rm nginx/certs/selfsigned.crt
   ```

2. **Delete the nginx directory** (the key is owned by root, so this needs sudo)
   ```
   sudo rm -rf nginx/
   ```

3. **Remove nginx from CI build target** — edit `.github/workflows/ci.yml:87`:
   - Before: `run: docker compose build backend frontend nginx`
   - After:  `run: docker compose build backend frontend`

4. **Clean up `.gitignore`** — remove the `nginx/certs/*.key` line and its comment (added earlier in this session; no longer needed once the directory is gone).

5. **Verify Caddy still serves everything** — bring the stack up and hit each route from the acceptance criteria. Caddy is already wired in `docker-compose.yml` and `caddy/Caddyfile` covers all routes nginx used to handle.

## Risks and Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Caddy isn't actually picking up SSL termination in some env | Low | Caddy already runs in compose with `tls internal`; verified Caddyfile binds :80 and :443. Test with `curl -k https://localhost/api/health` after removal. |
| CI builds break because the `nginx` build target is referenced elsewhere | Very low | Only one occurrence (`ci.yml:87`). Confirmed by grep. |
| A teammate has a deploy script or env file referencing nginx that's not in the repo | Unknown | Out of scope; flag in PR description. |
| Removing the tracked `selfsigned.crt` breaks someone's local setup that still expects nginx | Low | nginx isn't running anywhere (no compose service). Caddy generates its own cert via `tls internal`. |

## Verification Steps

After applying steps 1-4:

```bash
# No nginx anywhere
grep -rIn "nginx" . --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=.next
ls nginx/ 2>&1 | grep -q "No such file" && echo "OK: nginx/ removed"
git ls-files nginx/ | wc -l  # should be 0

# Stack comes up
docker compose up -d
docker compose ps  # caddy, backend, frontend, db, etc. — no nginx

# Routes work
curl -kI https://localhost/                  # 200 from frontend
curl -kI https://localhost/api/              # reaches Django
curl -kI https://localhost/admin/login/      # reaches Django admin
curl -kI https://localhost/static/admin/css/base.css  # static served
```

## Out of Scope

- Changes to backend Django settings (already proxy-agnostic — `SECURE_PROXY_SSL_HEADER` works with Caddy)
- Changes to `frontend/next.config.js` rewrites (point at `backend:8000` directly, not via any proxy)
- Cleaning up unrelated untracked files (`backend/test.sqlite3`, `.omc/`)
