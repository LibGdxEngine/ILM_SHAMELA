"""Stage 0 — normalization of Document.content into a NormalizedDoc.

Every downstream offset (segments, mention spans, provenance) is ABSOLUTE into
the normalized text produced here, never into the raw content. The normalizer
is a single forward pass that emits into an output buffer and records events at
the current output offset — it never edits text it already emitted, so offsets
are stable by construction.

Input is the project's canonical pagination of ``Document.content``
(``split_document_content_into_pages``: form feeds, then blank-line runs, then
fixed chunks). Per line the Markdown-decoration stripping from the notebook is
kept deliberately: Chandra/Docling OCR emit markdown-flavored text, while plain
Tika text passes through nearly untouched. **Arabic orthography and diacritics
are never touched** — surface forms stay verbatim; fuzzy matching later uses
the folded shadow in ``textmatch`` with an index-back map.

Page starts are recorded so ``page_for_offset`` can stamp ``Provenance.page``
with the same 1-based page numbers the rest of the project uses
(``EntityMention.page_number``). Documents carry no volume structure, so
volume is always ``None``.
"""
import bisect
import re
from collections import Counter
from dataclasses import dataclass

from .config import NORMALIZER_VERSION  # noqa: F401  (re-exported for callers)
from .schema import SegmentType, TextStream

ATX_RE = re.compile(r"^(#{1,6})\s+(.*)$")
SETEXT_H1_RE = re.compile(r"^\s*=+\s*$")
HR_RE = re.compile(r"^\s*(?:-{3,}|\*{3,}|_{3,})\s*$")
BULLET_RE = re.compile(r"^\s*[-+*]\s+")
BLOCKQUOTE_RE = re.compile(r"^\s*(?:>\s*)+")
MD_INLINE_SUBS = [
    (re.compile(r"!\[([^\]]*)\]\([^)]*\)"), r"\1"),   # image  -> alt text
    (re.compile(r"\[([^\]]+)\]\([^)]*\)"), r"\1"),    # link   -> link text
]
MD_STRIP_RES = [
    re.compile(r"\*{1,3}"),                 # bold / italic markers
    re.compile(r"__|(?<!\w)_|_(?!\w)"),     # underscore emphasis
    re.compile(r"`+"),                      # inline code ticks
    re.compile(r"</?[a-zA-Z][^>]*>"),       # simple html tags
]
WS_RE = re.compile(r"[ \t\u00a0]+")
LEFTOVER_TOKEN_RE = re.compile(r"(?<!\S)[#>][^\s]*")

HEADING_LEVEL_TO_TYPE = {1: SegmentType.BOOK_PART, 2: SegmentType.CHAPTER}
# heading level >= 3 -> SECTION


@dataclass
class MarkupSeed:
    offset: int                  # absolute offset into the normalized text
    segment_type: SegmentType
    title: str | None
    stream: TextStream
    first_line: str              # cleaned first line (for prompts / debugging)


@dataclass
class NormalizedDoc:
    book_id: str
    text: str
    page_offsets: list[int]                 # START offset of each page in text
    page_labels: list[str]                  # 1-based page numbers as strings
    seeds: list[MarkupSeed]
    meta: dict[str, str]
    unknown_tokens: Counter
    ocr_source: bool = False


def _clean_fragment(s: str, unknown: Counter | None = None) -> str:
    for rx, repl in MD_INLINE_SUBS:
        s = rx.sub(repl, s)
    for rx in MD_STRIP_RES:
        s = rx.sub("", s)
    if unknown is not None:
        for tok in LEFTOVER_TOKEN_RE.findall(s):
            unknown[tok[:20]] += 1
    return WS_RE.sub(" ", s).strip()


def normalize_pages(pages: list[dict], book_id: str,
                    meta: dict[str, str] | None = None,
                    ocr_source: bool = False) -> NormalizedDoc:
    """``pages`` as returned by ``split_document_content_into_pages``. A
    pre-populated ``meta`` (DB title/author) wins over headings in the text."""
    out_parts: list[str] = []
    out_len = 0
    seeds: list[MarkupSeed] = []
    meta = dict(meta or {})
    unknown: Counter = Counter()
    page_offsets: list[int] = []
    page_labels: list[str] = []
    prev_start: int | None = None    # last emitted line (for setext === headings)
    prev_text = ""

    for page in pages:
        page_offsets.append(out_len)
        page_labels.append(str(page["page_number"]))
        for ln in page["content"].splitlines():
            if HR_RE.match(ln):
                continue
            if SETEXT_H1_RE.match(ln):
                if prev_text and prev_start is not None \
                        and not any(s.offset == prev_start for s in seeds):
                    seeds.append(MarkupSeed(
                        offset=prev_start, segment_type=SegmentType.BOOK_PART,
                        title=prev_text[:120] or None, stream=TextStream.MAIN,
                        first_line=prev_text[:120]))
                    meta.setdefault("title", prev_text[:200])
                continue

            seg_type: SegmentType | None = None
            m_h = ATX_RE.match(ln)
            if m_h:
                seg_type = HEADING_LEVEL_TO_TYPE.get(
                    len(m_h.group(1)), SegmentType.SECTION)
                rest = m_h.group(2)
            else:
                rest = BULLET_RE.sub("", BLOCKQUOTE_RE.sub("", ln))

            cleaned = _clean_fragment(rest, unknown)
            if seg_type is not None:
                seeds.append(MarkupSeed(
                    offset=out_len, segment_type=seg_type,
                    title=cleaned[:120] or None, stream=TextStream.MAIN,
                    first_line=cleaned[:120]))
                if seg_type is SegmentType.BOOK_PART and cleaned:
                    meta.setdefault("title", cleaned[:200])
            if not cleaned:
                continue
            prev_start, prev_text = out_len, cleaned
            out_parts.append(cleaned + "\n")
            out_len += len(cleaned) + 1

    meta.setdefault("title", book_id)
    return NormalizedDoc(
        book_id=book_id, text="".join(out_parts),
        page_offsets=page_offsets, page_labels=page_labels,
        seeds=seeds, meta=meta, unknown_tokens=unknown,
        ocr_source=ocr_source)


def normalize_document(document) -> NormalizedDoc:
    """Stage 0 over one ``search_engine.Document``. Deterministic — safe to
    recompute anywhere; ``segments.json`` records its sha256 for drift checks."""
    from search_engine.utils import split_document_content_into_pages

    from .config import book_id_for

    book_id = book_id_for(document)
    pages = split_document_content_into_pages(document.content or '')
    meta: dict[str, str] = {}
    if document.title:
        meta["title"] = document.title[:200]
    authors = ", ".join(document.authors.values_list("name", flat=True))
    if authors:
        meta["author"] = authors[:200]
    return normalize_pages(
        pages, book_id, meta,
        ocr_source=bool(getattr(document, "ocr_engine_used", "") or ""))


def page_for_offset(ndoc: NormalizedDoc, offset: int) -> tuple[str | None, str | None]:
    """(volume, page) for an absolute offset into the normalized text.
    Volume is always None for DB documents; page is the 1-based page number
    as a string, aligned with EntityMention.page_number semantics."""
    if not ndoc.page_offsets:
        return None, None
    i = bisect.bisect_right(ndoc.page_offsets, offset) - 1
    if i < 0:
        return None, None
    return None, ndoc.page_labels[i]


def meta_title(meta: dict[str, str]) -> str | None:
    for k, v in meta.items():
        if "TITLE" in k.upper() and v:
            return v
    return None
