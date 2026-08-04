"""Celery tasks: deterministic extraction pass (+ the Layer-0 LLM classifier
lives in ``classify`` — separate task, separate failure envelope).

``extract_document_task`` is enqueued from ``process_document_task``'s success
path (lazy import there), so reprocessing a document automatically re-extracts;
the per-run ``corpus_hash`` makes unchanged re-runs cheap no-ops.
"""
import hashlib
import logging

from celery import shared_task
from django.db import transaction
from django.utils import timezone

logger = logging.getLogger(__name__)


def _page_hash(content: str) -> str:
    return hashlib.sha256((content or '').encode('utf-8')).hexdigest()


def _corpus_hash(page_hashes) -> str:
    joined = '\n'.join(page_hashes)
    return hashlib.sha256(joined.encode('utf-8')).hexdigest()


def _build_context(document):
    from .extractors import DocContext

    centuries = tuple(sorted({
        c for c in document.authors.values_list('death_century', flat=True)
        if c is not None
    }))
    return DocContext(
        title=document.title or '',
        language=document.language or '',
        author_death_centuries=centuries,
    )


def _replace_versioned_rows(model, document, extractor_name, extractor_version,
                            page_hashes, *, has_span=True):
    """Replace one extractor's previous machine output ahead of a re-run.

    Deletes the same-version non-verified rows (so re-runs don't trip the
    unique constraint), supersedes other versions' active rows, and flags
    human-verified rows whose page hash drifted as ``orphaned`` (never
    deletes them). Span-less models (``has_span=False``) skip the orphan
    step. Must be called inside ``transaction.atomic()``.
    """
    from .models import EntityMention

    now = timezone.now()
    stale = model.objects.filter(
        document=document, extractor_name=extractor_name, human_verified=False)
    stale.filter(extractor_version=extractor_version).delete()
    stale.filter(superseded_at__isnull=True).exclude(
        extractor_version=extractor_version).update(superseded_at=now)
    if not has_span:
        return
    for verified in model.objects.filter(
            document=document, extractor_name=extractor_name, human_verified=True):
        current = page_hashes.get(verified.page_number)
        if current and current != verified.content_hash and \
                verified.review_status != EntityMention.ReviewStatus.ORPHANED:
            verified.review_status = EntityMention.ReviewStatus.ORPHANED
            verified.save(update_fields=['review_status'])


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def extract_document_task(self, doc_id: int, extractors=None, force: bool = False):
    """Run the deterministic extractors over one document's pages.

    Per (extractor, version): skip when the stored ``corpus_hash`` matches and
    ``force`` is off; otherwise re-extract, then transactionally supersede the
    previous non-verified rows of the SAME extractor (any version) —
    human-verified rows are never deleted; when their page hash no longer
    matches they are flagged ``orphaned`` for re-anchoring in the admin.
    """
    from search_engine.models import Document
    from search_engine.utils import split_document_content_into_pages

    from .extractors import EXTRACTOR_REGISTRY
    from .models import EntityMention, ExtractionRun

    try:
        document = Document.objects.get(id=doc_id)
    except Document.DoesNotExist:
        logger.warning('[EXTRACT] document %s vanished', doc_id)
        return

    pages = split_document_content_into_pages(document.content or '')
    page_hashes = {p['page_number']: _page_hash(p['content']) for p in pages}
    corpus_hash = _corpus_hash(
        page_hashes[pn] for pn in sorted(page_hashes))
    ctx = _build_context(document)

    wanted = extractors or list(EXTRACTOR_REGISTRY)
    for name in wanted:
        extractor_cls = EXTRACTOR_REGISTRY.get(name)
        if extractor_cls is None:
            logger.warning('[EXTRACT] unknown extractor %r', name)
            continue
        extractor = extractor_cls()

        run, _created = ExtractionRun.objects.get_or_create(
            document=document,
            extractor_name=extractor.name,
            extractor_version=extractor.version,
        )
        if (not force and run.status == ExtractionRun.Status.SUCCEEDED
                and run.corpus_hash == corpus_hash):
            continue

        run.status = ExtractionRun.Status.RUNNING
        run.started_at = timezone.now()
        run.error = ''
        run.save(update_fields=['status', 'started_at', 'error'])

        try:
            spans = []
            for page in pages:
                for span in extractor.extract(page['content'], page['page_number'], ctx):
                    spans.append((page['page_number'], span))

            with transaction.atomic():
                _replace_versioned_rows(
                    EntityMention, document, extractor.name, extractor.version,
                    page_hashes)

                resolver = _CanonicalResolver()
                rows = []
                seen_keys = set()
                for page_number, span in spans:
                    dedupe_key = (span.entity_type, page_number,
                                  span.char_start, span.char_end)
                    if dedupe_key in seen_keys:
                        continue
                    seen_keys.add(dedupe_key)
                    person_id, place_id, _work_id = resolver.resolve(span)
                    rows.append(EntityMention(
                        document=document,
                        page_number=page_number,
                        char_start=span.char_start,
                        char_end=span.char_end,
                        surface_text=span.surface_text[:2000],
                        normalized_text=span.normalized_text[:255],
                        normalized=span.normalized,
                        entity_type=span.entity_type,
                        person_id=person_id,
                        place_id=place_id,
                        confidence=span.confidence,
                        extractor_name=extractor.name,
                        extractor_version=extractor.version,
                        content_hash=page_hashes.get(page_number, ''),
                        review_status=(
                            EntityMention.ReviewStatus.PENDING
                            if span.needs_review or span.confidence < 0.7
                            else EntityMention.ReviewStatus.AUTO
                        ),
                    ))
                EntityMention.objects.bulk_create(rows, batch_size=500)

                run.status = ExtractionRun.Status.SUCCEEDED
                run.corpus_hash = corpus_hash
                run.mention_count = len(rows)
                run.finished_at = timezone.now()
                run.save(update_fields=[
                    'status', 'corpus_hash', 'mention_count', 'finished_at'])
        except Exception as exc:  # noqa: BLE001
            logger.exception('[EXTRACT] %s failed on doc %s', extractor.name, doc_id)
            run.status = ExtractionRun.Status.FAILED
            run.error = str(exc)[:2000]
            run.finished_at = timezone.now()
            run.save(update_fields=['status', 'error', 'finished_at'])

    # Refresh the document's ES rollup fields (best-effort — search keeps
    # serving the previous rollup if ES is briefly unavailable).
    try:
        from .rollup import refresh_document_index
        refresh_document_index(document)
    except Exception as exc:  # noqa: BLE001
        logger.warning('[EXTRACT] ES rollup refresh failed for doc %s: %s', doc_id, exc)


