from django.core.management.base import BaseCommand

from analytics.services import purge_expired_events


class Command(BaseCommand):
    help = (
        'Delete UserEvent rows older than ANALYTICS_EVENT_RETENTION_DAYS '
        '(aggregates are retained).'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--days', type=int, default=None,
            help='Override the retention window (days). Defaults to the setting.',
        )

    def handle(self, *args, **options):
        deleted = purge_expired_events(days=options['days'])
        self.stdout.write(self.style.SUCCESS(f'Purged {deleted} expired events.'))
