"""Project KB pipeline output from KB_DATA_DIR into the extraction_kb_* tables.

    python manage.py backfill_kb_to_db --all --dry-run       # counts, zero writes
    python manage.py backfill_kb_to_db --all                 # every book on disk
    python manage.py backfill_kb_to_db --all --only-unpersisted
    python manage.py backfill_kb_to_db --documents 12 34 --force

The tables are a rebuildable projection of the files, so this command is always
safe to re-run: books whose projection is current are skipped without a write.
It never calls an API and never re-extracts.
"""
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand

from search_engine.models import Document

from ...kb import config as kb_config
from ...kb import io_utils as kb_io
from ...kb import persist as kb_persist
from ...models import ExtractionRun


class Command(BaseCommand):
    help = 'Project KB extraction files into the extraction_kb_* tables'

    def add_arguments(self, parser):
        parser.add_argument('--documents', type=int, nargs='+', default=None,
                            help='Document ids to project')
        parser.add_argument('--all', action='store_true',
                            help='Every doc_* directory under KB_DATA_DIR/output')
        parser.add_argument('--only-unpersisted', action='store_true',
                            help='Skip documents that have been projected before')
        parser.add_argument('--limit', type=int, default=None)
        parser.add_argument('--force', action='store_true',
                            help='Re-project even when the projection is current')
        parser.add_argument('--allow-partial', action='store_true',
                            help='Also project books whose extraction is incomplete')
        parser.add_argument('--dry-run', action='store_true',
                            help='Build rows and print counts; write nothing')
        parser.add_argument('--stop-on-error', action='store_true',
                            help='Abort on the first failure instead of continuing')

    # --- document discovery --------------------------------------------------

    def _ids_from_disk(self):
        root = Path(settings.KB_DATA_DIR) / 'output'
        if not root.is_dir():
            self.stderr.write(self.style.WARNING(f'{root} does not exist'))
            return []
        ids = []
        for d in sorted(root.glob('doc_*')):
            if not (d / 'extraction.json').exists():
                continue
            try:
                ids.append(int(d.name.split('_', 1)[1]))
            except (IndexError, ValueError):
                self.stderr.write(self.style.WARNING(
                    f'{d.name}: not a doc_<pk> directory, skipping'))
        return ids

    def _claims_this_pk(self, document) -> bool:
        """Guard against a KB_DATA_DIR copied from another environment: the
        files record which document they were built from, and projecting one
        book's mentions onto another document's pk would be silent corruption.
        """
        book_id = kb_config.book_id_for(document)
        outdir = kb_config.output_dir(book_id)
        for fname, key in (('extraction_meta.json', 'document_id'),
                           ('segments.json', 'document_id')):
            data = kb_io.read_json_or_none(outdir / fname) or {}
            stored = data.get(key)
            if stored is not None and int(stored) != document.pk:
                self.stderr.write(self.style.ERROR(
                    f'doc {document.pk}: {fname} was built for document {stored} — '
                    f'skipping (is KB_DATA_DIR from another environment?)'))
                return False
        return True

    def _documents(self, options):
        ids = options['documents'] or (
            self._ids_from_disk() if options['all'] else None)
        if not ids:
            return []
        if options['only_unpersisted']:
            projected = set(ExtractionRun.objects.filter(
                document_id__in=ids,
                extractor_name=kb_config.KB_EXTRACTOR_NAME,
                extractor_version=kb_config.KB_PIPELINE_VERSION,
            ).exclude(persisted_hash='').values_list('document_id', flat=True))
            ids = [i for i in ids if i not in projected]
        docs = list(Document.objects.filter(id__in=ids).order_by('id'))
        for missing in sorted(set(ids) - {d.id for d in docs}):
            self.stderr.write(self.style.WARNING(
                f'document {missing} has files but no DB row — skipping'))
        if options['limit']:
            docs = docs[:options['limit']]
        return docs

    # --- run -----------------------------------------------------------------

    def handle(self, *args, **options):
        documents = self._documents(options)
        if not documents:
            self.stdout.write('Nothing to do — pass --documents or --all.')
            return

        totals = dict(mentions=0, relations=0, claims=0, appraisals=0,
                      deduped=0, dropped=0, page_ok=0, page_missing=0,
                      reused=0, reanchored=0)
        projected, errors = 0, 0
        skipped: dict[str, list[int]] = {}
        legacy: list[int] = []

        for document in documents:
            if not self._claims_this_pk(document):
                errors += 1
                continue
            try:
                result = kb_persist.persist_document(
                    document, force=options['force'],
                    allow_partial=options['allow_partial'],
                    dry_run=options['dry_run'])
            except Exception as exc:  # noqa: BLE001
                errors += 1
                self.stderr.write(self.style.ERROR(
                    f'doc {document.pk}: {type(exc).__name__}: {exc}'))
                if options['stop_on_error']:
                    raise
                continue

            if result.skipped:
                skipped.setdefault(result.reason, []).append(document.pk)
                continue
            projected += 1
            if result.disk_format < 2:
                legacy.append(document.pk)
            totals['mentions'] += result.mentions
            totals['relations'] += result.relations
            totals['claims'] += result.claims
            totals['appraisals'] += result.appraisals
            totals['deduped'] += result.mentions_deduped
            totals['dropped'] += result.assertions_dropped
            totals['page_ok'] += result.page_spans_resolved
            totals['page_missing'] += result.page_spans_missing
            totals['reused'] += result.verified_reused
            totals['reanchored'] += result.verified_reanchored
            self.stdout.write(
                f'doc {document.pk}: {result.mentions} mentions, '
                f'{result.relations} relations, {result.claims} claims, '
                f'{result.appraisals} appraisals')

        self._report(documents, projected, errors, skipped, legacy, totals, options)

    def _report(self, documents, projected, errors, skipped, legacy, totals, options):
        verb = 'would project' if options['dry_run'] else 'projected'
        self.stdout.write('')
        self.stdout.write(f'{len(documents)} documents considered')
        self.stdout.write(
            f'  {projected} {verb}: {totals["mentions"]} mentions, '
            f'{totals["relations"]} relations, {totals["claims"]} claims, '
            f'{totals["appraisals"]} appraisals')
        if totals['deduped'] or totals['dropped']:
            self.stdout.write(
                f'  {totals["deduped"]} duplicate mentions collapsed, '
                f'{totals["dropped"]} assertions dropped (missing endpoints)')
        if totals['page_missing']:
            self.stdout.write(
                f'  {totals["page_missing"]} of '
                f'{totals["page_ok"] + totals["page_missing"]} page spans could not '
                f'be re-located in raw page text (stored NULL)')
        if totals['reused'] or totals['reanchored']:
            self.stdout.write(
                f'  {totals["reused"]} human-verified rows reused, '
                f'{totals["reanchored"]} re-anchored')
        for reason, ids in sorted(skipped.items()):
            shown = ' '.join(str(i) for i in ids[:10])
            more = f' (+{len(ids) - 10} more)' if len(ids) > 10 else ''
            line = f'  {len(ids)} skipped: {reason}'
            if reason == 'normalization drift':
                self.stderr.write(self.style.ERROR(
                    f'{line} -> run_kb_pipeline --documents {shown}{more} '
                    f'--force-stage1'))
            elif reason == 'incomplete extraction':
                self.stdout.write(f'{line} (pass --allow-partial to include)')
            else:
                self.stdout.write(line)
        if errors:
            self.stderr.write(self.style.ERROR(f'  {errors} failed'))

        if legacy:
            shown = ' '.join(str(i) for i in legacy[:10])
            more = f' (+{len(legacy) - 10} more)' if len(legacy) > 10 else ''
            self.stdout.write('')
            self.stdout.write(self.style.WARNING(
                f'{len(legacy)} of the projected books are at legacy disk_format 1: '
                f'`trigger` and `normalized_form` are absent and name analysis is '
                f'limited to kunya/shuhra, because extraction.json predates the '
                f'un-pruning fix. Everything else is complete and correct.\n'
                f'To restore those fields, re-run Stage 2:\n'
                f'    python manage.py run_kb_pipeline --documents {shown}{more} '
                f'--sync --force-stage2\n'
                f'    python manage.py backfill_kb_to_db --documents {shown}{more} '
                f'--force\n'
                f'CHECK THE COST FIRST with `run_kb_pipeline --documents <ids> '
                f'--dry-run`. Cached responses replay free, but the cache key is '
                f'sha256(model, prompt) — so if KB_EXTRACT_MODEL or any Stage 2 '
                f'prompt has changed since the book was extracted, every window '
                f're-bills AND the new extraction may differ from the old one.'))
