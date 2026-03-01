from django.contrib.auth.models import Group
from django.core.management.base import BaseCommand


DEFAULT_GROUPS = ['reader', 'editor', 'admin']


class Command(BaseCommand):
    help = 'Create default authorization groups for the platform.'

    def handle(self, *args, **options):
        created = []
        for name in DEFAULT_GROUPS:
            _, was_created = Group.objects.get_or_create(name=name)
            if was_created:
                created.append(name)

        if created:
            self.stdout.write(self.style.SUCCESS(f'Created groups: {", ".join(created)}'))
        else:
            self.stdout.write(self.style.SUCCESS('All default groups already exist.'))
