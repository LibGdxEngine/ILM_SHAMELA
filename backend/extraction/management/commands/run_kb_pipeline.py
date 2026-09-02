"""Operate the KB extraction pipeline (extraction/kb/) over documents.

    python manage.py run_kb_pipeline --documents 12 34 --dry-run   # cost estimate, zero API calls
    python manage.py run_kb_pipeline --documents 12 --status       # resume report + QC
    python manage.py run_kb_pipeline --documents 12 --sync --windows-limit 3 --viewers
                                                                   # paid smoke run + QC HTML
    python manage.py run_kb_pipeline --documents 12 --sync         # whole book, inline
    python manage.py run_kb_pipeline --all --limit 20              # enqueue Celery tasks

--dry-run / --status / --viewers never call an API and never enqueue. Manual
runs bypass the auto-run guards (KB_MAX_AUTO_COST_USD etc.) — the dry-run
estimate is the habit that replaces them. Cached LLM calls always replay for
free, so re-running after an interrupt, a crash, or a partial run only bills
the remainder.
"""
import time

from django.core.management.base import BaseCommand

from search_engine.models import Document


class Command(BaseCommand):
    help = 'Run the KB extraction pipeline (segments + mentions/relations) over documents'

    def add_arguments(self, parser):
        parser.add_argument('--documents', type=int, nargs='+', default=None,
                            help='Document ids to process')
        parser.add_argument('--all', action='store_true',
                            help='All processed documents')
        parser.add_argument('--limit', type=int, default=None)
        parser.add_argument('--dry-run', action='store_true',
                            help='Print stage 1+2 cost estimates; zero API calls')
        parser.add_argument('--status', action='store_true',
                            help='Resume report (what a re-run would bill) + QC')
        parser.add_argument('--viewers', action='store_true',
                            help='Write segments_view.html / windows_view.html')
        parser.add_argument('--force-stage1', action='store_true',
                            help='Redo splitting even if segments.json exists')
        parser.add_argument('--force-stage2', action='store_true',
                            help='Redo extraction even if extraction.json exists')
        parser.add_argument('--windows-limit', type=int, default=None,
                            help='Extract only the first N windows (smoke test)')
        parser.add_argument('--sync', action='store_true',
                            help='Run inline instead of enqueuing Celery tasks')
        parser.add_argument('--stagger', type=float, default=1.0,
                            help='Seconds between enqueued tasks (default 1.0)')

    def _documents(self, options):
        if options['documents']:
            docs = Document.objects.filter(id__in=options['documents']).order_by('id')
            missing = set(options['documents']) - {d.id for d in docs}
            for m in sorted(missing):
                self.stderr.write(self.style.WARNING(f'document {m} not found'))
            return list(docs)
        if options['all']:
            qs = Document.objects.filter(processed=True).order_by('id')
            if options['limit']:
                qs = qs[:options['limit']]
            return list(qs)
        self.stderr.write(self.style.ERROR('Pass --documents ID [ID ...] or --all'))
        return []

    def handle(self, *args, **options):
        from extraction.kb import config, runner, viewers

        docs = self._documents(options)
        if not docs:
            return

        if options['dry_run'] or options['status'] or options['viewers']:
            for doc in docs:
                book_id = config.book_id_for(doc)
                ndoc = runner.normalize_document(doc)
                if options['dry_run']:
                    e1 = runner.estimate_stage1(ndoc)
                    self.stdout.write(
                        f'{book_id} ({doc.title[:50]}): {e1["chars"]:,} chars\n'
                        f'  stage 1: {e1["chunks"]} chunk(s), '
                        f'in~{e1["tokens_in"]:,} out~{e1["tokens_out"]:,} tok '
                        f'-> ~${e1["cost_usd"]:.4f}  ({e1["model"]})')
                    e2 = runner.estimate_stage2(
                        book_id, ndoc, windows_limit=options['windows_limit'])
                    if e2 is None:
                        self.stdout.write(
                            '  stage 2: blocked on stage 1 (no segments.json yet)')
                    else:
                        self.stdout.write(
                            f'  stage 2: {e2["windows"]} windows '
                            f'({e2["oversized"]} oversized) -> {e2["calls"]} calls, '
                            f'in~{e2["tokens_in"]:,} out~{e2["tokens_out"]:,} tok '
                            f'-> ~${e2["cost_usd"]:.2f}  ({e2["model"]}, upper bound)')
                if options['status']:
                    self.stdout.write(runner.resume_status(book_id, ndoc))
                    self.stdout.write(runner.stage1_qc(book_id, ndoc))
                    self.stdout.write(runner.stage2_qc(book_id, ndoc))
                if options['viewers']:
                    for p in (viewers.write_segments_view(book_id, ndoc),
                              viewers.write_windows_view(book_id, ndoc)):
                        if p is not None:
                            self.stdout.write(f'  wrote {p}')
            return

        from extraction.tasks import kb_extract_document_task

        kwargs = {'force_stage1': options['force_stage1'],
                  'force_stage2': options['force_stage2'],
                  'windows_limit': options['windows_limit'],
                  'auto': False}
        for i, doc in enumerate(docs):
            if options['sync']:
                kb_extract_document_task.run(doc.id, **kwargs)
                self.stdout.write(f'  processed doc {doc.id} ({i + 1}/{len(docs)})')
            else:
                kb_extract_document_task.apply_async(args=[doc.id], kwargs=kwargs)
                self.stdout.write(f'  enqueued doc {doc.id} ({i + 1}/{len(docs)})')
                if options['stagger'] and i + 1 < len(docs):
                    time.sleep(options['stagger'])
        self.stdout.write(self.style.SUCCESS(f'{len(docs)} document(s) handled'))
