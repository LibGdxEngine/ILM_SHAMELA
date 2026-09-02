"""Stage 2 — map LLM output into heritage schema objects.

Input is ``LLMWindowExtraction``: pass A's mentions joined to pass B's links.
Python does the lifting the model is never trusted with:

1. each mention's verbatim ``text`` is located in the focus text (exact
   nth-occurrence search -> folded-shadow search) -> absolute ``TextSpan``,
2. ``Provenance`` is built programmatically (book, page from the page map,
   span, segment, extraction_method=llm) — then trimmed on write by
   ``prune_extraction()``, since most of it is constant per book;
   ``load_extraction()`` restores it,
3. relations / claims / appraisals are pre-checked against the same constraints
   ``DocumentExtraction`` enforces (RELATION_CONSTRAINTS domain/range, label
   checks, distinct parties) — invalid qualifiers are nulled, invalid cores are
   dropped,
4. everything dropped or degraded lands in ``drops.jsonl`` — the human-review
   queue.

No confidence is read from the model — every heritage record defaults it to
1.0, which is what the self-reported value practically always was.
"""
import bisect
import copy
import json
import logging
import re

from pydantic import ValidationError

from . import config, io_utils, textmatch
from .config import KB_PIPELINE_VERSION
from .extract import LLMMention, LLMWindowExtraction  # noqa: F401 (typing/docs)
from .normalize import NormalizedDoc, meta_title, page_for_offset
from .schema import (APPRAISAL_RANK_LEVEL, MENTION_LABEL_TO_ENTITY_TYPE,
                     RELATION_CONSTRAINTS, TADIL_MAX_LEVEL, AbsoluteTime,
                     AppraisalPolarity, AppraisalRank, AppraisalScope,
                     AppraisalScopeKind, ClaimPredicate, DocumentExtraction,
                     DynastyMention, EventMention, ExtractionMethod, HijriDate,
                     HijriRange, MentionAppraisal, MentionClaim, MentionRelation,
                     NameComponents, OfficeMention, OrganizationMention,
                     OrganizationSubtype, PersonMention, PlaceMention, Provenance,
                     QuotationMention, QuotationType, QuranRef, RelationType,
                     RelativeTime, ReligionMention, SectKind, SectMention,
                     SegmentedDocument, TextSpan, TextStream, TimeMention,
                     TimeRange, TribeMention, WorkMention, WorkSubtype)

logger = logging.getLogger(__name__)

_MENTION_CLS = {"place": PlaceMention, "work": WorkMention, "tribe": TribeMention,
                "sect": SectMention, "religion": ReligionMention,
                "dynasty": DynastyMention, "office": OfficeMention,
                "event": EventMention}


def make_provenance(ndoc: NormalizedDoc, book_id: str, span: TextSpan | None,
                    segment_id: str | None) -> Provenance:
    vol, page = page_for_offset(ndoc, span.start) if span is not None else (None, None)
    return Provenance(
        book_id=book_id, book_title=meta_title(ndoc.meta),
        volume=vol, page=page, span=span, segment_id=segment_id,
        stream=TextStream.MAIN, extraction_method=ExtractionMethod.LLM,
        extractor_version=KB_PIPELINE_VERSION, ocr_source=ndoc.ocr_source)


def build_parsed_time(lm):
    try:
        if lm.hijri_year and lm.hijri_year_to:
            return TimeRange(range=HijriRange(
                earliest=HijriDate(year=lm.hijri_year, approximate=lm.approximate),
                latest=HijriDate(year=lm.hijri_year_to, approximate=lm.approximate)))
        if lm.hijri_year:
            return AbsoluteTime(date=HijriDate(year=lm.hijri_year,
                                               approximate=lm.approximate))
        if lm.relative_anchor:
            return RelativeTime(anchor_text=lm.relative_anchor)
    except ValidationError:
        return None
    return None


def _enclosing_span(a, b) -> TextSpan:
    return TextSpan(start=min(a.provenance.span.start, b.provenance.span.start),
                    end=max(a.provenance.span.end, b.provenance.span.end))


