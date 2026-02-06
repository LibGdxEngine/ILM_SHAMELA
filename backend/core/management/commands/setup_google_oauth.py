"""
Management command to setup Google OAuth SocialApp in the database.
This is required for django-allauth Google authentication to work.
"""
import os
from django.core.management.base import BaseCommand
from django.contrib.sites.models import Site
from allauth.socialaccount.models import SocialApp


class Command(BaseCommand):
    help = 'Setup Google OAuth SocialApp for django-allauth'

    def handle(self, *args, **options):
        client_id = os.environ.get('GOOGLE_CLIENT_ID')
        client_secret = os.environ.get('GOOGLE_CLIENT_SECRET')

        if not client_id or not client_secret:
            self.stderr.write(self.style.ERROR(
                'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables must be set'
            ))
            return

        # Get or create the SocialApp for Google
        social_app, created = SocialApp.objects.update_or_create(
            provider='google',
            defaults={
                'name': 'Google',
                'client_id': client_id,
                'secret': client_secret,
            }
        )

        # Ensure the app is linked to the current site
        site = Site.objects.get_current()
        if site not in social_app.sites.all():
            social_app.sites.add(site)

        if created:
            self.stdout.write(self.style.SUCCESS(
                f'Created Google SocialApp with client_id: {client_id[:20]}...'
            ))
        else:
            self.stdout.write(self.style.SUCCESS(
                f'Updated Google SocialApp with client_id: {client_id[:20]}...'
            ))

        self.stdout.write(self.style.SUCCESS('Google OAuth setup complete!'))
