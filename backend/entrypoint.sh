#!/bin/bash
set -e

# Expand Docker secrets (<VAR>_FILE -> <VAR>) before anything below reads them.
# Django/Celery do this again for themselves in ilm_shamela/env_secrets.py; this
# call is what makes POSTGRES_PASSWORD available to the pg_isready wait, which
# runs before any Python starts.
. "$(dirname "$0")/load_secrets.sh"

echo "Waiting for database to be ready..."
export PGPASSWORD="${POSTGRES_PASSWORD}"
while ! pg_isready -h "${POSTGRES_HOST:-db}" -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-postgres}" > /dev/null 2>&1; do
  echo "Database is unavailable - sleeping"
  sleep 1
done

echo "Database is ready!"

echo "Validating configuration..."
python manage.py check_config

echo "Running migrations..."
python manage.py migrate --noinput

echo "Ensuring default auth roles exist..."
python manage.py setup_roles

echo "Creating superuser if it doesn't exist..."
python manage.py shell << EOF
from core.models import User
import os

username = os.environ.get("DJANGO_SUPERUSER_USERNAME")
email = os.environ.get("DJANGO_SUPERUSER_EMAIL")
password = os.environ.get("DJANGO_SUPERUSER_PASSWORD")

if username and email and password and not User.objects.filter(username=username).exists():
    User.objects.create_superuser(username=username, email=email, password=password)
    print(f"Superuser '{username}' created successfully.")
else:
    print("Skipping superuser creation (missing env vars or user already exists).")
EOF

echo "Collecting static files..."
python manage.py collectstatic --noinput || true

# If a command is provided, execute it (e.g., celery worker)
# Otherwise, start server based on environment (dev uses runserver, prod uses gunicorn)
if [ $# -gt 0 ]; then
    echo "Executing provided command: $@"
    exec "$@"
else
    if [ "${ENVIRONMENT:-prod}" = "dev" ]; then
        echo "Starting development server..."
        exec python manage.py runserver 0.0.0.0:8000
    else
        echo "Starting production server..."
        exec gunicorn ilm_shamela.wsgi:application --bind 0.0.0.0:8000 --workers 4 --timeout 120
    fi
fi