def map_window(book_id: str, ndoc: NormalizedDoc, seg_by_id: dict, w, llm_out):
    """-> (mentions, relations, claims, appraisals, drops) for one window."""
    drops: list[dict] = []
    w_id = [w.focus_span.start, w.focus_span.end]
    focus = ndoc.text[w.focus_span.start : w.focus_span.end]
    fshadow, fmap = textmatch.shadow_with_map(focus)

    built: list[tuple[object, object]] = []
    id_map: dict[str, object] = {}
    for lm in llm_out.mentions:
        loc = textmatch.locate_in_focus(focus, fshadow, fmap, lm.text, lm.occurrence)
        if loc is None:
            drops.append({"kind": "mention", "reason": "mention_not_found",
                          "window": w_id, "label": lm.label, "text": lm.text[:80]})
            continue
        span = TextSpan(start=w.focus_span.start + loc[0],
                        end=w.focus_span.start + loc[1])
        seg_id = next((sid for sid in w.segment_ids
                       if (sg := seg_by_id.get(sid)) is not None
                       and sg.span.start <= span.start < sg.span.end), None)
        common = dict(
            surface_form=ndoc.text[span.start:span.end],
            normalized_form=lm.normalized or None,
            provenance=make_provenance(ndoc, book_id, span, seg_id))
        try:
            if lm.label == "person":
                nc = None
                c = lm.name_components
                if c is not None and any([c.kunya, c.ism, c.nasab, c.nisba,
                                          c.laqab, c.shuhra]):
                    nc = NameComponents(kunya=c.kunya, ism=c.ism, nasab=c.nasab,
                                        nisba=c.nisba, laqab=c.laqab, shuhra=c.shuhra)
                men = PersonMention(**common, name_components=nc)
            elif lm.label == "time":
                men = TimeMention(**common, parsed=build_parsed_time(lm))
            elif lm.label == "quotation":
                ref = None
                if lm.quote_type == "quran" and lm.sura and lm.aya_start:
                    try:
                        ref = QuranRef(sura=lm.sura, aya_start=lm.aya_start,
                                       aya_end=lm.aya_end)
                    except ValidationError:
                        drops.append({"kind": "mention", "reason": "bad_quran_ref_nulled",
                                      "window": w_id, "text": lm.text[:80]})
                men = QuotationMention(
                    **common, canonical_ref=ref,
                    quote_type=QuotationType(lm.quote_type or "reported_speech"))
            elif lm.label == "work":
                st = WorkSubtype.UNKNOWN
                if lm.work_subtype:
                    try:
                        st = WorkSubtype(lm.work_subtype)
                    except ValueError:
                        drops.append({"kind": "mention",
                                      "reason": "bad_work_subtype_nulled",
                                      "window": w_id, "text": lm.text[:80]})
                men = WorkMention(**common, subtype=st)
            elif lm.label == "sect":
                kt = SectKind.UNKNOWN
                if lm.sect_kind:
                    try:
                        kt = SectKind(lm.sect_kind)
                    except ValueError:
                        drops.append({"kind": "mention",
                                      "reason": "bad_sect_kind_nulled",
                                      "window": w_id, "text": lm.text[:80]})
                men = SectMention(**common, kind=kt)
            elif lm.label == "organization":
                ot = OrganizationSubtype.UNKNOWN
                if lm.org_subtype:
                    try:
                        ot = OrganizationSubtype(lm.org_subtype)
                    except ValueError:
                        drops.append({"kind": "mention",
                                      "reason": "bad_org_subtype_nulled",
                                      "window": w_id, "text": lm.text[:80]})
                men = OrganizationMention(**common, subtype=ot)
            else:
                men = _MENTION_CLS[lm.label](**common)
        except (ValidationError, KeyError, ValueError) as e:
            drops.append({"kind": "mention", "reason": f"construct_failed: {str(e)[:120]}",
                          "window": w_id, "label": lm.label, "text": lm.text[:80]})
            continue
        built.append((lm, men))
        if lm.local_id:
            id_map[lm.local_id] = men

    # wire quotation speaker/about from pass B, to surviving mentions only
    for qa in llm_out.quote_attributions:
        quote = id_map.get(qa.quote_local_id)
        if quote is None or quote.label != "quotation":
            drops.append({"kind": "quote_attribution",
                          "reason": "missing_or_non_quotation_target",
                          "window": w_id, "quote": qa.quote_local_id})
            continue
        sp = id_map.get(qa.speaker_local_id) if qa.speaker_local_id else None
        if sp is not None and sp.label == "person":
            quote.speaker_mention_id = sp.id
        ab = id_map.get(qa.about_local_id) if qa.about_local_id else None
        if ab is not None:
            quote.about_mention_id = ab.id

    relations: list[MentionRelation] = []
    for lr in llm_out.relations:
        subj = id_map.get(lr.subject_local_id)
        obj = id_map.get(lr.object_local_id)
        if subj is None or obj is None or subj.id == obj.id:
            drops.append({"kind": "relation", "reason": "missing_or_identical_endpoints",
                          "window": w_id, "relation_type": lr.relation_type})
            continue
        rt = RelationType(lr.relation_type)
        domain, range_ = RELATION_CONSTRAINTS[rt]
        if (MENTION_LABEL_TO_ENTITY_TYPE.get(subj.label) not in domain
                or MENTION_LABEL_TO_ENTITY_TYPE.get(obj.label) not in range_):
            drops.append({"kind": "relation",
                          "reason": f"domain_range: {subj.label}->{obj.label}",
                          "window": w_id, "relation_type": lr.relation_type})
            continue
        place = id_map.get(lr.place_local_id) if lr.place_local_id else None
        if place is not None and place.label != "place":
            drops.append({"kind": "relation", "reason": "place_qualifier_nulled",
                          "window": w_id, "relation_type": lr.relation_type})
            place = None
        tm = id_map.get(lr.time_local_id) if lr.time_local_id else None
        if tm is not None and tm.label != "time":
            drops.append({"kind": "relation", "reason": "time_qualifier_nulled",
                          "window": w_id, "relation_type": lr.relation_type})
            tm = None
        relations.append(MentionRelation(
            relation_type=rt, subject_mention_id=subj.id, object_mention_id=obj.id,
            place_mention_id=place.id if place else None,
            time_mention_id=tm.id if tm else None,
            provenance=make_provenance(ndoc, book_id, _enclosing_span(subj, obj),
                                       subj.provenance.segment_id),
            trigger=lr.trigger or None))

    claims: list[MentionClaim] = []
    for lc in llm_out.claims:
        subj = id_map.get(lc.subject_local_id)
        tm = id_map.get(lc.time_local_id)
        if subj is None or tm is None or tm.label != "time":
            drops.append({"kind": "claim", "reason": "missing_subject_or_time",
                          "window": w_id, "predicate": lc.predicate})
            continue
        claims.append(MentionClaim(
            predicate=ClaimPredicate(lc.predicate),
            subject_mention_id=subj.id, time_mention_id=tm.id,
            provenance=make_provenance(ndoc, book_id, _enclosing_span(subj, tm),
                                       subj.provenance.segment_id)))

    appraisals: list[MentionAppraisal] = []
    for la in llm_out.appraisals:
        cr = id_map.get(la.critic_local_id)
        sb = id_map.get(la.subject_local_id)
        if (cr is None or sb is None or cr.id == sb.id
                or cr.label != "person" or sb.label != "person"
                or not la.verbatim.strip()):
            drops.append({"kind": "appraisal",
                          "reason": "bad_parties_or_empty_verbatim",
                          "window": w_id, "verbatim": la.verbatim[:60]})
            continue
        polarity = AppraisalPolarity(la.polarity)
        rank = None
        if la.rank:
            r = AppraisalRank(la.rank)
            lvl = APPRAISAL_RANK_LEVEL[r]
            if ((polarity is AppraisalPolarity.TADIL and lvl > TADIL_MAX_LEVEL)
                    or (polarity is AppraisalPolarity.JARH and lvl <= TADIL_MAX_LEVEL)):
                drops.append({"kind": "appraisal",
                              "reason": "rank_polarity_mismatch_rank_nulled",
                              "window": w_id, "verbatim": la.verbatim[:60]})
            else:
                rank = r
        scope_kind = AppraisalScopeKind(la.scope_kind)
        tgt = (id_map.get(la.scope_target_local_id)
               if la.scope_target_local_id and scope_kind is not AppraisalScopeKind.GENERAL
               else None)
        try:
            appraisals.append(MentionAppraisal(
                critic_mention_id=cr.id, subject_mention_id=sb.id,
                verbatim=la.verbatim, polarity=polarity, rank=rank,
                scope=AppraisalScope(kind=scope_kind,
                                     target_mention_id=tgt.id if tgt else None),
                provenance=make_provenance(ndoc, book_id, _enclosing_span(cr, sb),
                                           sb.provenance.segment_id)))
        except ValidationError as e:
            drops.append({"kind": "appraisal", "reason": f"construct_failed: {str(e)[:120]}",
                          "window": w_id})

    return [m for _, m in built], relations, claims, appraisals, drops


