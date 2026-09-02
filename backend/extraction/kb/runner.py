"""Orchestration for the KB pipeline: per-document stage runners, resume
status, cost estimates, and QC reports. The Celery task and the
``run_kb_pipeline`` management command both call in here.

Resumability contract (inherited from the notebook): every LLM response is
cached on disk BEFORE parsing, state files are written atomically, and
``extraction_meta.json`` records whether the run covered every planned window
— partial or failed runs are completed, not skipped, on the next call.
"""
import json
import logging
import random
from collections import Counter

from . import config, extract, io_utils, mapping, split
from .config import (CHARS_PER_TOKEN, DEEPSEEK_PRICE_IN, DEEPSEEK_PRICE_OUT,
                     GEMINI_PRICE_IN, GEMINI_PRICE_OUT, KB_PIPELINE_VERSION,
                     NORMALIZER_VERSION, OVERSIZED_FOCUS_CAP,
                     PROMPT_OVERHEAD_TOKENS, STAGE2_PROMPT_VERSION,
                     WINDOW_MAX_CHARS, WINDOW_OVERLAP)
from .normalize import NormalizedDoc, normalize_document  # noqa: F401 (re-export)
from .schema import SegmentDetector, SegmentedDocument, plan_windows

logger = logging.getLogger(__name__)

try:
    from celery.exceptions import SoftTimeLimitExceeded
except ImportError:  # pragma: no cover — celery is a hard dep in this project
    class SoftTimeLimitExceeded(BaseException):
        pass

# Stage 2 dry-run ratios, measured from pilot runs (upper bounds).
MENTION_LIST_RATIO = 0.35   # chars of «m7  person  «...»» listing per focus char
OUT_RATIO_A, OUT_RATIO_B = 0.30, 0.15   # output volume as a share of focus chars


def segments_drifted(saved: dict, ndoc: NormalizedDoc) -> bool:
    """True when segments.json was built from different normalized text (the
    document was re-OCRed or the normalizer changed) — Stage 1 must rerun."""
    return (saved.get("norm_sha256") != split.norm_sha256(ndoc)
            or saved.get("normalizer_version") != NORMALIZER_VERSION)


def plan_book_windows(sdoc: SegmentedDocument, ndoc: NormalizedDoc):
    return plan_windows(sdoc, max_chars=WINDOW_MAX_CHARS, overlap=WINDOW_OVERLAP,
                        text=ndoc.text)


# ---------------------------------------------------------------------------
# Stage 1
# ---------------------------------------------------------------------------

def run_stage1(book_id: str, ndoc: NormalizedDoc, force: bool = False,
               document_id: int | None = None) -> SegmentedDocument:
    """Split one book; skips when a non-drifted segments.json already exists."""
    saved = split.load_segments(book_id)
    if saved is not None and not force and not segments_drifted(saved, ndoc):
        logger.info("%s: segments.json exists — skipping stage 1", book_id)
        return SegmentedDocument.model_validate(saved["doc"])
    if saved is not None and segments_drifted(saved, ndoc):
        logger.warning("%s: NORMALIZATION DRIFT — segments.json was built from "
                       "different text; redoing stage 1 (cached calls for "
                       "unchanged chunks replay free)", book_id)
    markers = split.collect_markers(book_id, ndoc)
    pts, stats = split.resolve_markers(ndoc, markers)
    merged = split.merge_points(pts, split.seeds_to_points(ndoc))
    sdoc = split.build_segments(book_id, ndoc, merged)
    split.save_segments(book_id, ndoc, sdoc, stats, document_id=document_id)
    logger.info("%s: %d LLM markers -> %d resolved (+%d markup seeds) -> "
                "%d segments", book_id, len(markers), stats["resolved"],
                len(ndoc.seeds), len(sdoc.segments))
    return sdoc


