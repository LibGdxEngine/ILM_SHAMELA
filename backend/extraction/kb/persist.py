"""Project one book's KB pipeline output into the ``extraction_kb_*`` tables.

The files under ``KB_DATA_DIR`` remain the source of truth; these tables are a
rebuildable projection. That is why a failure here never fails an extraction run
(see ``tasks._persist_kb_projection``) and why ``backfill_kb_to_db`` can always
reconstruct them from disk.

Input is ALWAYS the on-disk ``extraction.json`` via ``mapping.load_extraction``,
never an in-memory ``DocumentExtraction``: ``run_stage2`` has a skip path that
returns without one, so a memory-first writer would make DB content depend on
which branch happened to run, and a re-run would silently downgrade rows a fresh
run had written. Since disk_format 2 the two are equivalent anyway.

Whether to project is decided by ``persisted_hash`` alone — deliberately
independent of the extraction-level skip checks, so a book extracted before
these tables existed is ingested on its next task run without re-billing a
single LLM call.
"""
import bisect
import hashlib
import logging
from dataclasses import dataclass, field
from enum import Enum

from django.db import transaction
from django.utils import timezone

from . import config, io_utils, mapping, split, textmatch
from .normalize import NormalizedDoc, normalize_document
from .schema import APPRAISAL_RANK_LEVEL, DocumentExtraction, SegmentedDocument

logger = logging.getLogger(__name__)

# Bump to re-project every book on its next run without touching
# KB_PIPELINE_VERSION (which would invalidate paid LLM caches).
PERSIST_VERSION = 'kbdb-1'

_MAX_EVIDENCE = 2000


@dataclass
class PersistResult:
    skipped: bool = False
    reason: str = ''
    disk_format: int = 0
    mentions: int = 0
    relations: int = 0
    claims: int = 0
    appraisals: int = 0
    mentions_deduped: int = 0
    assertions_dropped: int = 0
    page_spans_resolved: int = 0
    page_spans_missing: int = 0
    verified_reused: int = 0
    verified_reanchored: int = 0

    @property
    def total(self) -> int:
        return self.mentions + self.relations + self.claims + self.appraisals


def persist_key(norm_sha: str, disk_format: int) -> str:
    return hashlib.sha256(
        f'{norm_sha}|{PERSIST_VERSION}|{disk_format}'.encode('utf-8')).hexdigest()


# --- small value helpers -----------------------------------------------------

def _v(x) -> str:
    """Enum/str/None -> the stored string ('' for absent)."""
    if x is None:
        return ''
    return x.value if isinstance(x, Enum) else str(x)


def _men_key(m) -> tuple[str, int, int]:
    """A mention's deterministic identity. The pipeline's own ``men_*`` ids are
    uuid4 per run, so spans are what identity is built from."""
    s = m.provenance.span
    return (m.label, s.start, s.end)


def _key_str(m) -> str:
    lbl, start, end = _men_key(m)
    return f'{lbl}:{start}:{end}'


def _sha(*parts) -> str:
    return hashlib.sha256('|'.join(str(p) for p in parts).encode('utf-8')).hexdigest()


def _time_fields(parsed):
    """ParsedTime -> (time_kind, hijri_year, hijri_year_to, approximate)."""
    if parsed is None:
        return '', None, None, False
    kind = getattr(parsed, 'kind', '')
    if kind == 'absolute':
        d = parsed.date
        return 'absolute', d.year, None, bool(d.approximate)
    if kind == 'range':
        r = parsed.range
        return ('range', r.earliest.year, r.latest.year,
                bool(r.earliest.approximate or r.latest.approximate))
    return 'relative', None, None, False


def _ref_key(ref) -> str:
    if ref is None:
        return ''
    if getattr(ref, 'ref_kind', '') == 'quran':
        key = f'quran:{ref.sura}:{ref.aya_start}'
        # A one-aya range is the same verse as a bare reference; keying it
        # 'quran:4:101-101' would split one verse across two grouping keys.
        if ref.aya_end and ref.aya_end != ref.aya_start:
            key += f'-{ref.aya_end}'
        return key[:64]
    return f'{ref.collection}:{ref.hadith_number}'[:64]


