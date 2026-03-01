import os

from django.core.management.base import BaseCommand, CommandError


REQUIRED_ENV_VARS = [
    'SECRET_KEY',
    'POSTGRES_DB',
    'POSTGRES_USER',
    'POSTGRES_PASSWORD',
]


class Command(BaseCommand):
    help = 'Validate critical runtime configuration.'

    def handle(self, *args, **options):
        missing = [key for key in REQUIRED_ENV_VARS if not os.environ.get(key)]
        if missing:
            raise CommandError(
                f"Missing required environment variables: {', '.join(missing)}"
            )

        self.stdout.write(self.style.SUCCESS('Configuration check passed.'))
