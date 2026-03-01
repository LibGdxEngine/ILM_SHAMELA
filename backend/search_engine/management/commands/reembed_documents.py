import os
import time

from django.core.management.base import BaseCommand, CommandError

from search_engine.models import Document
from search_engine.semantic import build_embedding


class Command(BaseCommand):
    help = 'Backfill 768-dim Gemini semantic vectors for existing processed documents.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--only-empty',
            action='store_true',
            help='Only re-embed documents whose semantic_vector is currently empty.',
        )
        parser.add_argument(
            '--document-id',
            type=int,
            default=None,
            help='Re-embed a single document by ID.',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Report which documents would be processed without making any changes.',
        )
        parser.add_argument(
            '--delay',
            type=float,
            default=0.1,
            help='Seconds to sleep between API calls (default 0.1; use 1.0 on free tier).',
        )

    def handle(self, *args, **options):
        api_key = os.environ.get('GEMINI_API_KEY')
        if not api_key:
            raise CommandError(
                'GEMINI_API_KEY is not set. Export it before running this command.'
            )

        only_empty = options['only_empty']
        document_id = options['document_id']
        dry_run = options['dry_run']
        delay = options['delay']

        queryset = Document.objects.filter(processed=True).exclude(content='')

        if document_id is not None:
            queryset = queryset.filter(id=document_id)
        elif only_empty:
            # JSONField stores [] as JSON null or empty list; filter both.
            queryset = queryset.filter(semantic_vector=[])

        total = queryset.count()

        if dry_run:
            self.stdout.write(
                self.style.WARNING(
                    f'[DRY RUN] Would re-embed {total} document(s). No changes made.'
                )
            )
            return

        self.stdout.write(f'Re-embedding {total} document(s)...')

        success = 0
        failure = 0

        for doc in queryset.iterator():
            semantic_input = '\n'.join([
                doc.title or '',
                doc.description or '',
                doc.content or '',
            ])
            vector = build_embedding(semantic_input, task_type="RETRIEVAL_DOCUMENT")

            if not vector:
                self.stderr.write(
                    self.style.ERROR(
                        f'  [FAIL] document {doc.id} — build_embedding returned empty vector'
                    )
                )
                failure += 1
            else:
                doc.semantic_vector = vector
                doc.save(update_fields=['semantic_vector'])
                self.stdout.write(
                    f'  [OK] document {doc.id} — {len(vector)}-dim vector saved'
                )
                success += 1

            if delay > 0:
                time.sleep(delay)

        self.stdout.write(
            self.style.SUCCESS(
                f'Done. Success: {success}, Failed: {failure}, Total: {total}'
            )
        )