def _dump(obj) -> dict:
    return obj.model_dump(mode='json') if obj is not None else {}


# --- page-relative offsets ---------------------------------------------------

class _PageSpanResolver:
    """Re-locate a surface form inside RAW page content.

    Subtracting ``ndoc.page_offsets`` would be wrong: those index the NORMALIZED
    text, while the reader (``EntityMention``, ``Highlight``) speaks raw page
    offsets, and normalization collapses whitespace runs, strips markdown and
    drops blank lines. On OCR'd books that drifts by tens of characters a page.
    So the span is found the same way the pipeline found it in the first place —
    exact match, then the folded shadow with an index-back map.
    """

    def __init__(self, pages):
        self._raw = {p['page_number']: p['content'] for p in pages}
        self._shadows: dict[int, tuple[str, list[int]]] = {}

    def raw(self, page_number: int) -> str | None:
        return self._raw.get(page_number)

    def locate(self, page_number: int, surface: str, occurrence: int):
        content = self._raw.get(page_number)
        if not content or not surface:
            return None
        sh = self._shadows.get(page_number)
        if sh is None:
            sh = self._shadows[page_number] = textmatch.shadow_with_map(content)
        return textmatch.locate_in_focus(content, sh[0], sh[1], surface, occurrence)


def _page_number(ndoc: NormalizedDoc, prov, fallback_offset: int) -> int:
    page = prov.page
    if page is not None and str(page).isdigit():
        return int(page)
    if ndoc.page_offsets:
        i = bisect.bisect_right(ndoc.page_offsets, fallback_offset) - 1
        if i >= 0 and str(ndoc.page_labels[i]).isdigit():
            return int(ndoc.page_labels[i])
    return 1


# --- segment denormalization -------------------------------------------------

class _Segments:
    """``segments.json`` as a lookup. There is no segment table — only
    ``segment_type`` is carried onto the rows, which is the part worth querying.
    """

    def __init__(self, sdoc: SegmentedDocument | None):
        self._by_id: dict[str, str] = {}
        self._starts: list[int] = []
        self._types: list[str] = []
        if sdoc is None:
            return
        segs = sorted(sdoc.segments, key=lambda s: s.span.start)
        self._by_id = {s.id: _v(s.segment_type) for s in segs}
        self._starts = [s.span.start for s in segs]
        self._types = [_v(s.segment_type) for s in segs]
        self._ends = [s.span.end for s in segs]

    def type_for(self, segment_id: str | None, offset: int) -> str:
        if segment_id and segment_id in self._by_id:
            return self._by_id[segment_id]
        if not self._starts:
            return ''
        i = bisect.bisect_right(self._starts, offset) - 1
        if i >= 0 and self._starts[i] <= offset < self._ends[i]:
            return self._types[i]
        return ''


# --- row building (pure: no DB) ----------------------------------------------

@dataclass
class _Built:
    mentions: list = field(default_factory=list)      # (key, source_id, kwargs)
    relations: list = field(default_factory=list)     # (dedupe_key, kwargs, refs)
    claims: list = field(default_factory=list)
    appraisals: list = field(default_factory=list)
    quote_refs: dict = field(default_factory=dict)    # source_id -> {field: key}
    deduped: int = 0
    dropped: int = 0
    page_ok: int = 0
    page_missing: int = 0


