"""Stage 1 — split detection.

Books don't share one structure (تراجم، حوليات، أبواب، مسائل…), and markdown
headings are present in some OCR outputs but missing in others. Stage 1 asks a
cheap long-context model to identify where structural units START — but never
asks it for character offsets (LLMs cannot count characters reliably). The
model returns each unit's first line VERBATIM; Python then:

1. resolves each returned line to an absolute offset (exact search from a
   forward cursor -> folded-shadow search -> anywhere-in-document as last resort),
2. snaps it to the start of its line and enforces strictly increasing offsets
   (which also collapses duplicates from overlapping chunks),
3. merges the LLM's split points with the markup seeds from Stage 0 (markup
   wins within 5 chars — it is ground truth),
4. builds flat sibling Segments spanning from each split point to the next,
   validated by SegmentedDocument.

Fallback ladder: unresolvable marker -> logged and skipped · zero split points
-> fixed ~6k-char windows (detector=fallback_window, a low-quality flag) ·
invalid segment tree -> same fixed windows. A book never crashes the run.
"""
import bisect
import hashlib
import json
import logging
import os
from collections import defaultdict
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, ConfigDict, ValidationError

from . import config, io_utils, textmatch
from .config import (FALLBACK_SEG_CHARS, KB_PIPELINE_VERSION, NORMALIZER_VERSION,
                     SPLIT_CHUNK_CHARS, SPLIT_CHUNK_TAIL, SPLIT_TEMPERATURE)
from .normalize import NormalizedDoc, meta_title
from .schema import (Segment, SegmentDetector, SegmentType, SegmentedDocument,
                     TextSpan, TextStream)

logger = logging.getLogger(__name__)

SPLIT_SEGMENT_TYPES = ("volume", "book_part", "chapter", "section", "biography",
                       "annal", "hadith_report", "issue", "poem", "paragraph")
SPLIT_STREAMS = ("main", "footnote", "front_matter", "index")


class SplitMarker(BaseModel):
    model_config = ConfigDict(extra="ignore")
    verbatim_line: str
    segment_type: Literal[SPLIT_SEGMENT_TYPES] = "paragraph"
    title: str | None = None
    stream: Literal[SPLIT_STREAMS] = "main"
    confidence: float = 1.0


class SplitResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    markers: list[SplitMarker] = []


SPLIT_SYSTEM_PROMPT = (
    "You are an expert philologist of classical Arabic literature. "
    "You segment books into structural units. Respond with a single JSON "
    "object only - no prose, no markdown fences."
)

_SPLIT_RULES = """حدد بداية كل وحدة بنيوية في النص أدناه. أنواع الوحدات:
- volume = جزء
- book_part = كتاب (قسم كبير داخل المؤلف)
- chapter = باب
- section = فصل
- biography = ترجمة (مداخل مثل «فلان بن فلان...»، وكثيرا ما تكون مرقمة: «12 - محمد بن...»)
- annal = حولية («ثم دخلت سنة كذا»، «سنة خمس وثلاثين»)
- hadith_report = حديث بإسناده ومتنه
- issue = مسألة فقهية
- poem = قصيدة
- paragraph = فقرة (فقط إذا لم يناسب شيء آخر)

القواعد:
1. لكل وحدة أعد سطرها الأول منسوخا حرفيا، حرفا بحرف، من النص أدناه (لا تضف ولا تحذف
   تشكيلا، ولا تطبع الهمزات أو الياء أو التاء المربوطة). إذا تجاوز السطر 120 حرفا
   فانسخ أول 100 حرف منه بالضبط.
2. أعد الوحدات بترتيب ظهورها في النص. لا تخترع سطورا غير موجودة. لا تتخط وحدات.
3. stream: استخدم "front_matter" لمقدمة المحقق ودراسته، و"footnote" لحواشي المحقق،
   و"index" للفهارس، وإلا فـ "main".
4. استهدف أدق مستوى موجود (التراجم أو السنوات المفردة، لا الأبواب فقط).

أعد JSON بهذه البنية فقط:
{"markers": [{"verbatim_line": "...", "segment_type": "...", "title": "...",
"stream": "main", "confidence": 0.9}]}"""


