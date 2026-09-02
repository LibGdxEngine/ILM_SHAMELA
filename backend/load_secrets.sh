#!/bin/sh
# Shell counterpart to ilm_shamela/env_secrets.py: expand <VAR>_FILE into <VAR>.
#
# Source this (`. /app/load_secrets.sh`), do not execute it — the point is to
# mutate the current shell's environment. Django and Celery resolve secrets
# themselves via env_secrets.load_secrets(); this exists for the shell steps
# that run *before* Python does, notably PGPASSWORD for the pg_isready wait in
# entrypoint.sh.
#
# Keep SECRET_VARS in sync with SECRET_ENV_VARS in ilm_shamela/env_secrets.py.

SECRET_VARS="SECRET_KEY POSTGRES_PASSWORD MINIO_ROOT_PASSWORD GOOGLE_CLIENT_SECRET GEMINI_API_KEY OPENROUTER_API_KEY ANTHROPIC_API_KEY"

for _secret_name in $SECRET_VARS; do
    eval "_secret_path=\${${_secret_name}_FILE:-}"
    [ -n "$_secret_path" ] || continue

    if [ ! -r "$_secret_path" ]; then
        echo "FATAL: ${_secret_name}_FILE points at '$_secret_path', which is not readable." >&2
        echo "       Check the secret is declared for this service in docker-compose.yml." >&2
        exit 1
    fi

    # Strip trailing newline: `echo secret > file` appends one, and a stray \n
    # corrupts an API key in an HTTP header or a database password.
    _secret_value="$(cat "$_secret_path")"

    # An empty placeholder file must not clobber a value already in the
    # environment (mirrors the Python loader's precedence rules).
    eval "_secret_current=\${${_secret_name}:-}"
    if [ -z "$_secret_value" ] && [ -n "$_secret_current" ]; then
        continue
    fi

    export "${_secret_name}=${_secret_value}"
done

unset _secret_name _secret_path _secret_value _secret_current
true
