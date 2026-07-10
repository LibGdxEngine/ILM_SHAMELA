<!-- Parent: ../../AGENTS.md -->
<!-- Generated: 2026-07-03 | Updated: 2026-07-03 -->

# backend/core/management/commands

## Purpose
Django management commands for initialization and validation. Run at container startup (in `entrypoint.sh`) to validate config, seed OAuth integration, and create default authorization groups.

## Key Files
| File | Description |
|------|-------------|
| check_config.py | **Command**: validates that required env vars (`SECRET_KEY`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`) are set; raises `CommandError` if missing. Called during `docker` container startup before migrations. |
| setup_google_oauth.py | **Command**: reads `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` env vars; creates or updates a `SocialApp` record with provider='google'; links it to the current Site. Idempotent (uses `update_or_create`). Called optionally in `entrypoint.sh` if credentials are set. |
| setup_roles.py | **Command**: creates three default `Group` records ('reader', 'editor', 'admin') if they don't exist. Idempotent. Called during `entrypoint.sh` after migrations. |

## For AI Agents

### Working In This Directory
- **Run a command**: `docker exec search_backend python manage.py <command_name>` (e.g. `check_config`, `setup_google_oauth`, `setup_roles`)
- **Entrypoint integration**: `entrypoint.sh` calls `check_config`, `setup_roles` automatically; `setup_google_oauth` is called conditionally if OAuth env vars are present
- **All commands are idempotent**: Safe to run multiple times (uses `get_or_create`, `update_or_create`)

### Testing Requirements
- **No specific tests for these commands** in the codebase; they are integration fixtures
- **Manual testing**: Run via `docker exec` after container startup to verify they execute without error
- **Validation**: `check_config` should pass (env vars set); `setup_roles` should report "All default groups already exist" on second run

## Dependencies

### Internal
- **core.models.User**: Imported by `setup_google_oauth` via Django shell script in `entrypoint.sh`

### External
- **Django**: `BaseCommand`, `CommandError`, management infrastructure
- **django-allauth**: `SocialApp`, `Site` models (for Google OAuth setup)
- **Django auth**: `Group` model (for role setup)

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
