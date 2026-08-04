"""Seed canonical Person records from ``search_engine.Author`` rows —
the high-precision base of the persons gazetteer. Idempotent: keyed on the
``author`` FK, re-runs refresh names/death fields without duplicating.
"""
from django.core.management.base import BaseCommand

from extraction.extractors.persons import blocking_key, reload_persons
from extraction.extractors.textnorm import normalize
from extraction.models import Person
from search_engine.models import Author


class Command(BaseCommand):
    help = 'Create/refresh Person records from Author rows (persons gazetteer base)'

    def handle(self, *args, **options):
        created = updated = 0
        for author in Author.objects.all():
            defaults = {
                'display_name': author.name,
                'aliases': list(author.alternate_names or []),
                'blocking_key': blocking_key(normalize(author.name)),
                'death_date_raw': author.date_of_death or '',
                'death_year_hijri': author.death_year_hijri,
                'death_century': author.death_century,
                'source': Person.Source.AUTHOR_IMPORT,
                'review_status': 'approved',
            }
            _, was_created = Person.objects.update_or_create(
                author=author, defaults=defaults)
            created += was_created
            updated += not was_created
        reload_persons()
        self.stdout.write(self.style.SUCCESS(
            f'Persons: {created} created, {updated} refreshed from Authors'))