def _build(document, ndoc, ext: DocumentExtraction, segments: _Segments,
           resolver: _PageSpanResolver, page_hashes: dict,
           extractor_name: str, extractor_version: str) -> _Built:
    out = _Built()

    ordered = sorted(ext.mentions, key=lambda m: (m.provenance.span.start,
                                                  m.provenance.span.end, m.label))

    # De-duplicate identical (label, span) mentions. map_window locates each LLM
    # mention independently, so a surface form the model repeated without an
    # `occurrence` yields two records at the same offsets — accepted by
    # DocumentExtraction (it only checks id uniqueness) but rejected by
    # kb_mention_unique_per_version. Every id, winner or loser, is aliased onto
    # the survivor so assertion resolution stays total.
    by_key: dict[tuple, object] = {}
    alias: dict[str, str] = {}
    for m in ordered:
        winner = by_key.setdefault(_men_key(m), m)
        alias[m.id] = winner.id
    out.deduped = len(ordered) - len(by_key)
    survivors = list(by_key.values())
    by_id = {m.id: m for m in ordered}

    def survivor(mid):
        target = alias.get(mid)
        return by_id.get(target) if target else None

    occurrences: dict[tuple, int] = {}
    for m in survivors:
        prov = m.provenance
        span = prov.span
        page_number = _page_number(ndoc, prov, span.start)
        occ_key = (page_number, m.surface_form)
        occurrences[occ_key] = occurrences.get(occ_key, 0) + 1
        loc = resolver.locate(page_number, m.surface_form, occurrences[occ_key])
        if loc is None:
            out.page_missing += 1
        else:
            out.page_ok += 1

        kind, year, year_to, approx = _time_fields(getattr(m, 'parsed', None))
        subtype = getattr(m, 'subtype', None)
        if subtype is None:
            subtype = getattr(m, 'kind', None)
        canonical_ref = getattr(m, 'canonical_ref', None)

        out.mentions.append((_men_key(m), m.id, dict(
            document=document,
            source_id=m.id[:20],
            doc_char_start=span.start,
            doc_char_end=span.end,
            page_number=page_number,
            page_char_start=loc[0] if loc else None,
            page_char_end=loc[1] if loc else None,
            content_hash=page_hashes.get(page_number, ''),
            segment_source_id=(prov.segment_id or '')[:20],
            segment_type=segments.type_for(prov.segment_id, span.start),
            stream=_v(prov.stream) or 'main',
            extraction_method=_v(prov.extraction_method) or 'llm',
            ocr_source=bool(prov.ocr_source),
            extracted_at=prov.extracted_at,
            confidence=m.confidence,
            extractor_name=extractor_name,
            extractor_version=extractor_version,
            label=m.label,
            surface_form=m.surface_form,
            normalized_form=(m.normalized_form or '')[:255],
            blocking_key=(m.blocking_key or '')[:150],
            ref_key=_ref_key(canonical_ref),
            subtype=_v(subtype),
            quote_type=_v(getattr(m, 'quote_type', None)),
            match_method=_v(getattr(m, 'match_method', None)),
            match_score=getattr(m, 'match_score', None),
            time_kind=kind,
            hijri_year=year,
            hijri_year_to=year_to,
            hijri_approximate=approx,
            parsed_time=_dump(getattr(m, 'parsed', None)),
            canonical_ref=_dump(canonical_ref),
            name_components=_dump(getattr(m, 'name_components', None)),
            entity_key=(m.entity_id or '')[:64],
            linking_status=_v(m.linking_status) or 'unlinked',
        )))

        refs = {}
        for fname, attr in (('speaker_mention', 'speaker_mention_id'),
                            ('about_mention', 'about_mention_id')):
            target = survivor(getattr(m, attr, None) or '')
            if target is not None:
                refs[fname] = _men_key(target)
        if refs:
            out.quote_refs[m.id] = refs

    def common(rec, subject, extra_span=None):
        prov = rec.provenance
        span = prov.span
        page_number = _page_number(ndoc, prov, span.start)
        return dict(
            document=document,
            source_id=rec.id[:20],
            doc_char_start=span.start,
            doc_char_end=span.end,
            page_number=page_number,
            page_char_start=None,
            page_char_end=None,
            content_hash=page_hashes.get(page_number, ''),
            segment_source_id=(prov.segment_id or '')[:20],
            segment_type=segments.type_for(prov.segment_id, span.start),
            stream=_v(prov.stream) or 'main',
            extraction_method=_v(prov.extraction_method) or 'llm',
            ocr_source=bool(prov.ocr_source),
            extracted_at=prov.extracted_at,
            confidence=rec.confidence,
            extractor_name=extractor_name,
            extractor_version=extractor_version,
        )

    for r in ext.relations:
        subj = survivor(r.subject_mention_id)
        obj = survivor(r.object_mention_id)
        if subj is None or obj is None or subj.id == obj.id:
            # Either endpoint vanished, or de-duplication collapsed the two into
            # one — a self-loop the schema forbids. Drop rather than fabricate.
            out.dropped += 1
            continue
        place = survivor(r.place_mention_id or '')
        time = survivor(r.time_mention_id or '')
        span = r.provenance.span
        kwargs = common(r, subj)
        kwargs.update(
            relation_type=_v(r.relation_type),
            trigger=(r.trigger or '')[:120],
            evidence_text=ndoc.text[span.start:span.end][:_MAX_EVIDENCE],
            dedupe_key=_sha('rel', _v(r.relation_type), _key_str(subj), _key_str(obj),
                            _key_str(place) if place else '',
                            _key_str(time) if time else '', span.start, span.end),
        )
        refs = {'subject_mention': _men_key(subj), 'object_mention': _men_key(obj)}
        if place is not None:
            refs['place_mention'] = _men_key(place)
        if time is not None:
            refs['time_mention'] = _men_key(time)
        out.relations.append((kwargs['dedupe_key'], kwargs, refs))

    for c in ext.claims:
        subj = survivor(c.subject_mention_id)
        time = survivor(c.time_mention_id)
        if subj is None or time is None:
            out.dropped += 1
            continue
        span = c.provenance.span
        _kind, year, year_to, approx = _time_fields(getattr(time, 'parsed', None))
        kwargs = common(c, subj)
        kwargs.update(
            predicate=_v(c.predicate),
            hijri_year=year,
            hijri_year_to=year_to,
            hijri_approximate=approx,
            dedupe_key=_sha('clm', _v(c.predicate), _key_str(subj), _key_str(time),
                            span.start, span.end),
        )
        out.claims.append((kwargs['dedupe_key'], kwargs,
                           {'subject_mention': _men_key(subj),
                            'time_mention': _men_key(time)}))

    for a in ext.appraisals:
        critic = survivor(a.critic_mention_id)
        subj = survivor(a.subject_mention_id)
        if critic is None or subj is None or critic.id == subj.id:
            out.dropped += 1
            continue
        quote = survivor(a.quotation_mention_id or '')
        target = survivor(a.scope.target_mention_id or '')
        span = a.provenance.span
        scope_kind = _v(a.scope.kind) or 'general'
        kwargs = common(a, subj)
        kwargs.update(
            verbatim=a.verbatim,
            polarity=_v(a.polarity),
            rank=_v(a.rank),
            rank_level=APPRAISAL_RANK_LEVEL.get(a.rank) if a.rank else None,
            scope_kind=scope_kind,
            scope_note=(a.scope.note or '')[:255],
            dedupe_key=_sha('app', a.verbatim, _v(a.polarity), scope_kind,
                            _key_str(critic), _key_str(subj), span.start, span.end),
        )
        refs = {'critic_mention': _men_key(critic), 'subject_mention': _men_key(subj)}
        if quote is not None:
            refs['quotation_mention'] = _men_key(quote)
        # A `general` verdict must carry no target (DB check constraint).
        if target is not None and scope_kind != 'general':
            refs['scope_target_mention'] = _men_key(target)
        out.appraisals.append((kwargs['dedupe_key'], kwargs, refs))

    return out