_ID_RE = re.compile(r"\b(?:men|mrel|mclm|mapp)_[0-9a-f]{12}\b")


def assemble_extraction(book_id, mentions, relations, claims, appraisals, drops):
    """DocumentExtraction with a bounded drop-and-retry loop: the pre-checks in
    map_window mirror its validators, so this almost never fires — but one bad
    item must not lose a whole book."""
    for _ in range(50):
        try:
            return DocumentExtraction(book_id=book_id, mentions=mentions,
                                      relations=relations, claims=claims,
                                      appraisals=appraisals)
        except ValidationError as e:
            bad = set(_ID_RE.findall(str(e)))
            if not bad:
                break
            before = (len(mentions), len(relations), len(claims), len(appraisals))
            for m in mentions:                      # null orphaned references
                if getattr(m, "speaker_mention_id", None) in bad:
                    m.speaker_mention_id = None
                if getattr(m, "about_mention_id", None) in bad:
                    m.about_mention_id = None
            for r in relations:
                if r.place_mention_id in bad:
                    r.place_mention_id = None
                if r.time_mention_id in bad:
                    r.time_mention_id = None
            for a in appraisals:
                if a.scope.target_mention_id in bad:
                    a.scope.target_mention_id = None
            mentions = [m for m in mentions if m.id not in bad]
            relations = [r for r in relations if r.id not in bad
                         and r.subject_mention_id not in bad
                         and r.object_mention_id not in bad]
            claims = [c for c in claims if c.id not in bad
                      and c.subject_mention_id not in bad
                      and c.time_mention_id not in bad]
            appraisals = [a for a in appraisals if a.id not in bad
                          and a.critic_mention_id not in bad
                          and a.subject_mention_id not in bad]
            drops.append({"kind": "assembly", "reason": str(e)[:200],
                          "removed_ids": sorted(bad)})
            if (len(mentions), len(relations), len(claims), len(appraisals)) == before:
                break
    # last resort: strip assertion layers one by one
    for layer in ("appraisals", "claims", "relations"):
        try:
            return DocumentExtraction(book_id=book_id, mentions=mentions,
                                      relations=relations, claims=claims,
                                      appraisals=appraisals)
        except ValidationError as e:
            drops.append({"kind": "assembly",
                          "reason": f"dropped all {layer}: {str(e)[:150]}"})
            if layer == "appraisals":
                appraisals = []
            elif layer == "claims":
                claims = []
            else:
                relations = []
    return DocumentExtraction(book_id=book_id, mentions=mentions)


