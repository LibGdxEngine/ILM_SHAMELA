"""
Backfill per-word geometry (word bounding boxes) for PDF-overlay documents.

    python manage.py backfill_word_geometry                         # list layout docs + geometry status
    python manage.py backfill_word_geometry --document-id 2 --dry-run
    python manage.py backfill_word_geometry --document-id 2 --pages 9-12 --sync
    python manage.py backfill_word_geometry --document-id 2         # whole document, async (Celery)
    python manage.py backfill_word_geometry --all --batch-pages 50 --stagger 2
    python manage.py backfill_word_geometry --document-id 2 --force # re-OCR blocks that already have geometry

Idempotent: pages whose blocks already carry `word_geometry` are skipped unless
--force. Requires the tesseract sidecar with the /words endpoint (see
ocr_services/AGENTS.md); the task returns {'status': 'skipped'} otherwise.
"""

from django.core.management.base import BaseCommand, CommandError

from search_engine.models import Document, DocumentChunk


def parse_pages(spec):
    """'1-20,25,30-32' → sorted list of ints (None for empty)."""
    if not spec:
        return None
    pages = set()
    for part in spec.split(','):
        part = part.strip()
        if not part:
            continue
        if '-' in part:
            lo, hi = part.split('-', 1)
            lo, hi = int(lo), int(hi)
            if hi < lo:
                raise CommandError(f'Invalid page range: {part}')
            pages.update(range(lo, hi + 1))
        else:
            pages.add(int(part))
    return sorted(pages)


def geometry_status(document, pages=None):
    """Per-document counts of blocks with/without geometry."""
    from search_engine.word_geometry import needs_geometry

    chunks = (
        DocumentChunk.objects.filter(document=document, layout__isnull=False)
        .order_by('page_number')
        .only('page_number', 'layout')
    )
    status = {'pages': 0, 'pending_pages': 0, 'blocks': 0, 'with_geometry': 0,
              'with_words': 0, 'low_coverage': 0, 'pending_blocks': 0, 'page_numbers': []}
    for chunk in chunks.iterator():
        if pages is not None and chunk.page_number not in pages:
            continue
        blocks = (chunk.layout or {}).get('blocks') or []
        status['pages'] += 1
        status['page_numbers'].append(chunk.page_number)
        page_pending = False
        for block in blocks:
            status['blocks'] += 1
            if needs_geometry(block):
                status['pending_blocks'] += 1
                page_pending = True
                continue
            status['with_geometry'] += 1
            if block.get('words'):
                status['with_words'] += 1
            else:
                status['low_coverage'] += 1
        if page_pending:
            status['pending_pages'] += 1
    return status


class Command(BaseCommand):
    help = 'Backfill word-level OCR geometry for PDF-overlay (layout) documents.'

    def add_arguments(self, parser):
        parser.add_argument('--document-id', type=int, action='append', dest='document_ids',
                            help='Document id (repeatable)')
        parser.add_argument('--all', action='store_true', help='All documents with has_layout=True')
        parser.add_argument('--pages', default=None, help='Page selection, e.g. "1-20,25"')
        parser.add_argument('--force', action='store_true',
                            help='Re-OCR blocks that already carry word_geometry')
        parser.add_argument('--sync', action='store_true',
                            help='Run inline in this process instead of enqueuing Celery tasks')
        parser.add_argument('--dry-run', action='store_true', help='Report status only')
        parser.add_argument('--stagger', type=float, default=1.0,
                            help='Seconds between enqueued tasks (default 1.0)')
        parser.add_argument('--batch-pages', type=int, default=None,
                            help='Split each document into tasks of N pages')

    def handle(self, *args, **options):
        from search_engine.tasks import extract_word_geometry_task

        document_ids = options.get('document_ids') or []
        if document_ids:
            documents = list(Document.objects.filter(pk__in=document_ids).order_by('id'))
            missing = set(document_ids) - {d.id for d in documents}
            if missing:
                raise CommandError(f'Unknown document id(s): {sorted(missing)}')
            not_layout = [d.id for d in documents if not d.has_layout]
            if not_layout:
                raise CommandError(f'Not PDF-overlay (has_layout=False): {not_layout}')
        else:
            documents = list(Document.objects.filter(has_layout=True).order_by('id'))

        pages = parse_pages(options.get('pages'))
        listing_only = not document_ids and not options['all']

        for document in documents:
            status = geometry_status(document, set(pages) if pages else None)
            self.stdout.write(
                f"doc {document.id} «{(document.title or '')[:40]}» pages={status['pages']} "
                f"pending_pages={status['pending_pages']} blocks={status['blocks']} "
                f"with_words={status['with_words']} low_coverage={status['low_coverage']} "
                f"pending_blocks={status['pending_blocks']}"
            )
        if listing_only:
            self.stdout.write('Pass --document-id N or --all to run.')
            return
        if options['dry_run']:
            self.stdout.write('Dry run — nothing enqueued.')
            return

        enqueued = 0
        for document in documents:
            page_numbers = pages
            if page_numbers is None and options['batch_pages']:
                page_numbers = geometry_status(document)['page_numbers']
            batches = [None]
            if options['batch_pages'] and page_numbers:
                size = max(1, options['batch_pages'])
                batches = [page_numbers[i:i + size] for i in range(0, len(page_numbers), size)]
            elif page_numbers:
                batches = [page_numbers]

            for batch in batches:
                if options['sync']:
                    result = extract_word_geometry_task.run(
                        document.id, page_numbers=batch, force=options['force'],
                    )
                    self.stdout.write(f'doc {document.id} pages={batch or "all"} → {result}')
                else:
                    extract_word_geometry_task.apply_async(
                        args=[document.id],
                        kwargs={'page_numbers': batch, 'force': options['force']},
                        countdown=enqueued * max(0.0, options['stagger']),
                    )
                    enqueued += 1
        if not options['sync']:
            self.stdout.write(self.style.SUCCESS(f'Enqueued {enqueued} word-geometry task(s).'))