def estimate_stage1(ndoc: NormalizedDoc) -> dict:
    """Stage 1 cost estimate — zero API calls."""
    chunks = split.chunk_for_split(ndoc.text)
    tin = (sum(len(c) for c in chunks) / CHARS_PER_TOKEN
           + PROMPT_OVERHEAD_TOKENS * len(chunks))
    est_units = max(20, len(ndoc.text) // 2500)     # ~1 unit per 2.5k chars
    tout = est_units * 40
    cost = tin * DEEPSEEK_PRICE_IN + tout * DEEPSEEK_PRICE_OUT
    return {"chars": len(ndoc.text), "chunks": len(chunks),
            "tokens_in": round(tin), "tokens_out": round(tout),
            "cost_usd": round(cost, 4), "model": config.split_model()}


def stage1_qc(book_id: str, ndoc: NormalizedDoc) -> str:
    """Human-readable Stage 1 QC report."""
    saved = split.load_segments(book_id)
    if saved is None:
        return f"{book_id}: no segments.json yet"
    sdoc = SegmentedDocument.model_validate(saved["doc"])
    leaves = sdoc.leaves()
    lens = sorted(s.length for s in leaves)
    cov = sum(s.length for s in sdoc.segments) / max(1, sdoc.text_length)
    lines = [f"== {book_id}",
             f"   types    : {dict(Counter(s.segment_type.value for s in sdoc.segments))}",
             f"   detectors: {dict(Counter(s.detector.value for s in sdoc.segments))}"]
    if lens:
        lines.append(
            f"   main leaves: {len(lens)}  length p10/p50/p90: "
            f"{lens[len(lens) // 10]} / {lens[len(lens) // 2]} / "
            f"{lens[(len(lens) * 9) // 10]}  coverage(all streams): {cov:.1%}")
    rs = saved.get("resolve_stats", {})
    lines.append(f"   markers  : {rs.get('total', 0)} from LLM, "
                 f"{rs.get('resolved', 0)} resolved, "
                 f"{len(rs.get('unresolved', []))} unresolved")
    for u in rs.get("unresolved", [])[:5]:
        lines.append(f"     unresolved e.g.: {u!r}")
    if any(s.detector is SegmentDetector.FALLBACK_WINDOW for s in sdoc.segments):
        lines.append("   WARNING: fallback windows in use — split detection failed here")
    if cov < 0.95:
        lines.append("   WARNING: segment coverage < 95% of the text")
    for s in random.sample(leaves, min(3, len(leaves))):
        lines.append(f"     [{s.segment_type.value:>10s}] "
                     f"{ndoc.text[s.span.start:s.span.start + 70]!r}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Stage 2
# ---------------------------------------------------------------------------

def estimate_stage2(book_id: str, ndoc: NormalizedDoc,
                    windows_limit: int | None = None) -> dict | None:
    """Stage 2 cost estimate from segments.json — zero API calls; upper bound
    (windows where pass A finds <2 mentions skip pass B, unknowable here).
    None when stage 1 hasn't run."""
    saved = split.load_segments(book_id)
    if saved is None:
        return None
    sdoc = SegmentedDocument.model_validate(saved["doc"])
    windows = plan_book_windows(sdoc, ndoc)
    if windows_limit is not None:
        windows = windows[:windows_limit]
    a_overhead = (len(extract.MENTIONS_INSTRUCTIONS)
                  + len(json.dumps(extract.MENTIONS_SCHEMA_JSON,
                                   ensure_ascii=False))) / CHARS_PER_TOKEN
    b_overhead = (len(extract.LINKS_INSTRUCTIONS)
                  + len(json.dumps(extract.LINKS_SCHEMA_JSON,
                                   ensure_ascii=False))) / CHARS_PER_TOKEN
    n = len(windows)
    ctx = sum(w.context_span.end - w.context_span.start for w in windows)
    foc = sum(min(w.focus_span.end - w.focus_span.start, OVERSIZED_FOCUS_CAP)
              for w in windows)
    tin_a = ctx / CHARS_PER_TOKEN + n * a_overhead
    tin_b = foc * (1 + MENTION_LIST_RATIO) / CHARS_PER_TOKEN + n * b_overhead
    tout = (OUT_RATIO_A + OUT_RATIO_B) * foc / CHARS_PER_TOKEN
    cost = (tin_a + tin_b) * GEMINI_PRICE_IN + tout * GEMINI_PRICE_OUT
    return {"windows": n, "oversized": sum(1 for w in windows if w.oversized),
            "calls": 2 * n, "tokens_in": round(tin_a + tin_b),
            "tokens_out": round(tout), "cost_usd": round(cost, 2),
            "model": config.extract_model()}


def run_stage2(book_id: str, ndoc: NormalizedDoc,
               windows_limit: int | None = None, force: bool = False,
               document_id: int | None = None) -> dict:
    """Extract one book. Interrupt-safe: every response is cached before
    parsing and the two passes cache separately, so stopping mid-book loses
    nothing — call again and finished calls replay from cache at zero cost.

    extraction.json only counts as final when extraction_meta.json says the run
    covered every planned window with no failed windows; partial runs
    (windows_limit, interrupts) are completed — not skipped — next time."""
    outdir = config.output_dir(book_id)
    meta_p = outdir / "extraction_meta.json"
    if (outdir / "extraction.json").exists() and not force:
        meta = io_utils.read_json_or_none(meta_p)
        if (meta is not None and meta.get("complete", True)
                and meta.get("norm_sha256") == split.norm_sha256(ndoc)
                and meta.get("prompt_version") == STAGE2_PROMPT_VERSION
                and meta.get("pipeline_version") == KB_PIPELINE_VERSION):
            logger.info("%s: extraction.json complete — skipping stage 2", book_id)
            return {"skipped": True, "complete": True}
        if meta is not None and not meta.get("complete", True):
            logger.info("%s: partial extraction on disk (%s/%s windows) — "
                        "completing it (finished windows replay from cache)",
                        book_id, meta.get("windows_done", "?"),
                        meta.get("windows_total", "?"))

    saved = split.load_segments(book_id)
    if saved is None:
        raise RuntimeError(f"{book_id}: no segments.json — run stage 1 first")
    if segments_drifted(saved, ndoc):
        raise RuntimeError(
            f"{book_id}: NORMALIZATION DRIFT — segments.json was built from "
            f"different text; rerun stage 1 first")
    sdoc = SegmentedDocument.model_validate(saved["doc"])
    seg_by_id = {s.id: s for s in sdoc.segments}
    windows = plan_book_windows(sdoc, ndoc)
    windows_total = len(windows)
    if windows_limit is not None:
        windows = windows[:windows_limit]
        logger.info("%s: windows_limit=%d — PARTIAL extraction (%d/%d windows)",
                    book_id, windows_limit, len(windows), windows_total)

    m, r, c, a, drops = [], [], [], [], []
    n_proposed = 0
    wi = -1
    try:
        for wi, w in enumerate(windows):
            if wi and wi % 10 == 0:
                logger.info("%s: window %d/%d (%d mentions so far)",
                            book_id, wi, len(windows), len(m))
            try:
                mp, focus, cut = extract.build_mentions_prompt(ndoc.text, w)
                if cut:
                    # Not a failure: the window still extracts, from less text.
                    # kind != "window", so it does not mark the book incomplete.
                    drops.append({"kind": "focus", "reason": "focus_truncated",
                                  "window_index": wi,
                                  "window": [w.focus_span.start, w.focus_span.end],
                                  "chars_dropped": cut})
                out = extract.call_extract_llm(book_id, wi, mp, focus)
                n_proposed += len(out.mentions)
                wm, wr, wc, wa, wd = mapping.map_window(
                    book_id, ndoc, seg_by_id, w, out)
                m += wm; r += wr; c += wc; a += wa; drops += wd
            except (KeyboardInterrupt, SoftTimeLimitExceeded):
                raise
            except Exception as e:
                if split._is_config_error(e):
                    raise  # every window fails the same way — fail the book loudly
                drops.append({"kind": "window", "window_index": wi,
                              "reason": f"{type(e).__name__}: {str(e)[:200]}"})
    except (KeyboardInterrupt, SoftTimeLimitExceeded):
        logger.warning("%s: interrupted at window %d/%d — nothing lost: answered "
                       "calls are cached; run again to resume.",
                       book_id, wi + 1, len(windows))
        raise

    ext = mapping.assemble_extraction(book_id, m, r, c, a, drops)
    # A window whose LLM call raised is recorded as a drop and skipped — it did
    # NOT produce extraction. Counting it as done would mark the book complete
    # and make the next run skip it, silently keeping an empty extraction.json.
    failed = sum(1 for d in drops if d.get("kind") == "window")
    if failed:
        logger.warning("%s: %d/%d windows FAILED (see drops.jsonl) — book left "
                       "incomplete; fix the cause and run again",
                       book_id, failed, len(windows))
    complete = len(windows) == windows_total and failed == 0
    # meta first, then extraction.json: a crash between the two just re-runs
    # the book from cache instead of ever mis-reading a partial as complete
    io_utils.atomic_write_text(meta_p, json.dumps({
        "book_id": book_id,
        "document_id": document_id,
        "complete": complete,
        "windows_done": len(windows) - failed,
        "windows_total": windows_total,
        "window_max_chars": WINDOW_MAX_CHARS,
        "window_overlap": WINDOW_OVERLAP,
        "extract_model": config.extract_model(),
        "prompt_version": STAGE2_PROMPT_VERSION,
        "pipeline_version": KB_PIPELINE_VERSION,
        "norm_sha256": saved["norm_sha256"],
        "ocr_source": ndoc.ocr_source,
        "disk_format": mapping.DISK_FORMAT,
    }, ensure_ascii=False, indent=1))
    io_utils.atomic_write_text(outdir / "extraction.json",
                               json.dumps(mapping.prune_extraction(ext),
                                          ensure_ascii=False, indent=1))
    io_utils.atomic_write_text(outdir / "drops.jsonl",
                               "".join(json.dumps(d, ensure_ascii=False) + "\n"
                                       for d in drops))
    summary = {"skipped": False, "complete": complete,
               "windows_done": len(windows) - failed,
               "windows_total": windows_total, "failed_windows": failed,
               "mentions": len(ext.mentions), "proposed": n_proposed,
               "relations": len(ext.relations), "claims": len(ext.claims),
               "appraisals": len(ext.appraisals), "drops": len(drops)}
    logger.info("%s: %d mentions kept (%d proposed), %d relations, "
                "%d claims, %d appraisals; %d drop records",
                book_id, summary["mentions"], summary["proposed"],
                summary["relations"], summary["claims"],
                summary["appraisals"], summary["drops"])
    return summary


def stage2_qc(book_id: str, ndoc: NormalizedDoc) -> str:
    """Human-readable Stage 2 QC report, incl. the span-integrity check."""
    outdir = config.output_dir(book_id)
    if not (outdir / "extraction.json").exists():
        return f"{book_id}: no extraction.json yet"
    saved = split.load_segments(book_id)
    ext = mapping.load_extraction(book_id)
    if ext is None or saved is None:
        return f"{book_id}: extraction.json / segments.json unreadable"
    seg_by_id = {s.id: s for s in
                 SegmentedDocument.model_validate(saved["doc"]).segments}
    lines = [f"== {book_id}: {len(ext.mentions)} mentions, "
             f"{len(ext.relations)} relations, {len(ext.claims)} claims, "
             f"{len(ext.appraisals)} appraisals",
             f"   labels   : {dict(Counter(m.label for m in ext.mentions))}"]
    works = [m for m in ext.mentions if m.label == "work"]
    if works:
        lines.append(f"   work kind: {dict(Counter(m.subtype.value for m in works))}")
    orgs = [m for m in ext.mentions if m.label == "organization"]
    if orgs:
        lines.append(f"   org kind : {dict(Counter(m.subtype.value for m in orgs))}")
    sects = [m for m in ext.mentions if m.label == "sect"]
    if sects:
        lines.append(f"   sect kind: {dict(Counter(m.kind.value for m in sects))}")
    lines.append(f"   relations: "
                 f"{dict(Counter(r.relation_type.value for r in ext.relations))}")
    lines.append(f"   claims   : {dict(Counter(c.predicate.value for c in ext.claims))}")
    lines.append(f"   appraisal: "
                 f"{dict(Counter(a.polarity.value for a in ext.appraisals))}")

    dp = outdir / "drops.jsonl"
    if dp.exists():
        dr = [json.loads(l) for l in
              dp.read_text(encoding="utf-8").splitlines() if l.strip()]
        lines.append(f"   drops    : "
                     f"{dict(Counter(str(d.get('reason', '?')).split(':')[0] for d in dr))}")
        nf = sum(1 for d in dr if d.get("reason") == "mention_not_found")
        prop = nf + len(ext.mentions)
        if prop:
            rate = nf / prop
            flag = ("  <-- HIGH: tighten the verbatim-copy prompt rule"
                    if rate > 0.10 else "")
            lines.append(f"   mention not-found rate: {rate:.1%}{flag}")

    # span integrity: every span must point exactly at its surface form
    bad = [m for m in ext.mentions if m.provenance.span is not None
           and ndoc.text[m.provenance.span.start:m.provenance.span.end].strip()
           != m.surface_form]
    if bad:
        lines.append(f"   WARNING: {len(bad)} mentions whose span text != surface_form")
    else:
        lines.append("   span integrity: OK")
    for mm in random.sample(ext.mentions, min(5, len(ext.mentions))):
        sg = seg_by_id.get(mm.provenance.segment_id)
        lines.append(f"     [{mm.label:>9s}] {mm.surface_form[:42]!r:46s} "
                     f"page={mm.provenance.page} "
                     f"seg={sg.segment_type.value if sg else '?'}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Resume status + full pipeline
# ---------------------------------------------------------------------------

def resume_status(book_id: str, ndoc: NormalizedDoc) -> str:
    """Per-book progress + what a re-run would bill — computed from disk only.
    Stage 2 counts CALLS, not windows: a window is two calls, and after a
    prompt edit to only one pass the other still replays for free."""
    saved = split.load_segments(book_id)
    if saved is not None and not segments_drifted(saved, ndoc):
        s1 = f"done ({len(saved['doc']['segments'])} segments)"
    else:
        drift = " (DRIFTED — will redo)" if saved is not None else ""
        chunks = split.chunk_for_split(ndoc.text)
        known = [s.first_line for s in ndoc.seeds if s.first_line]
        model = config.split_model()
        hits = sum(
            io_utils.cache_path("split", book_id, io_utils.cache_key(
                model, "split-v1", split.SPLIT_SYSTEM_PROMPT,
                split.build_split_user_prompt(ch, ndoc.meta, i + 1,
                                              len(chunks), known),
            )).exists()
            for i, ch in enumerate(chunks))
        s1 = f"pending{drift} — {hits}/{len(chunks)} split calls already cached"
    if saved is None or segments_drifted(saved, ndoc):
        s2 = "blocked on stage 1"
    else:
        meta = io_utils.read_json_or_none(
            config.output_dir(book_id) / "extraction_meta.json")
        have_ext = (config.output_dir(book_id) / "extraction.json").exists()
        if have_ext and (meta is None or meta.get("complete", True)):
            s2 = "done"
        else:
            sdoc = SegmentedDocument.model_validate(saved["doc"])
            wins = plan_book_windows(sdoc, ndoc)
            st = [extract.window_call_status(book_id, ndoc.text, w) for w in wins]
            free = sum(1 for s in st if s.free)
            bill = sum(s.to_bill for s in st)
            skip = sum(1 for s in st if s.links_state == "skipped")
            state = "partial on disk" if have_ext else "pending"
            s2 = (f"{state} — {free}/{len(wins)} windows fully cached, "
                  f"{bill} calls still to bill"
                  + (f" ({skip} windows need no pass B)" if skip else ""))
    return f"{book_id}\n  stage 1: {s1}\n  stage 2: {s2}"


def run_pipeline(document, force_stage1: bool = False, force_stage2: bool = False,
                 windows_limit: int | None = None) -> dict:
    """Stage 0 + 1 + 2 for one document. Returns the stage-2 summary dict."""
    ndoc = normalize_document(document)
    book_id = config.book_id_for(document)
    run_stage1(book_id, ndoc, force=force_stage1, document_id=document.pk)
    return run_stage2(book_id, ndoc, windows_limit=windows_limit,
                      force=force_stage2, document_id=document.pk)