# --- extraction.json serialization: prune redundant fields -------------------
# Provenance constants and unset entity-resolution placeholders repeat on every
# record — a large share of the file carrying no information. They are dropped
# on write and restored on read: each is a constant, a schema default, or
# recomputable from what is kept. `ocr_source` is the one exception to "schema
# default": it is per-document, so it is restored from extraction_meta.json.
#
# Nothing that carries information is pruned. `normalized_form`, `trigger` and
# the full name analysis were dropped here until disk_format 2 — all three are
# real model output (LLMMention.normalized, LLMRelation.trigger,
# LLMNameComponents), so dropping them was lossy in a way the rest of this list
# is not, and it left the DB projection's grouping key permanently empty.
PRUNED_PROV_FIELDS = ("book_id", "extraction_method", "extractor_version",
                      "stream", "ocr_source", "segment_id")
PRUNED_RECORD_FIELDS = ("blocking_key", "entity_id", "linking_status")
PRUNED_TOP_FIELDS = ("schema_version",)

# 1 = normalized_form/trigger stripped, name_components collapsed to
#     {name, kunya, shuhra}.  2 = every model-produced field kept.
# Stamped into extraction_meta.json so the DB projection can report which books
# still need a (free, cache-replayed) --force-stage2 sweep. Readers accept both.
DISK_FORMAT = 2
_ASSERTION_LAYERS = ("mentions", "relations", "claims", "appraisals")


