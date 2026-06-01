import os
import time

from django.core.management.base import BaseCommand, CommandError

from search_engine.models import Document, DocumentChunk
from search_engine.semantic import (
    VECTOR_DIMENSIONS,
    build_batch_embedding,
    build_embedding,
)


class Command(BaseCommand):
    help = (
        'Backfill semantic vectors (Document.semantic_vector + DocumentChunk.embedding) '
        f'for processed documents. Current model produces {VECTOR_DIMENSIONS}-dim vectors '
        'via OpenRouter.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--only-stale',
            action='store_true',
            help=(
                'Only re-embed documents/chunks whose vector dim does not match '
                f'VECTOR_DIMENSIONS ({VECTOR_DIMENSIONS}). Useful after switching models.'
            ),
        )
        parser.add_argument(
            '--document-id',
            type=int,
            default=None,
            help='Re-embed a single document by ID (and its chunks).',
        )
        parser.add_argument(
            '--skip-chunks',
            action='store_true',
            help='Re-embed only Document.semantic_vector; leave DocumentChunk.embedding alone.',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Report what would be processed without making any changes.',
        )
        parser.add_argument(
            '--delay',
            type=float,
            default=0.1,
            help='Seconds to sleep between API calls (default 0.1).',
        )

    def handle(self, *args, **options):
        if not os.environ.get('OPENROUTER_API_KEY'):
            raise CommandError(
                'OPENROUTER_API_KEY is not set. Export it before running this command.'
            )

        only_stale = options['only_stale']
        document_id = options['document_id']
        skip_chunks = options['skip_chunks']
        dry_run = options['dry_run']
        delay = options['delay']

        queryset = Document.objects.filter(processed=True).exclude(content='')
        if document_id is not None:
            queryset = queryset.filter(id=document_id)

        total = queryset.count()
        if dry_run:
            self.stdout.write(
                self.style.WARNING(
                    f'[DRY RUN] Would consider {total} document(s). No changes made.'
                )
            )
            return

        self.stdout.write(
            f'Re-embedding up to {total} document(s) (target dim={VECTOR_DIMENSIONS})...'
        )

        doc_success = doc_failure = doc_skipped = 0
        chunk_success = chunk_failure = chunk_skipped = 0

        for doc in queryset.iterator():
            # Document-level semantic vector
            existing_dim = len(doc.semantic_vector or [])
            if only_stale and existing_dim == VECTOR_DIMENSIONS:
                doc_skipped += 1
            else:
                semantic_input = '\n'.join([
                    doc.title or '',
                    doc.description or '',
                    doc.content or '',
                ])
                vector = build_embedding(semantic_input, task_type='RETRIEVAL_DOCUMENT')
                if not vector:
                    self.stderr.write(self.style.ERROR(
                        f'  [FAIL] document {doc.id} — build_embedding returned empty vector'
                    ))
                    doc_failure += 1
                else:
                    doc.semantic_vector = vector
                    doc.save(update_fields=['semantic_vector'])
                    self.stdout.write(
                        f'  [OK]  document {doc.id} — {len(vector)}-dim vector saved'
                    )
                    doc_success += 1
                if delay > 0:
                    time.sleep(delay)

            # Per-chunk embeddings
            if skip_chunks:
                continue

            chunk_qs = DocumentChunk.objects.filter(document=doc).order_by('chunk_index')
            chunks_to_embed = []
            for chunk in chunk_qs:
                if only_stale and len(chunk.embedding or []) == VECTOR_DIMENSIONS:
                    chunk_skipped += 1
                    continue
                chunks_to_embed.append(chunk)

            if not chunks_to_embed:
                continue

            texts = [c.content for c in chunks_to_embed]
            vectors = build_batch_embedding(texts, task_type='RETRIEVAL_DOCUMENT')
            for chunk, vec in zip(chunks_to_embed, vectors):
                if not vec:
                    self.stderr.write(self.style.ERROR(
                        f'  [FAIL] chunk doc={doc.id} idx={chunk.chunk_index} — empty vector'
                    ))
                    chunk_failure += 1
                else:
                    chunk.embedding = vec
                    chunk.save(update_fields=['embedding'])
                    chunk_success += 1
            self.stdout.write(
                f'  [OK]  document {doc.id} — re-embedded {len(chunks_to_embed)} chunk(s)'
            )

        self.stdout.write(self.style.SUCCESS(
            f'\nDocuments: success={doc_success}, failed={doc_failure}, skipped={doc_skipped}'
        ))
        if not skip_chunks:
            self.stdout.write(self.style.SUCCESS(
                f'Chunks:    success={chunk_success}, failed={chunk_failure}, skipped={chunk_skipped}'
            ))
