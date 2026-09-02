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
        # Django settings have already run env_secrets.load_secrets() by the
        # time a management command reaches here, so a value delivered as a
        # Docker secret via <VAR>_FILE is visible in os.environ like any other.
        missing = [key for key in REQUIRED_ENV_VARS if not os.environ.get(key)]
        if missing:
            raise CommandError(
                f"Missing required configuration: {', '.join(missing)}. "
                f"Set each one directly, or point <NAME>_FILE at a secret file "
                f"(the compose stack mounts these under /run/secrets/)."
            )

        self.stdout.write(self.style.SUCCESS('Configuration check passed.'))