@shared_task(bind=True, max_retries=4, rate_limit='30/m')
def classify_document_task(self, doc_id: int, force: bool = False):
    """Layer-0 LLM classification (one call per document).

    Separate from ``extract_document_task`` so LLM failures/rate limits never
    couple with the deterministic pass. Idempotent on
    ``(status=succeeded, extractor_version)`` unless ``force``. Failures are
    recorded loudly (``status='failed'`` + ``degraded_reason``); transient
    transport errors retry with backoff, config errors (dead key) do not.
    """
    from search_engine.models import Document

    from . import layer0
    from .models import DocumentMeta

    try:
        document = Document.objects.get(id=doc_id)
    except Document.DoesNotExist:
        logger.warning('[LAYER0] document %s vanished', doc_id)
        return

    meta, _created = DocumentMeta.objects.get_or_create(document=document)
    if meta.human_verified and not force:
        return
    if (not force and meta.status == DocumentMeta.Status.SUCCEEDED
            and meta.extractor_version == layer0.LAYER0_VERSION):
        return

    meta.attempts += 1
    try:
        args = layer0.classify_document(document)
        import os
        layer0.apply_classification(
            meta, args, os.environ.get('OPENROUTER_AGENT_MODEL', ''))
        meta.save()
        try:
            from .rollup import refresh_document_index
            refresh_document_index(document)
        except Exception as refresh_exc:  # noqa: BLE001
            logger.warning('[LAYER0] ES rollup refresh failed for doc %s: %s',
                           doc_id, refresh_exc)
    except Exception as exc:  # noqa: BLE001
        message = str(exc)[:1000]
        logger.exception('[LAYER0] classification failed for doc %s', doc_id)
        meta.status = DocumentMeta.Status.FAILED
        meta.degraded_reason = message
        meta.save()
        # Config/auth errors (missing or dead key, no content) won't heal on
        # retry; only transport-looking failures re-queue. Sync callers
        # (backfill --sync) have no task request id — never raise retry there.
        transient = not (
            'OPENROUTER_API_KEY' in message
            or 'no page content' in message
            or '401' in message
            or 'AuthenticationError' in type(exc).__name__
        )
        retries = self.request.retries or 0
        if transient and self.request.id and retries < self.max_retries:
            raise self.retry(exc=exc, countdown=min(60 * (2 ** retries), 600))