def build_split_user_prompt(chunk: str, meta: dict, part: int, total: int,
                            known_headings: list[str]) -> str:
    title = meta_title(meta) or "غير معروف"
    author = next((v for k, v in meta.items() if "AUTHOR" in k.upper() and v), "غير معروف")
    parts = [f"الكتاب: {title} — المؤلف: {author}",
             f"هذا الجزء {part}/{total} من نص الكتاب (بعد التطبيع).", "", _SPLIT_RULES]
    if known_headings:
        parts += ["", "عناوين اكتشفت مسبقا من ترويسات Markdown (لا تكررها؛ ابحث عما بينها):"]
        parts += [f"- {h}" for h in known_headings[:80]]
    parts += ["", "TEXT:", "<<<", chunk, ">>>"]
    return "\n".join(parts)


def _is_config_error(exc: Exception) -> bool:
    """Missing/dead API key or auth failure: retrying per-chunk (or per-window)
    cannot help, and degrading to fallback output would silently persist."""
    msg = str(exc)
    return ('OPENROUTER_API_KEY' in msg or 'GEMINI_API_KEY' in msg
            or '401' in msg
            or 'AuthenticationError' in type(exc).__name__
            or getattr(exc, 'status_code', None) == 401)


_openrouter = None


def get_openrouter_client():
    """Lazy singleton so importing this module never needs a key (tests,
    migrations). A missing key fails loudly at call time, matching the
    layer0/ner convention."""
    global _openrouter
    if _openrouter is None:
        from openai import OpenAI

        api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
        if not api_key:
            raise RuntimeError("OPENROUTER_API_KEY is not set")
        headers = {"X-Title": "ILM Shamela KB split"}
        referer = os.environ.get("OPENROUTER_REFERER", "").strip()
        if referer:
            headers["HTTP-Referer"] = referer
        _openrouter = OpenAI(base_url="https://openrouter.ai/api/v1",
                             api_key=api_key, default_headers=headers)
    return _openrouter


def chunk_for_split(text: str) -> list[str]:
    """~SPLIT_CHUNK_CHARS chunks cut at line boundaries, with a SPLIT_CHUNK_TAIL
    overlap so units starting near a boundary are seen by both chunks."""
    chunks: list[str] = []
    start, n = 0, len(text)
    while start < n:
        end = min(n, start + SPLIT_CHUNK_CHARS)
        if end < n:
            nl = text.rfind("\n", start, end)
            if nl > start:
                end = nl
        chunks.append(text[start:end])
        if end >= n:
            break
        nl = text.find("\n", max(start + 1, end - SPLIT_CHUNK_TAIL))
        start = nl + 1 if (nl != -1 and nl + 1 < end) else end
    return chunks


def _split_completion(book_id: str, tag: str, user_prompt: str, what: str) -> str:
    """One cached+retried split-model chat completion; returns raw response text."""
    model = config.split_model()
    key = io_utils.cache_key(model, tag, SPLIT_SYSTEM_PROMPT, user_prompt)
    cached = io_utils.cache_get("split", book_id, key)
    if cached is None:
        client = get_openrouter_client()

        def _do():
            return client.chat.completions.create(
                model=model,
                temperature=SPLIT_TEMPERATURE,
                response_format={"type": "json_object"},
                messages=[{"role": "system", "content": SPLIT_SYSTEM_PROMPT},
                          {"role": "user", "content": user_prompt}],
            )
        resp = io_utils.with_retries(_do, what=what)
        cached = {"response_text": resp.choices[0].message.content or ""}
        io_utils.cache_put("split", book_id, key, cached)   # cached BEFORE parsing
    return cached["response_text"]


