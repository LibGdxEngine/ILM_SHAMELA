"""
Zero-downtime Elasticsearch mapping update + in-place repopulation.

Unlike ``recreate_index`` (which deletes the index and leaves search empty
until the refill finishes), this command only ADDS fields to the live mapping
(`PUT _mapping` — Elasticsearch accepts new fields/subfields on an open index)
and then re-saves every processed document in place, so search keeps serving
throughout. Existing fields cannot be changed this way; breaking mapping
changes still need ``recreate_index``.

Deploy order for a mapping change: run this immediately after deploying code —
filters that target the new keyword fields exclude documents that have not
been repopulated yet.

Usage:
    python manage.py update_search_index                 # put_mapping only
    python manage.py update_search_index --repopulate    # + re-save all docs
"""
import logging

from django.core.management.base import BaseCommand
from elasticsearch_dsl import connections

from search_engine.documents import DocumentIndex
from search_engine.models import Document

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = 'Additively update the ES mapping and optionally re-save all processed documents in place'

    def add_arguments(self, parser):
        parser.add_argument(
            '--repopulate',
            action='store_true',
            help='Re-save every processed document so new mapping fields get populated',
        )

    def handle(self, *args, **options):
        es = connections.get_connection()
        index_name = DocumentIndex._index._name

        if not es.indices.exists(index=index_name):
            self.stdout.write(f'Index "{index_name}" does not exist — creating it...')
            DocumentIndex._index.create()
            self.stdout.write(self.style.SUCCESS(f'Index "{index_name}" created'))
        else:
            self.stdout.write(f'Updating mapping of "{index_name}" (additive put_mapping)...')
            mapping = DocumentIndex._doc_type.mapping.to_dict()
            try:
                es.indices.put_mapping(index=index_name, properties=mapping['properties'])
            except TypeError:
                # Older elasticsearch-py clients take the whole mapping as body.
                es.indices.put_mapping(index=index_name, body=mapping)
            self.stdout.write(self.style.SUCCESS('Mapping updated'))

        if not options.get('repopulate'):
            self.stdout.write(self.style.WARNING(
                'Mapping updated only. New fields stay empty on existing documents '
                'until you run with --repopulate.'
            ))
            return

        processed_docs = Document.objects.filter(processed=True).prefetch_related(
            'authors', 'alternate_names', 'categories')
        count = processed_docs.count()
        if count == 0:
            self.stdout.write(self.style.WARNING('No processed documents to repopulate'))
            return

        self.stdout.write(f'Repopulating {count} processed document(s) in place...')
        indexed = 0
        failed = 0
        for doc in processed_docs.iterator(chunk_size=50):
            try:
                doc_index = DocumentIndex(meta={'id': doc.id})
                doc_index.prepare(doc)
                doc_index.save()
                indexed += 1
                if indexed % 25 == 0:
                    self.stdout.write(f'  {indexed}/{count}...')
            except Exception as exc:
                failed += 1
                self.stdout.write(self.style.ERROR(
                    f'Error repopulating document {doc.id}: {exc}'))
        self.stdout.write(self.style.SUCCESS(
            f'Repopulated {indexed}/{count} documents ({failed} failed)'))