@shared_task(bind=True, max_retries=4, rate_limit='6/m')
def ner_document_task(self, doc_id: int, force: bool = False, meta_waits: int = 0):
    """LLM NER pass over the first 25 pages (≤5 OpenRouter calls/document —
    the 6/m task rate keeps LLM-call volume at the layer0 30/m precedent).

    Sequencing: genre-conditional prompts want layer0's ``DocumentMeta``, but
    the two tasks race (no Celery chains, by repo policy). When meta is still
    pending, the task re-enqueues itself with a bounded ``meta_waits`` counter
    (async context only) instead of blocking a worker slot; after 3 waits it
    proceeds with the title-heuristic playbook.

    Idempotent on ``ExtractionRun(status=succeeded, corpus_hash)`` where the
    hash covers ONLY the first-25-page slice — edits beyond page 25 never
    re-trigger a paid run. Failure envelope mirrors ``classify_document_task``
    (dead key / 401 terminal + loud; transport errors retry with backoff).
    """
    from search_engine.models import Document
    from search_engine.utils import split_document_content_into_pages

    from . import ner
    from .models import (DocumentMeta, DocumentStructuredExtraction,
                         EntityMention, EntityRelation, ExtractionRun)

    try:
        document = Document.objects.get(id=doc_id)
    except Document.DoesNotExist:
        logger.warning('[NER] document %s vanished', doc_id)
        return

    pages = split_document_content_into_pages(
        document.content or '')[:ner.NER_PAGE_LIMIT]
    page_hashes = {p['page_number']: _page_hash(p['content']) for p in pages}
    corpus_hash = _corpus_hash(page_hashes[pn] for pn in sorted(page_hashes))

    run, _created = ExtractionRun.objects.get_or_create(
        document=document,
        extractor_name=ner.NER_EXTRACTOR_NAME,
        extractor_version=ner.NER_VERSION,
    )
    if (not force and run.status == ExtractionRun.Status.SUCCEEDED
            and run.corpus_hash == corpus_hash):
        return

    meta = DocumentMeta.objects.filter(document=document).first()
    meta_pending = meta is None or (
        not meta.human_verified and meta.status == DocumentMeta.Status.PENDING)
    if meta_pending and meta_waits < 3 and self.request.id:
        ner_document_task.apply_async(
            args=[doc_id], kwargs={'force': force, 'meta_waits': meta_waits + 1},
            countdown=120)
        return

    run.status = ExtractionRun.Status.RUNNING
    run.started_at = timezone.now()
    run.error = ''
    run.save(update_fields=['status', 'started_at', 'error'])

    try:
        result = ner.extract_document_entities(document, pages, meta)

        with transaction.atomic():
            _replace_versioned_rows(
                EntityMention, document, ner.NER_EXTRACTOR_NAME,
                ner.NER_VERSION, page_hashes)
            _replace_versioned_rows(
                EntityRelation, document, ner.NER_EXTRACTOR_NAME,
                ner.NER_VERSION, page_hashes)
            _replace_versioned_rows(
                DocumentStructuredExtraction, document, ner.NER_EXTRACTOR_NAME,
                ner.NER_VERSION, page_hashes, has_span=False)

            resolver = _CanonicalResolver()
            # Verified same-version rows survived the replace step; re-use
            # them instead of re-creating (unique constraint).
            verified_existing = {
                (vm.entity_type, vm.page_number, vm.char_start, vm.char_end): vm
                for vm in EntityMention.objects.filter(
                    document=document, extractor_name=ner.NER_EXTRACTOR_NAME,
                    extractor_version=ner.NER_VERSION, human_verified=True)
            }
            new_rows = []
            mention_objs = []  # index-aligned with result.mentions
            for m in result.mentions:
                key = (m.entity_type, m.page_number, m.char_start, m.char_end)
                existing = verified_existing.get(key)
                if existing is not None:
                    mention_objs.append(existing)
                    continue
                person_id, place_id, work_id = resolver.resolve(m)
                row = EntityMention(
                    document=document,
                    page_number=m.page_number,
                    char_start=m.char_start,
                    char_end=m.char_end,
                    surface_text=m.surface_text[:2000],
                    normalized_text=m.normalized_text[:255],
                    normalized=m.normalized,
                    entity_type=m.entity_type,
                    person_id=person_id,
                    place_id=place_id,
                    work_id=work_id,
                    confidence=m.confidence,
                    extractor_name=ner.NER_EXTRACTOR_NAME,
                    extractor_version=ner.NER_VERSION,
                    content_hash=page_hashes.get(m.page_number, ''),
                    review_status=(
                        EntityMention.ReviewStatus.PENDING
                        if m.needs_review or m.confidence < 0.7
                        else EntityMention.ReviewStatus.AUTO
                    ),
                )
                new_rows.append(row)
                mention_objs.append(row)
            EntityMention.objects.bulk_create(new_rows, batch_size=500)

            verified_rel_keys = set(EntityRelation.objects.filter(
                document=document, extractor_name=ner.NER_EXTRACTOR_NAME,
                extractor_version=ner.NER_VERSION, human_verified=True,
            ).values_list('dedupe_key', flat=True))
            rel_rows = []
            seen_rel_keys = set()
            for r in result.relations:
                subject = (mention_objs[r.subject_index]
                           if r.subject_index is not None else None)
                obj = (mention_objs[r.object_index]
                       if r.object_index is not None else None)
                subject_key = (
                    f'm:{subject.page_number}:{subject.char_start}-{subject.char_end}'
                    if subject is not None else f't:{r.subject_text}')
                object_key = (
                    f'm:{obj.page_number}:{obj.char_start}-{obj.char_end}'
                    if obj is not None else f't:{r.object_text}')
                dedupe = hashlib.sha256('|'.join([
                    r.predicate, subject_key, object_key, str(r.page_number),
                    str(r.char_start), str(r.char_end),
                ]).encode('utf-8')).hexdigest()
                if dedupe in seen_rel_keys or dedupe in verified_rel_keys:
                    continue
                seen_rel_keys.add(dedupe)
                rel_rows.append(EntityRelation(
                    document=document,
                    predicate=r.predicate,
                    subject_mention=subject,
                    object_mention=obj,
                    subject_person_id=(
                        subject.person_id
                        if subject is not None and subject.entity_type == 'person'
                        else None),
                    object_person_id=(
                        obj.person_id
                        if obj is not None and obj.entity_type == 'person'
                        else None),
                    object_place_id=(
                        obj.place_id if obj is not None
                        else r.qualifiers.get('place_id')),
                    object_work_id=obj.work_id if obj is not None else None,
                    subject_text=r.subject_text[:255],
                    object_text=r.object_text[:255],
                    qualifiers=r.qualifiers,
                    page_number=r.page_number,
                    char_start=r.char_start,
                    char_end=r.char_end,
                    evidence_text=r.evidence_text[:2000],
                    content_hash=page_hashes.get(r.page_number, ''),
                    confidence=r.confidence,
                    extractor_name=ner.NER_EXTRACTOR_NAME,
                    extractor_version=ner.NER_VERSION,
                    dedupe_key=dedupe,
                    review_status=(
                        EntityMention.ReviewStatus.PENDING
                        if r.needs_review or r.confidence < 0.7
                        else EntityMention.ReviewStatus.AUTO
                    ),
                ))
            EntityRelation.objects.bulk_create(rel_rows, batch_size=500)

            verified_structure_kinds = set(
                DocumentStructuredExtraction.objects.filter(
                    document=document, extractor_name=ner.NER_EXTRACTOR_NAME,
                    extractor_version=ner.NER_VERSION, human_verified=True,
                ).values_list('kind', flat=True))
            for kind, data in result.structures.items():
                if kind in verified_structure_kinds:
                    continue
                DocumentStructuredExtraction.objects.create(
                    document=document,
                    kind=kind,
                    payload=data['payload'],
                    page_refs=data['page_refs'],
                    confidence=data['confidence'],
                    extractor_name=ner.NER_EXTRACTOR_NAME,
                    extractor_version=ner.NER_VERSION,
                    model_id=result.model_id,
                    review_status=(
                        EntityMention.ReviewStatus.PENDING
                        if data['confidence'] < 0.7
                        else EntityMention.ReviewStatus.AUTO
                    ),
                )

            emitted = result.stats.get('emitted', 0)
            anchored = result.stats.get('anchored', 0)
            note = (f'stats: anchored={anchored}/{emitted} '
                    f'relations={len(rel_rows)} playbook={result.stats.get("playbook")}'
                    f' model={result.model_id}')
            if result.stats.get('failed_windows'):
                note += f' failed_windows={result.stats["failed_windows"]}'
            if result.stats.get('truncated'):
                note += ' truncated=1'
            if emitted and anchored / emitted < 0.8:
                note += ' LOW_ANCHOR_RATE'
            run.status = ExtractionRun.Status.SUCCEEDED
            run.corpus_hash = corpus_hash
            run.mention_count = len(new_rows)
            run.error = note[:2000]
            run.finished_at = timezone.now()
            run.save(update_fields=[
                'status', 'corpus_hash', 'mention_count', 'error', 'finished_at'])

        try:
            from .rollup import refresh_document_index
            refresh_document_index(document)
        except Exception as refresh_exc:  # noqa: BLE001
            logger.warning('[NER] ES rollup refresh failed for doc %s: %s',
                           doc_id, refresh_exc)
    except Exception as exc:  # noqa: BLE001
        message = str(exc)[:2000]
        logger.exception('[NER] extraction failed for doc %s', doc_id)
        run.status = ExtractionRun.Status.FAILED
        run.error = message
        run.finished_at = timezone.now()
        run.save(update_fields=['status', 'error', 'finished_at'])
        transient = not (
            'OPENROUTER_API_KEY' in message
            or 'no page content' in message
            or '401' in message
            or 'AuthenticationError' in type(exc).__name__
        )
        retries = self.request.retries or 0
        if transient and self.request.id and retries < self.max_retries:
            raise self.retry(exc=exc, countdown=min(60 * (2 ** retries), 600))


