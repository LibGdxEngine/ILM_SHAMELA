# Secrets

File-backed [Docker secrets](https://docs.docker.com/engine/swarm/secrets/).
Each `*.txt` here is mounted read-only at `/run/secrets/<name>` inside only the
services that declare it in `docker-compose.yml`.

**Nothing in this directory except this README is tracked by git.** The value
files are generated locally and never leave the host.

## Creating them

```bash
make secrets          # or: bash scripts/init-secrets.sh
```

Idempotent — it never overwrites a file that already exists. Missing files are
seeded from the matching `.env` variable when one is still defined there,
otherwise a random 50-character value is generated (`django_secret_key`,
`postgres_password`, `minio_root_password`) or an empty placeholder is written
(the third-party API keys).

## The files

| File | Consumed as | Required |
|---|---|---|
| `django_secret_key.txt` | `SECRET_KEY` | Yes — Django refuses to start without it |
| `postgres_password.txt` | `POSTGRES_PASSWORD` | Yes |
| `minio_root_password.txt` | `MINIO_ROOT_PASSWORD` | Yes |
| `google_client_secret.txt` | `GOOGLE_CLIENT_SECRET` | No — blank disables Google sign-in |
| `gemini_api_key.txt` | `GEMINI_API_KEY` | No — blank disables semantic reranking |
| `openrouter_api_key.txt` | `OPENROUTER_API_KEY` | No — blank disables the chat assistant and NER |
| `anthropic_api_key.txt` | `ANTHROPIC_API_KEY` | No — legacy fallback path |

Write values with **no trailing newline**:

```bash
printf '%s' 'sk-or-v1-...' > secrets/openrouter_api_key.txt
```

`printf`, not `echo` — `echo` appends `\n`, which would corrupt an API key sent
in an HTTP header. Both loaders strip surrounding whitespace as a safety net,
but don't rely on it.

## How a value reaches the application

Compose passes `<VAR>_FILE=/run/secrets/<name>` instead of `<VAR>`. The
`postgres` and `minio` images resolve that form themselves. For the Python
services, `backend/ilm_shamela/env_secrets.py` expands `<VAR>_FILE` into
`os.environ` at Django-settings import time, and `backend/load_secrets.sh` does
the same for the shell steps in `entrypoint.sh` that run before Python starts.

Plain `<VAR>` still works when no `<VAR>_FILE` is set, which is what keeps
host-run tests and pre-secrets deployments working unchanged.

## Rotating a secret

```bash
printf '%s' 'new-value' > secrets/<name>.txt
docker compose up -d <services that use it>
```

Changing `postgres_password.txt` only affects a **new** database volume — the
password is baked into the existing `postgres_data` volume at initialisation.
To rotate it on a live database, `ALTER USER ... WITH PASSWORD` first, then
update the file and restart `backend`, `celery_worker`, and `agent`.
