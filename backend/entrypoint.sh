#!/bin/bash
set -e

echo "Waiting for database to be ready..."
while ! pg_isready -h db -U ${POSTGRES_USER} -d ${POSTGRES_DB} > /dev/null 2>&1; do
  echo "Database is unavailable - sleeping"
  sleep 1
done

echo "Database is ready!"

echo "Running migrations..."
python manage.py migrate --noinput

echo "Creating superuser if it doesn't exist..."
python manage.py shell << EOF
from core.models import User
import os

username = "Ahmed"
email = "ahmed@gmail.com"
password = "Ahmed1998_"

if not User.objects.filter(username=username).exists():
    User.objects.create_superuser(username=username, email=email, password=password)
    print(f"Superuser '{username}' created successfully.")
else:
    print(f"Superuser '{username}' already exists.")
EOF

echo "Collecting static files..."
python manage.py collectstatic --noinput || true

# If a command is provided, execute it (e.g., celery worker)
# Otherwise, start gunicorn as default
if [ $# -gt 0 ]; then
    echo "Executing provided command: $@"
    exec "$@"
else
    echo "Starting server..."
    exec gunicorn ilm_shamela.wsgi:application --bind 0.0.0.0:8000 --workers 4 --timeout 120
fi