def prune_extraction(ext: DocumentExtraction) -> dict:
    """The extraction.json payload. In-memory objects keep every field — this
    trims only what reaches disk. Inverse: rehydrate_extraction()."""
    d = ext.model_dump(mode="json")
    for f in PRUNED_TOP_FIELDS:
        d.pop(f, None)
    for layer in _ASSERTION_LAYERS:
        for rec in d.get(layer, []):
            for f in PRUNED_RECORD_FIELDS:   # no-op on layers lacking the field
                rec.pop(f, None)
            prov = rec.get("provenance")
            if prov is not None:
                for f in PRUNED_PROV_FIELDS:
                    prov.pop(f, None)
    return d


def rehydrate_extraction(raw: dict, seg_doc: SegmentedDocument | None,
                         ocr_source: bool = False) -> DocumentExtraction:
    """Restore a pruned payload to a full DocumentExtraction.

    book_id comes from the top level, extraction_method is ``llm`` by
    construction, ``ocr_source`` from extraction_meta.json (per-document), and
    segment_id is re-derived from the span against segments.json exactly as
    map_window() first derived it. The rest fall back to their schema defaults
    — which is the value they always carried. Assumes segments are flat
    disjoint siblings, as Stage 1 emits them.

    Lossless for disk_format 2. A disk_format 1 file is still read, but its
    ``normalized_form``/``trigger`` come back as None and its name analysis is
    limited to kunya/shuhra. Restoring them needs a Stage 2 re-run, which is
    free only while the response cache still hits — its key is
    sha256(model, prompt), so a changed model or prompt re-bills every window
    and can return a different extraction. Check with ``--dry-run`` first."""
    d = copy.deepcopy(raw)
    segs = sorted(seg_doc.segments, key=lambda s: s.span.start) if seg_doc else []
    starts = [s.span.start for s in segs]

    def segment_at(start: int) -> str | None:
        i = bisect.bisect_right(starts, start) - 1
        if i >= 0 and segs[i].span.start <= start < segs[i].span.end:
            return segs[i].id
        return None

    for layer in _ASSERTION_LAYERS:
        for rec in d.get(layer, []):
            nc = rec.get("name_components")
            if nc is not None:
                # disk_format 1 wrote a `name` key, which NameComponents has no
                # field for and (extra="forbid") would reject. Drop it and keep
                # whatever else the file carries.
                nc = {k: v for k, v in nc.items() if k != "name"}
                rec["name_components"] = nc or None
            prov = rec.get("provenance")
            if prov is None:
                continue
            prov["book_id"] = d["book_id"]
            prov["extraction_method"] = "llm"
            prov["ocr_source"] = ocr_source
            span = prov.get("span")
            if segs and span is not None:
                prov["segment_id"] = segment_at(span["start"])
    return DocumentExtraction.model_validate(d)


def load_extraction(book_id: str) -> DocumentExtraction | None:
    """Read output/{book_id}/extraction.json back as a full object."""
    from .split import load_segments

    raw = io_utils.read_json_or_none(config.output_dir(book_id) / "extraction.json")
    if raw is None:
        return None
    meta = io_utils.read_json_or_none(
        config.output_dir(book_id) / "extraction_meta.json") or {}
    saved = load_segments(book_id)
    return rehydrate_extraction(
        raw, SegmentedDocument.model_validate(saved["doc"]) if saved else None,
        ocr_source=bool(meta.get("ocr_source", False)))