# --- DB write ----------------------------------------------------------------

def _assertion_fk_fields():
    from ..models import KbMentionAppraisal, KbMentionClaim, KbMentionRelation
    return {
        KbMentionRelation: ('subject_mention', 'object_mention',
                            'place_mention', 'time_mention'),
        KbMentionClaim: ('subject_mention', 'time_mention'),
        KbMentionAppraisal: ('critic_mention', 'subject_mention',
                             'quotation_mention', 'scope_target_mention'),
    }


def _snapshot_verified_endpoints(document, name, version) -> dict:
    """Record where human-verified assertions point, keyed by mention span.

    Replacing machine mentions SET_NULLs those FKs; an appraisal that has lost
    its critic is uninterpretable, so the keys are re-resolved after insert.
    """
    snap = {}
    for model, fields in _assertion_fk_fields().items():
        cols = ['pk']
        for f in fields:
            cols += [f'{f}__label', f'{f}__doc_char_start', f'{f}__doc_char_end']
        per = {}
        for row in model.objects.filter(
                document=document, extractor_name=name,
                extractor_version=version, human_verified=True).values(*cols):
            keys = {f: (row[f'{f}__label'], row[f'{f}__doc_char_start'],
                        row[f'{f}__doc_char_end'])
                    for f in fields if row[f'{f}__label'] is not None}
            if keys:
                per[row['pk']] = keys
        if per:
            snap[model] = per
    return snap


