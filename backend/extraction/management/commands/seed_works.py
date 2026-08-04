"""Seed canonical Work records from the library's own documents — instant
targets for the commentary-tree relations (شرح/حاشية/مختصر edges resolve
against these). Idempotent: keyed on the ``document`` FK, re-runs refresh
titles/aliases without duplicating. Mirrors ``seed_persons``.
"""
from django.core.management.base import BaseCommand

from extraction.extractors.textnorm import normalize
from extraction.models import Person, Work, WorkName
from search_engine.models import Document


class Command(BaseCommand):
    help = 'Create/refresh Work records from library documents (works gazetteer base)'

    def handle(self, *args, **options):
        created = updated = names = 0
        for document in Document.objects.filter(processed=True).prefetch_related(
                'authors', 'alternate_names'):
            title = (document.title or '').strip()
            if not title:
                continue
            author = document.authors.first()
            person = (Person.objects.filter(author=author).first()
                      if author is not None else None)
            defaults = {
                'display_title': title[:255],
                'normalized_title': normalize(title)[:255],
                'author': person,
                'source': Work.Source.LIBRARY_IMPORT,
                'review_status': 'approved',
            }
            work, was_created = Work.objects.update_or_create(
                document=document, defaults=defaults)
            created += was_created
            updated += not was_created
            _, name_created = WorkName.objects.get_or_create(
                work=work, normalized=work.normalized_title,
                kind=WorkName.Kind.PRIMARY, defaults={'name': work.display_title})
            names += name_created
            for alt in document.alternate_names.all():
                alt_norm = normalize(alt.name)[:255]
                if not alt_norm:
                    continue
                _, name_created = WorkName.objects.get_or_create(
                    work=work, normalized=alt_norm, kind=WorkName.Kind.VARIANT,
                    defaults={'name': alt.name[:255]})
                names += name_created
        self.stdout.write(self.style.SUCCESS(
            f'Works: {created} created, {updated} refreshed, '
            f'{names} new surface name(s)'))
