#!/usr/bin/env bash
# Create the file-backed Docker secrets that docker-compose.yml expects.
#
# Idempotent and non-destructive: an existing secret file is never touched.
# For each missing file the value is taken from .env when the matching variable
# is still defined there (so an existing deployment migrates without changing
# any credential), otherwise a strong random value is generated for the three
# secrets we own, and an empty placeholder is written for the third-party API
# keys you have to paste in yourself.
#
# Usage:  make secrets   |   bash scripts/init-secrets.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECRETS_DIR="$REPO_ROOT/secrets"
ENV_FILE="$REPO_ROOT/.env"

# secret file name : variable it replaces : how to fill a missing file
SPECS="
django_secret_key:SECRET_KEY:generate
postgres_password:POSTGRES_PASSWORD:generate
minio_root_password:MINIO_ROOT_PASSWORD:generate
google_client_secret:GOOGLE_CLIENT_SECRET:blank
gemini_api_key:GEMINI_API_KEY:blank
openrouter_api_key:OPENROUTER_API_KEY:blank
anthropic_api_key:ANTHROPIC_API_KEY:blank
"

# Read VAR from .env. Tolerates surrounding quotes and CRLF line endings.
read_env_value() {
    [ -f "$ENV_FILE" ] || return 0
    sed -n "s/^[[:space:]]*$1=//p" "$ENV_FILE" \
        | head -n 1 \
        | tr -d '\r' \
        | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/" \
        | sed -e 's/[[:space:]]*$//'
}

generate_value() {
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -base64 48 | tr -d '\n/+=' | cut -c1-50
    elif [ -r /dev/urandom ]; then
        LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom 2>/dev/null | head -c 50 || true
    else
        echo "ERROR: need openssl or /dev/urandom to generate a secret." >&2
        exit 1
    fi
}

mkdir -p "$SECRETS_DIR"

# Unquoted on purpose: $SPECS is split on whitespace into one word per secret.
for spec in $SPECS; do
    name="${spec%%:*}"
    rest="${spec#*:}"
    var="${rest%%:*}"
    mode="${rest##*:}"
    path="$SECRETS_DIR/$name.txt"

    if [ -f "$path" ]; then
        echo "  = $name.txt (exists, left alone)"
        continue
    fi

    value="$(read_env_value "$var")"
    if [ -n "$value" ] && [ "$value" != "replace-with-a-long-random-secret" ]; then
        origin="copied from .env \$$var"
    elif [ "$mode" = "generate" ]; then
        value="$(generate_value)"
        origin="generated"
    else
        value=""
        origin="empty — paste your \$$var value in, or leave blank to disable that feature"
    fi

    # printf, not echo: no trailing newline to leak into the credential.
    printf '%s' "$value" > "$path"
    chmod 600 "$path" 2>/dev/null || true
    echo "  + $name.txt ($origin)"
done

echo
echo "Secrets live in ./secrets/ and are gitignored. Next: docker compose up -d --build"
if [ -n "$(read_env_value SECRET_KEY)$(read_env_value POSTGRES_PASSWORD)$(read_env_value MINIO_ROOT_PASSWORD)" ]; then
    echo
    echo "NOTE: .env still defines secrets that now live in ./secrets/."
    echo "      The secret files take precedence. Delete those .env lines once the"
    echo "      stack comes up clean, so there is only one copy of each credential."
fi