def call_split_llm(book_id: str, part: int, total: int, chunk: str,
                   meta: dict, known: list[str]) -> list[SplitMarker]:
    prompt = build_split_user_prompt(chunk, meta, part, total, known)
    what = f"split {book_id[:30]} {part}/{total}"
    text = _split_completion(book_id, "split-v1", prompt, what)
    try:
        return SplitResponse.model_validate(io_utils.parse_json_lenient(text)).markers
    except (ValueError, ValidationError) as e:
        repair = (prompt + "\n\nYour previous reply was not valid JSON for the required "
                  f"shape ({str(e)[:500]}). Reply again with ONLY the JSON object.")
        text = _split_completion(book_id, "split-v1-repair", repair, what + " repair")
        return SplitResponse.model_validate(io_utils.parse_json_lenient(text)).markers


def collect_markers(book_id: str, ndoc: NormalizedDoc) -> list[SplitMarker]:
    chunks = chunk_for_split(ndoc.text)
    known = [s.first_line for s in ndoc.seeds if s.first_line]
    markers: list[SplitMarker] = []
    for i, ch in enumerate(chunks):
        try:
            markers.extend(call_split_llm(book_id, i + 1, len(chunks), ch, ndoc.meta, known))
        except Exception as e:
            if _is_config_error(e):
                raise  # every chunk fails the same way — fail stage 1 loudly
            logger.warning("chunk %d/%d split call failed: %s: %s",
                           i + 1, len(chunks), type(e).__name__, str(e)[:200])
    return markers


@dataclass
class SplitPoint:
    offset: int
    segment_type: SegmentType
    title: str | None
    stream: TextStream
    detector: SegmentDetector
    confidence: float


_STREAM_MAP = {"main": TextStream.MAIN, "footnote": TextStream.FOOTNOTE,
               "front_matter": TextStream.FRONT_MATTER, "index": TextStream.INDEX}


def resolve_markers(ndoc: NormalizedDoc,
                    markers: list[SplitMarker]) -> tuple[list[SplitPoint], dict]:
    """Verbatim marker lines -> absolute offsets. Three tiers: exact forward
    search, folded-shadow search (textnorm: diacritics + hamza/ya/ta-marbuta
    folds), anywhere-in-document. Offsets are snapped to line starts and must
    strictly increase (which also collapses duplicates coming from overlapping
    chunks)."""
    shadow, idx_map = textmatch.shadow_with_map(ndoc.text)
    points: list[SplitPoint] = []
    stats = {"total": len(markers), "resolved": 0, "unresolved": []}
    cursor, last_offset = 0, -1
    for m in markers:
        needle = " ".join((m.verbatim_line or "").split())
        if len(needle) < 3:
            stats["unresolved"].append(needle)
            continue
        pos = ndoc.text.find(needle, cursor)
        if pos == -1:                                   # tier 2: folded shadow
            sh_needle = textmatch.shadow(needle)
            sp = shadow.find(sh_needle, bisect.bisect_left(idx_map, cursor))
            if sp != -1:
                pos = idx_map[sp]
        if pos == -1:                                   # tier 3: anywhere
            p2 = ndoc.text.find(needle)
            if p2 != -1 and ndoc.text.rfind("\n", 0, p2) + 1 > last_offset:
                pos = p2
        if pos == -1:
            stats["unresolved"].append(needle[:60])
            continue
        offset = ndoc.text.rfind("\n", 0, pos) + 1      # snap to line start
        if offset <= last_offset:
            continue                                    # duplicate / backward
        points.append(SplitPoint(
            offset=offset, segment_type=SegmentType(m.segment_type),
            title=(m.title or None), stream=_STREAM_MAP.get(m.stream, TextStream.MAIN),
            detector=SegmentDetector.MODEL,
            confidence=max(0.0, min(1.0, m.confidence))))
        stats["resolved"] += 1
        last_offset, cursor = offset, pos + len(needle)
    return points, stats


def seeds_to_points(ndoc: NormalizedDoc) -> list[SplitPoint]:
    return [SplitPoint(s.offset, s.segment_type, s.title, s.stream,
                       SegmentDetector.MARKUP, 1.0) for s in ndoc.seeds]


