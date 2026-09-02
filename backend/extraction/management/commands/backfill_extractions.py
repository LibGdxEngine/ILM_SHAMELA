"""Backfill extraction over the existing corpus.

Usage:
    python manage.py backfill_extractions                     # all deterministic extractors
    python manage.py backfill_extractions --extractor quran
    python manage.py backfill_extractions --only-failed
    python manage.py backfill_extractions --force --limit 50
    python manage.py backfill_extractions --dry-run
    python manage.py backfill_extractions --sync              # run inline (no Celery)
    python manage.py backfill_extractions --extractor layer0  # LLM classification
    python manage.py backfill_extractions --extractor ner     # LLM NER (deprecated legacy pass)

Enqueues with staggered countdowns so the concurrency-2 worker isn't swamped
alongside document processing (mirrors process_documents' conventions).
"""
from django.core.management.base import BaseCommand

from search_engine.models import Document


class Command(BaseCommand):
    help = 'Run the deterministic extractors over processed documents'

    def add_arguments(self, parser):
        parser.add_argument('--extractor', default='all',
                            help='all (default) or one registered extractor name')
        parser.add_argument('--only-failed', action='store_true',
                            help='Only documents whose last run for the extractor failed')
        parser.add_argument('--force', action='store_true',
                            help='Re-extract even when the corpus hash is unchanged')
        parser.add_argument('--limit', type=int, default=None)
        parser.add_argument('--dry-run', action='store_true')
        parser.add_argument('--sync', action='store_true',
                            help='Run inline instead of enqueuing Celery tasks')
        parser.add_argument('--stagger', type=float, default=1.0,
                            help='Seconds between enqueued tasks (default 1.0)')

    def handle(self, *args, **options):
        from extraction.extractors import EXTRACTOR_REGISTRY
        from extraction.models import ExtractionRun
        from extraction.tasks import extract_document_task

        name = options['extractor']
        if name == 'layer0':
            self._handle_layer0(options)
            return
        if name == 'ner':
            self._handle_ner(options)
            return
        if name != 'all' and name not in EXTRACTOR_REGISTRY:
            self.stderr.write(self.style.ERROR(
                f'Unknown extractor {name!r}. Registered: '
                f'{", ".join(sorted(EXTRACTOR_REGISTRY))}, layer0, ner'))
            return
        extractors = None if name == 'all' else [name]

        docs = Document.objects.filter(processed=True).order_by('id')
        if options['only_failed']:
            failed_ids = ExtractionRun.objects.filter(
                status=ExtractionRun.Status.FAILED,
                **({'extractor_name': name} if name != 'all' else {}),
            ).values_list('document_id', flat=True)
            docs = docs.filter(id__in=list(failed_ids))
        if options['limit']:
            docs = docs[:options['limit']]

        ids = list(docs.values_list('id', flat=True))
        self.stdout.write(
            f'{len(ids)} document(s) × extractor={name}'
            f'{" (dry run)" if options["dry_run"] else ""}')
        if options['dry_run']:
            return

        for i, doc_id in enumerate(ids):
            if options['sync']:
                extract_document_task.run(doc_id, extractors=extractors,
                                          force=options['force'])
                self.stdout.write(f'  extracted doc {doc_id} ({i + 1}/{len(ids)})')
            else:
                extract_document_task.apply_async(
                    args=[doc_id],
                    kwargs={'extractors': extractors, 'force': options['force']},
                    countdown=i * options['stagger'],
                )
        if not options['sync']:
            self.stdout.write(self.style.SUCCESS(
                f'Enqueued {len(ids)} task(s), staggered {options["stagger"]}s apart'))

    def _handle_layer0(self, options):
        """LLM classification backfill. In --sync mode, aborts after 3
        consecutive failures (dead-key detection) instead of queuing hundreds
        of identical failures."""
        from extraction.models import DocumentMeta
        from extraction.tasks import classify_document_task

        docs = Document.objects.filter(processed=True).order_by('id')
        if options['only_failed']:
            failed_ids = DocumentMeta.objects.filter(
                status=DocumentMeta.Status.FAILED,
            ).values_list('document_id', flat=True)
            docs = docs.filter(id__in=list(failed_ids))
        if options['limit']:
            docs = docs[:options['limit']]
        ids = list(docs.values_list('id', flat=True))
        self.stdout.write(
            f'{len(ids)} document(s) × layer0'
            f'{" (dry run)" if options["dry_run"] else ""}')
        if options['dry_run']:
            return

        consecutive_failures = 0
        for i, doc_id in enumerate(ids):
            if options['sync']:
                classify_document_task.run(doc_id, force=options['force'])
                meta = DocumentMeta.objects.filter(document_id=doc_id).first()
                if meta and meta.status == DocumentMeta.Status.FAILED:
                    consecutive_failures += 1
                    self.stderr.write(self.style.WARNING(
                        f'  doc {doc_id} FAILED: {meta.degraded_reason[:120]}'))
                    if consecutive_failures >= 3:
                        self.stderr.write(self.style.ERROR(
                            'Aborting: 3 consecutive failures (dead API key?)'))
                        return
                else:
                    consecutive_failures = 0
                    self.stdout.write(f'  classified doc {doc_id} ({i + 1}/{len(ids)})')
            else:
                classify_document_task.apply_async(
                    args=[doc_id],
                    kwargs={'force': options['force']},
                    countdown=i * max(options['stagger'], 2.0),
                )
        if not options['sync']:
            self.stdout.write(self.style.SUCCESS(f'Enqueued {len(ids)} layer0 task(s)'))

    def _handle_ner(self, options):
        """LLM NER backfill (first 25 pages/document, ≤5 OpenRouter calls
        each). Same dead-key abort as layer0 in --sync mode; the async
        stagger floor is higher because each task is minutes of LLM work on
        the concurrency-2 worker."""
        from extraction import ner
        from extraction.models import ExtractionRun
        from extraction.tasks import ner_document_task

        docs = Document.objects.filter(processed=True).order_by('id')
        if options['only_failed']:
            failed_ids = ExtractionRun.objects.filter(
                extractor_name=ner.NER_EXTRACTOR_NAME,
                status=ExtractionRun.Status.FAILED,
            ).values_list('document_id', flat=True)
            docs = docs.filter(id__in=list(failed_ids))
        if options['limit']:
            docs = docs[:options['limit']]
        ids = list(docs.values_list('id', flat=True))
        self.stdout.write(
            f'{len(ids)} document(s) × ner'
            f'{" (dry run)" if options["dry_run"] else ""}')
        if options['dry_run']:
            return

        consecutive_failures = 0
        for i, doc_id in enumerate(ids):
            if options['sync']:
                ner_document_task.run(doc_id, force=options['force'])
                run = ExtractionRun.objects.filter(
                    document_id=doc_id,
                    extractor_name=ner.NER_EXTRACTOR_NAME,
                    extractor_version=ner.NER_VERSION,
                ).first()
                if run and run.status == ExtractionRun.Status.FAILED:
                    consecutive_failures += 1
                    self.stderr.write(self.style.WARNING(
                        f'  doc {doc_id} FAILED: {run.error[:120]}'))
                    if consecutive_failures >= 3:
                        self.stderr.write(self.style.ERROR(
                            'Aborting: 3 consecutive failures (dead API key?)'))
                        return
                else:
                    consecutive_failures = 0
                    note = (run.error[:80] if run and run.error else '')
                    self.stdout.write(
                        f'  ner doc {doc_id} ({i + 1}/{len(ids)}) {note}')
            else:
                ner_document_task.apply_async(
                    args=[doc_id],
                    kwargs={'force': options['force']},
                    countdown=i * max(options['stagger'], 5.0),
                )
        if not options['sync']:
            self.stdout.write(self.style.SUCCESS(f'Enqueued {len(ids)} ner task(s)'))