def _reanchor(snapshot: dict, pk_by_key: dict) -> int:
    total = 0
    for model, per in snapshot.items():
        rows = model.objects.in_bulk(list(per))
        touched, objs = set(), []
        for pk, keys in per.items():
            obj = rows.get(pk)
            if obj is None:
                continue
            changed = False
            for fname, key in keys.items():
                new_pk = pk_by_key.get(key)
                if new_pk and getattr(obj, f'{fname}_id') != new_pk:
                    setattr(obj, f'{fname}_id', new_pk)
                    touched.add(fname)
                    changed = True
            if changed:
                objs.append(obj)
        if objs:
            model.objects.bulk_update(objs, sorted(touched), batch_size=500)
            total += len(objs)
    return total


def _pks(rows, model, document, name, version) -> dict:
    """``source_id -> pk`` after bulk_create.

    Django populates pks via RETURNING on Postgres and on SQLite >= 3.35, which
    is what ``ner_document_task`` already relies on. If a backend ever stops
    doing so, fall back to a read-back rather than writing NULL FKs.
    """
    if rows and rows[0].pk is None:
        logger.warning('bulk_create returned no pks on this backend — reading back')
        return dict(model.objects.filter(
            document=document, extractor_name=name, extractor_version=version
        ).values_list('source_id', 'id'))
    return {r.source_id: r.pk for r in rows}