def merge_points(llm_pts: list[SplitPoint],
                 seed_pts: list[SplitPoint]) -> list[SplitPoint]:
    """Union sorted by offset; within 5 chars, markup (ground truth) wins."""
    out: list[SplitPoint] = []
    for p in sorted(llm_pts + seed_pts, key=lambda p: p.offset):
        if out and p.offset - out[-1].offset <= 5:
            if (p.detector is SegmentDetector.MARKUP
                    and out[-1].detector is not SegmentDetector.MARKUP):
                out[-1] = p
            continue
        out.append(p)
    return out


def fallback_points(text: str) -> list[SplitPoint]:
    pts, start = [], 0
    while start < len(text):
        pts.append(SplitPoint(start, SegmentType.PARAGRAPH, None, TextStream.MAIN,
                              SegmentDetector.FALLBACK_WINDOW, 0.3))
        nl = text.find("\n", start + FALLBACK_SEG_CHARS)
        start = nl + 1 if nl != -1 else len(text)
    return pts


def build_segments(book_id: str, ndoc: NormalizedDoc,
                   points: list[SplitPoint]) -> SegmentedDocument:
    """Flat sibling segments: each split point spans to the next one, so every
    character sits in exactly one segment. Hierarchy is recorded only through
    segment_type/title for now (tree-building is a later refinement)."""
    text_len = len(ndoc.text)
    if not points:
        logger.warning("%s: no split points at all — using fixed fallback windows",
                       book_id)
        points = fallback_points(ndoc.text)
    points = sorted(points, key=lambda p: p.offset)
    if points[0].offset > 0:                       # text before the first split
        points.insert(0, SplitPoint(0, SegmentType.PARAGRAPH, None, TextStream.MAIN,
                                    SegmentDetector.TYPOGRAPHY, 0.5))
    segs: list[Segment] = []
    orders: defaultdict = defaultdict(int)
    for i, p in enumerate(points):
        end = points[i + 1].offset if i + 1 < len(points) else text_len
        if end <= p.offset:
            continue
        segs.append(Segment(
            book_id=book_id, segment_type=p.segment_type, stream=p.stream,
            span=TextSpan(start=p.offset, end=end), parent_id=None,
            order=orders[p.stream], title=p.title, detector=p.detector,
            confidence=p.confidence))
        orders[p.stream] += 1
    try:
        return SegmentedDocument(book_id=book_id, text_length=text_len, segments=segs)
    except ValueError as e:
        logger.warning("%s: segment tree invalid (%s); using fixed fallback windows",
                       book_id, str(e)[:150])
        return build_segments(book_id, ndoc, fallback_points(ndoc.text))


def norm_sha256(ndoc: NormalizedDoc) -> str:
    return hashlib.sha256(ndoc.text.encode("utf-8")).hexdigest()


def save_segments(book_id: str, ndoc: NormalizedDoc, doc: SegmentedDocument,
                  stats: dict, document_id: int | None = None):
    payload = {
        "book_id": book_id,
        "document_id": document_id,
        "pipeline_version": KB_PIPELINE_VERSION,
        "normalizer_version": NORMALIZER_VERSION,
        "norm_sha256": norm_sha256(ndoc),
        "meta": ndoc.meta,
        "resolve_stats": stats,
        "doc": doc.model_dump(mode="json"),
    }
    p = config.output_dir(book_id) / "segments.json"
    io_utils.atomic_write_text(p, json.dumps(payload, ensure_ascii=False, indent=1))
    return p


def load_segments(book_id: str) -> dict | None:
    p = config.output_dir(book_id) / "segments.json"
    saved = io_utils.read_json_or_none(p)
    if saved is None and p.exists():
        logger.warning("%s: segments.json is unreadable (crash-truncated?) — "
                       "treating as missing; Stage 1 will rebuild it from cached calls",
                       book_id)
    return saved
