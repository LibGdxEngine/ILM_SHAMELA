from django.core.management.base import BaseCommand

from search_engine.hijri_dates import derive_death_fields
from search_engine.models import Author


class Command(BaseCommand):
    help = (
        'Re-derive Author.death_year_hijri / death_century from the free-text '
        'date_of_death. Run after improving the hijri_dates parser or after '
        'bulk writes that bypassed Author.save().'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Report which authors would change without writing anything.',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']

        changed = unparsed = 0
        batch = []
        for author in Author.objects.all().iterator(chunk_size=500):
            year, century = derive_death_fields(author.date_of_death)
            if year is None and (author.date_of_death or '').strip():
                unparsed += 1
            if author.death_year_hijri == year and author.death_century == century:
                continue
            changed += 1
            if dry_run:
                self.stdout.write(
                    f'  [WOULD CHANGE] {author.id} {author.name!r}: '
                    f'{author.date_of_death!r} -> year={year}, century={century}'
                )
                continue
            author.death_year_hijri = year
            author.death_century = century
            batch.append(author)
            if len(batch) >= 500:
                Author.objects.bulk_update(batch, ['death_year_hijri', 'death_century'])
                batch = []
        if batch:
            Author.objects.bulk_update(batch, ['death_year_hijri', 'death_century'])

        prefix = '[DRY RUN] Would update' if dry_run else 'Updated'
        self.stdout.write(self.style.SUCCESS(
            f'{prefix} {changed} author(s); '
            f'{unparsed} non-empty date(s) remain unparseable.'
        ))