class _CanonicalResolver:
    """Resolve ``canonical_hint``s to Person/Place/Work FKs (cached per task
    run). Ambiguous person blocking keys resolve only when the hinted death
    year disambiguates (±5y) — otherwise NIL, per the conservative-linking
    policy (the extractor never guesses between namesakes)."""

    def __init__(self):
        self._place_cache = {}
        self._person_cache = {}
        self._work_cache = {}

    def resolve(self, span):
        hint = span.canonical_hint or {}
        person_id = None
        place_id = None
        work_id = None
        if 'place_id' in hint:
            place_id = hint['place_id']
        elif 'place_normalized' in hint:
            key = hint['place_normalized']
            if key not in self._place_cache:
                from .models import PlaceName
                row = PlaceName.objects.filter(normalized=key).values_list(
                    'place_id', flat=True).first()
                self._place_cache[key] = row
            place_id = self._place_cache[key]
        if 'person_id' in hint:
            person_id = hint['person_id']
        elif 'person_blocking_key' in hint:
            person_id = self._resolve_person(
                hint['person_blocking_key'], hint.get('person_death_year'))
        if 'work_id' in hint:
            work_id = hint['work_id']
        elif 'work_normalized' in hint:
            key = hint['work_normalized']
            if key not in self._work_cache:
                from .models import WorkName
                row = WorkName.objects.filter(normalized=key).values_list(
                    'work_id', flat=True).first()
                self._work_cache[key] = row
            work_id = self._work_cache[key]
        return person_id, place_id, work_id

    def _resolve_person(self, key, death_year):
        cache_key = (key, death_year)
        if cache_key not in self._person_cache:
            from .models import Person
            candidates = list(Person.objects.filter(blocking_key=key)
                              .values_list('id', 'death_year_hijri')[:20])
            person_id = None
            if len(candidates) == 1:
                person_id = candidates[0][0]
            elif candidates and death_year:
                close = [pid for pid, dy in candidates
                         if dy is not None and abs(dy - death_year) <= 5]
                if len(close) == 1:
                    person_id = close[0]
            self._person_cache[cache_key] = person_id
        return self._person_cache[cache_key]