def persist_document(document, *, ndoc: NormalizedDoc | None = None,
                     ext: DocumentExtraction | None = None, run=None,
                     force: bool = False, allow_partial: bool = False,
                     dry_run: bool = False) -> PersistResult:
    """Project ``document``'s KB output into the extraction_kb_* tables.

    ``ext`` is a test-only injection point; production always loads from disk.
    """
    from search_engine.utils import split_document_content_into_pages

    from ..models import (ExtractionRun, KbMention, KbMentionAppraisal,
                          KbMentionClaim, KbMentionRelation)
    from ..tasks import _page_hash, _replace_versioned_rows

    name = config.KB_EXTRACTOR_NAME
    version = config.KB_PIPELINE_VERSION
    book_id = config.book_id_for(document)
    ndoc = ndoc or normalize_document(document)
    norm_sha = split.norm_sha256(ndoc)

    saved = split.load_segments(book_id)
    if saved is None:
        return PersistResult(skipped=True, reason='no segments.json')
    if saved.get('norm_sha256') != norm_sha:
        # The document's content changed after extraction, so every absolute
        # offset now points at the wrong text. Refuse rather than poison rows.
        return PersistResult(skipped=True, reason='normalization drift')

    meta = io_utils.read_json_or_none(
        config.output_dir(book_id) / 'extraction_meta.json') or {}
    disk_format = int(meta.get('disk_format', 1))
    if not meta.get('complete', False) and not allow_partial:
        # A partial file covers only the first N windows; projecting it after
        # the delete would blank most of the book with no signal.
        return PersistResult(skipped=True, reason='incomplete extraction',
                             disk_format=disk_format)

    key = persist_key(norm_sha, disk_format)
    if run is None:
        run = ExtractionRun.objects.filter(
            document=document, extractor_name=name,
            extractor_version=version).first()
    if run is not None and run.persisted_hash == key and not force:
        return PersistResult(skipped=True, reason='up to date',
                             disk_format=disk_format)

    ext = ext or mapping.load_extraction(book_id)
    if ext is None:
        return PersistResult(skipped=True, reason='no extraction.json',
                             disk_format=disk_format)

    pages = split_document_content_into_pages(document.content or '')
    page_hashes = {p['page_number']: _page_hash(p['content']) for p in pages}
    segments = _Segments(SegmentedDocument.model_validate(saved['doc'])
                         if saved.get('doc') else None)
    built = _build(document, ndoc, ext, segments, _PageSpanResolver(pages),
                   page_hashes, name, version)

    result = PersistResult(
        disk_format=disk_format,
        mentions=len(built.mentions), relations=len(built.relations),
        claims=len(built.claims), appraisals=len(built.appraisals),
        mentions_deduped=built.deduped, assertions_dropped=built.dropped,
        page_spans_resolved=built.page_ok, page_spans_missing=built.page_missing)
    if dry_run:
        return result

    with transaction.atomic():
        snapshot = _snapshot_verified_endpoints(document, name, version)

        # Human-verified rows survive _replace_versioned_rows, so re-creating
        # them would trip the unique constraints. Reuse them instead, exactly as
        # ner_document_task does.
        verified_mentions = {
            (r.label, r.doc_char_start, r.doc_char_end): r
            for r in KbMention.objects.filter(
                document=document, extractor_name=name,
                extractor_version=version, human_verified=True)}
        verified_keys = {
            model: set(model.objects.filter(
                document=document, extractor_name=name, extractor_version=version,
                human_verified=True).values_list('dedupe_key', flat=True))
            for model in (KbMentionRelation, KbMentionClaim, KbMentionAppraisal)}

        # Assertions first: the mention delete then only has to SET_NULL the
        # handful of verified rows instead of everything.
        for model in (KbMentionAppraisal, KbMentionClaim, KbMentionRelation,
                      KbMention):
            _replace_versioned_rows(model, document, name, version, page_hashes,
                                    has_span=True)

        rows, pk_by_key = [], {}
        for mkey, source_id, kwargs in built.mentions:
            existing = verified_mentions.get(mkey)
            if existing is not None:
                pk_by_key[mkey] = existing.pk
                result.verified_reused += 1
                continue
            rows.append(KbMention(**kwargs))
        KbMention.objects.bulk_create(rows, batch_size=1000)
        _pks(rows, KbMention, document, name, version)
        for row in rows:
            pk_by_key[(row.label, row.doc_char_start, row.doc_char_end)] = row.pk
        result.mentions = len(rows) + result.verified_reused

        # Quotation attribution can point forward, so it needs a second pass.
        pk_by_source = {row.source_id: row for row in rows}
        updates = []
        for source_id, refs in built.quote_refs.items():
            row = pk_by_source.get(source_id[:20])
            if row is None:
                continue
            changed = False
            for fname, mkey in refs.items():
                target = pk_by_key.get(mkey)
                if target and target != row.pk:
                    setattr(row, f'{fname}_id', target)
                    changed = True
            if changed:
                updates.append(row)
        if updates:
            KbMention.objects.bulk_update(
                updates, ['speaker_mention', 'about_mention'], batch_size=1000)

        for model, spec, counter in (
                (KbMentionRelation, built.relations, 'relations'),
                (KbMentionClaim, built.claims, 'claims'),
                (KbMentionAppraisal, built.appraisals, 'appraisals')):
            objs = []
            for dedupe_key, kwargs, refs in spec:
                if dedupe_key in verified_keys[model]:
                    result.verified_reused += 1
                    continue
                obj = model(**kwargs)
                for fname, mkey in refs.items():
                    setattr(obj, f'{fname}_id', pk_by_key.get(mkey))
                objs.append(obj)
            model.objects.bulk_create(objs, batch_size=1000)
            setattr(result, counter, len(objs))

        result.verified_reanchored = _reanchor(snapshot, pk_by_key)

        if run is None:
            run, _ = ExtractionRun.objects.get_or_create(
                document=document, extractor_name=name, extractor_version=version)
        ExtractionRun.objects.filter(pk=run.pk).update(
            persisted_hash=key, persisted_at=timezone.now())
    return result
