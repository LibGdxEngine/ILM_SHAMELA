"""
Word-level geometry for PDF-overlay pages.

The datalab/marker layout JSON only carries PARAGRAPH bboxes, so the reader used to
guess where each printed line/word sits. This module turns the tesseract sidecar's
word boxes (``POST /words``) into per-word geometry aligned to the canonical block
text and stores it additively inside ``DocumentChunk.layout``::

    layout.blocks[i].words = [{"start", "end", "bbox", "line", "matched"}, ...]
    layout.blocks[i].word_geometry = {"engine", "version", "method", "coverage",
                                      "lines", "dpi", "tokens", "matched"}

Contract (the frontend renders one absolutely-positioned span per word from it):

* ``start``/``end`` index ``block.text`` (the token without trailing whitespace).
  Word *i*'s DOM text is ``text[start_i:start_{i+1}]`` (0 for the first, ``len(text)``
  for the last), so inter-word whitespace/newlines ride with the preceding word and
  the concatenation is byte-identical to ``block.text`` by construction.
* ``bbox`` is in LAYOUT units (the same space as ``block.bbox``), clipped to the
  block; its y-range is the uniform row of ``line`` (not the glyph ink box), so
  selection paints even rows.
* ``words`` is either complete (every ``\\S+`` token has a box) or absent. A block
  attempted but below the coverage gate keeps ``word_geometry`` without ``words`` —
  the frontend falls back to the line model and the task does not re-OCR it unless
  forced.

``block.text``/``char_start``/``char_end``/``bbox`` are never modified — stored
highlights, notes and search marks anchor on them.

Pure functions only (no Django, no HTTP) so the aligner is unit-testable with
fabricated OCR output; the Celery task in tasks.py does the rendering and I/O.
"""

from __future__ import annotations

import difflib
import re
import statistics
import unicodedata
from dataclasses import dataclass, field
from io import BytesIO
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from extraction.extractors.textnorm import normalize

ENGINE = 'tesseract'
WORD_GEOMETRY_VERSION = 1
RENDER_DPI = 300
MIN_COVERAGE = 0.6
PAD_PX = 6
DEFAULT_PSM = 6
SINGLE_LINE_PSM = 7
SMALL_BLOCK_TOKENS = 3

# Alignment tuning (difflib ratios on match keys).
MAX_GAP = 40
PAIR_MIN = 0.5
POSITIONAL_MIN = 0.4
MERGE_MIN = 0.7
SKIP_PENALTY = -0.3
# Longest run of consecutive unmatched tokens a block may carry and still get words
# (a whole dropped printed line of body text is ~10-13 tokens; anything longer is
# too much interpolation to trust).
MAX_UNMATCHED_RUN = 12
MAX_UNMATCHED_RUN_RATIO = 0.3
# Row height = 2 × ROW_HALF_HEIGHT × median word height; inter-word gap = GAP_FACTOR × char width.
ROW_HALF_HEIGHT = 0.6
GAP_FACTOR = 0.3
ROW_CLUSTER_FACTOR = 0.5
# A vertical jump between consecutive OCR rows larger than this × pitch means
# tesseract dropped printed line(s): phantom rows are inserted so interpolated
# words flow through them at full width.
PHANTOM_ROW_FACTOR = 1.6

# Block types marker emits as one printed line; low-coverage ones fall back to a
# proportional layout over the printed ink extent instead of the frontend guess.
SINGLE_LINE_TYPES = {'PageHeader', 'PageFooter', 'SectionHeader'}
SINGLE_LINE_MAX_TOKENS = 6

_TOKEN_RE = re.compile(r'\S+')
_ARABIC_LETTER_RE = re.compile(r'[ؠ-يٮ-ۓݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-ﻼ]')
_LATIN_LETTER_RE = re.compile(r'[A-Za-zÀ-ɏ]')

BBox = List[float]


@dataclass
class Token:
    start: int
    end: int
    text: str
    key: str = ''

    @property
    def est_len(self) -> int:
        """Character count used for width estimates (punctuation-only tokens keep their length)."""
        return len(self.key) or len(self.text)


@dataclass
class OcrWord:
    text: str
    bbox: BBox
    row: int
    key: str = ''
    conf: float = -1.0


@dataclass
class Row:
    y0: float
    y1: float
    yc: float


@dataclass
class BlockResult:
    words: Optional[List[Dict]]
    meta: Dict


# ---------------------------------------------------------------------------
# Text helpers
# ---------------------------------------------------------------------------

def match_key(text: str) -> str:
    """
    Comparison key: textnorm normalization (tashkeel/tatweel stripped, alef/ya/ta-marbuta
    folded, digits → ASCII) minus punctuation/symbols/separators, lowercased.
    ``(١)`` → ``1``; ``احتاجَت،`` → ``احتاجت``; pure punctuation → ``''``.
    """
    normalized = normalize(text or '')
    return ''.join(
        ch for ch in normalized
        if ch != 'ـ' and unicodedata.category(ch)[0] not in ('P', 'S', 'Z', 'C')
    ).lower()


def tokenize(text: str) -> List[Token]:
    """``\\S+`` tokens with offsets into ``text`` — they partition the block text."""
    return [
        Token(start=m.start(), end=m.end(), text=m.group(0), key=match_key(m.group(0)))
        for m in _TOKEN_RE.finditer(text or '')
    ]


def is_rtl(text: str, default: bool = True) -> bool:
    arabic = len(_ARABIC_LETTER_RE.findall(text or ''))
    latin = len(_LATIN_LETTER_RE.findall(text or ''))
    if arabic == 0 and latin == 0:
        return default
    return arabic >= latin


def block_lang(text: str) -> Optional[str]:
    """Tesseract language override for a block: 'eng' when Latin letters dominate, else None (page default)."""
    arabic = len(_ARABIC_LETTER_RE.findall(text or ''))
    latin = len(_LATIN_LETTER_RE.findall(text or ''))
    return 'eng' if latin > arabic and latin > 0 else None


def is_single_line_block(block: Dict, tokens: Sequence[Token]) -> bool:
    text = block.get('text') or ''
    if '\n' in text:
        return False
    return block.get('type') in SINGLE_LINE_TYPES or len(tokens) <= SINGLE_LINE_MAX_TOKENS


def _ratio(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return difflib.SequenceMatcher(None, a, b).ratio()


def _median(values: Sequence[float], default: float = 0.0) -> float:
    return statistics.median(values) if values else default


# ---------------------------------------------------------------------------
# OCR result → reading-ordered words with row indices
# ---------------------------------------------------------------------------

def order_ocr_lines(lines: Iterable[Dict], sx: float, sy: float, rtl: bool) -> List[OcrWord]:
    """
    Flatten a sidecar region's ``lines`` into reading order and cluster them into rows.

    Coordinates are scaled from image px into layout units (``× sx``, ``× sy``).
    Words within a row are ordered geometrically (x descending for RTL, ascending
    for LTR): tesseract's ``word_num`` order is logical for pure Arabic lines but
    scrambles mixed-direction lines (footnotes full of numbers and parentheses),
    and single-token digit runs read the same either way. Words whose match key is
    empty (pure punctuation, leaders) are dropped — they can never anchor a token.
    """
    prepared = []
    for line in lines or []:
        words = []
        for raw in line.get('words') or []:
            text = (raw.get('text') or '').strip()
            box = raw.get('bbox')
            if not text or not isinstance(box, (list, tuple)) or len(box) != 4:
                continue
            key = match_key(text)
            if not key:
                continue
            try:
                conf = float(raw.get('conf', -1))
            except (TypeError, ValueError):
                conf = -1.0
            bbox = [float(box[0]) * sx, float(box[1]) * sy, float(box[2]) * sx, float(box[3]) * sy]
            words.append(OcrWord(text=text, bbox=bbox, row=-1, key=key, conf=conf))
        if not words:
            continue
        yc = _median([(w.bbox[1] + w.bbox[3]) / 2 for w in words])
        height = _median([w.bbox[3] - w.bbox[1] for w in words])
        prepared.append((yc, height, words))

    if not prepared:
        return []
    prepared.sort(key=lambda item: item[0])
    median_height = _median([h for _, h, _ in prepared], default=1.0) or 1.0
    threshold = ROW_CLUSTER_FACTOR * median_height

    rows: List[List[OcrWord]] = []
    row_centers: List[float] = []
    for yc, _height, words in prepared:
        if rows and abs(yc - row_centers[-1]) < threshold:
            rows[-1].extend(words)
        else:
            rows.append(list(words))
            row_centers.append(yc)

    ordered: List[OcrWord] = []
    for index, words in enumerate(rows):
        words.sort(key=(lambda w: -w.bbox[2]) if rtl else (lambda w: w.bbox[0]))
        for word in words:
            word.row = index
            ordered.append(word)
    return ordered


# ---------------------------------------------------------------------------
# Alignment: source tokens ↔ OCR words
# ---------------------------------------------------------------------------

# assign[i] is None | [j] | [j, j+1] (merge) | ('split', j, part, lengths)
Assignment = object


def align_tokens(tokens: Sequence[Token], ocr: Sequence[OcrWord], rtl: bool) -> List[Assignment]:
    """
    Map each source token to OCR word indices.

    Pass 1: ``difflib.SequenceMatcher`` on match keys anchors the exact runs.
    Pass 2: each ``replace`` gap is resolved positionally when both sides have the
    same count (an OCR misread such as ت→ث), otherwise by a small Needleman–Wunsch
    over pair / merge (tesseract split one printed word) / split (tesseract joined
    two) operations. Finally, matches that break reading order (spurious anchors on
    short function words) are demoted with a longest-increasing-subsequence filter.
    """
    source_keys = [t.key for t in tokens]
    ocr_keys = [w.key for w in ocr]
    assign: List[Assignment] = [None] * len(tokens)
    if not tokens or not ocr:
        return assign

    matcher = difflib.SequenceMatcher(None, source_keys, ocr_keys, autojunk=False)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == 'equal':
            for k in range(i2 - i1):
                if source_keys[i1 + k]:
                    assign[i1 + k] = [j1 + k]
        elif tag == 'replace':
            _resolve_gap(source_keys, ocr_keys, tokens, i1, i2, j1, j2, assign)

    _enforce_reading_order(tokens, ocr, assign, rtl)
    return assign


def _resolve_gap(S, O, tokens, i1, i2, j1, j2, assign) -> None:
    ns, no = i2 - i1, j2 - j1
    if ns == no and (ns <= 3 or all(_ratio(S[i1 + k], O[j1 + k]) >= POSITIONAL_MIN for k in range(ns))):
        for k in range(ns):
            if S[i1 + k]:
                assign[i1 + k] = [j1 + k]
        return
    if ns > MAX_GAP or no > MAX_GAP:
        return

    neg_inf = float('-inf')
    best = [[neg_inf] * (no + 1) for _ in range(ns + 1)]
    back: List[List[Optional[Tuple]]] = [[None] * (no + 1) for _ in range(ns + 1)]
    best[0][0] = 0.0

    def relax(i, j, score, op):
        if score > best[i][j]:
            best[i][j] = score
            back[i][j] = op

    for i in range(ns + 1):
        for j in range(no + 1):
            current = best[i][j]
            if current == neg_inf:
                continue
            if i < ns:
                relax(i + 1, j, current + SKIP_PENALTY, ('skip_s', i, j))
            if j < no:
                relax(i, j + 1, current + SKIP_PENALTY, ('skip_o', i, j))
            if i < ns and j < no:
                r = _ratio(S[i1 + i], O[j1 + j])
                if r >= PAIR_MIN:
                    relax(i + 1, j + 1, current + r, ('pair', i, j))
            if i < ns and j + 1 < no:
                r = _ratio(S[i1 + i], O[j1 + j] + O[j1 + j + 1])
                if r >= MERGE_MIN:
                    relax(i + 1, j + 2, current + r, ('merge', i, j))
            if i + 1 < ns and j < no:
                r = _ratio(S[i1 + i] + S[i1 + i + 1], O[j1 + j])
                if r >= MERGE_MIN:
                    relax(i + 2, j + 1, current + r, ('split', i, j))

    i, j = ns, no
    while i > 0 or j > 0:
        op = back[i][j]
        if op is None:
            break
        kind, pi, pj = op
        if kind == 'pair':
            assign[i1 + pi] = [j1 + pj]
        elif kind == 'merge':
            assign[i1 + pi] = [j1 + pj, j1 + pj + 1]
        elif kind == 'split':
            lengths = [tokens[i1 + pi].est_len, tokens[i1 + pi + 1].est_len]
            assign[i1 + pi] = ('split', j1 + pj, 0, lengths)
            assign[i1 + pi + 1] = ('split', j1 + pj, 1, lengths)
        i, j = pi, pj


def _assigned_bbox(entry: Assignment, ocr: Sequence[OcrWord], rtl: bool) -> Optional[BBox]:
    """Raw OCR-space bbox for an assignment (union for merges, proportional part for splits)."""
    if entry is None:
        return None
    if isinstance(entry, tuple):
        _, j, part, lengths = entry
        box = ocr[j].bbox
        total = float(sum(max(1, n) for n in lengths)) or 1.0
        first = max(1, lengths[0]) / total
        width = box[2] - box[0]
        if rtl:
            # First token (reading order) takes the RIGHT part.
            cut = box[2] - width * first
            return [cut, box[1], box[2], box[3]] if part == 0 else [box[0], box[1], cut, box[3]]
        cut = box[0] + width * first
        return [box[0], box[1], cut, box[3]] if part == 0 else [cut, box[1], box[2], box[3]]
    boxes = [ocr[j].bbox for j in entry]
    return [
        min(b[0] for b in boxes), min(b[1] for b in boxes),
        max(b[2] for b in boxes), max(b[3] for b in boxes),
    ]


def _assigned_row(entry: Assignment, ocr: Sequence[OcrWord]) -> Optional[int]:
    if entry is None:
        return None
    if isinstance(entry, tuple):
        return ocr[entry[1]].row
    return ocr[entry[0]].row


def _enforce_reading_order(tokens, ocr, assign, rtl) -> None:
    """Keep the longest subsequence of matches whose (row, inline position) strictly increases."""
    matched = [i for i, entry in enumerate(assign) if entry is not None]
    if len(matched) < 2:
        return
    positions = []
    for i in matched:
        box = _assigned_bbox(assign[i], ocr, rtl)
        row = _assigned_row(assign[i], ocr)
        inline = -box[2] if rtl else box[0]
        positions.append((row, inline))

    n = len(positions)
    length = [1] * n
    prev = [-1] * n
    for a in range(n):
        for b in range(a):
            if positions[b] < positions[a] and length[b] + 1 > length[a]:
                length[a] = length[b] + 1
                prev[a] = b
    end = max(range(n), key=lambda k: (length[k], -k))
    keep = set()
    while end != -1:
        keep.add(end)
        end = prev[end]
    for k, i in enumerate(matched):
        if k not in keep:
            assign[i] = None


# ---------------------------------------------------------------------------
# Rows and placement
# ---------------------------------------------------------------------------

def build_rows(ocr: Sequence[OcrWord], block_bbox: BBox) -> Tuple[List[Row], float, float]:
    """
    Uniform rows from OCR row membership: height = 2 × ROW_HALF_HEIGHT × median word
    height, centred on each row's median word centre, adjacent rows clamped at their
    midpoints and clipped to the block. Where consecutive rows are more than
    PHANTOM_ROW_FACTOR × pitch apart, phantom rows are inserted for the printed
    line(s) tesseract dropped — the OCR words' ``row`` indices are renumbered IN
    PLACE to match. Returns (rows, H, pitch).
    """
    by_row: Dict[int, List[OcrWord]] = {}
    for word in ocr:
        by_row.setdefault(word.row, []).append(word)
    heights = [w.bbox[3] - w.bbox[1] for w in ocr]
    block_h = max(1.0, block_bbox[3] - block_bbox[1])
    H = _median(heights, default=block_h) or block_h

    centres = []
    for index in sorted(by_row):
        words = by_row[index]
        centres.append((index, _median([(w.bbox[1] + w.bbox[3]) / 2 for w in words])))

    deltas = [centres[k + 1][1] - centres[k][1] for k in range(len(centres) - 1)]
    positive = [d for d in deltas if d > 0]
    if positive:
        smallest = min(positive)
        pitch = _median([d for d in positive if d <= PHANTOM_ROW_FACTOR * smallest], default=smallest)
    else:
        pitch = 1.4 * H
    pitch = max(pitch, 1.0)

    # Expand into the final row list, inserting phantom rows into large gaps.
    row_centres: List[float] = []
    remap: Dict[int, int] = {}
    for k, (index, yc) in enumerate(centres):
        if k > 0:
            gap = yc - row_centres[-1]
            if gap > PHANTOM_ROW_FACTOR * pitch:
                missing = max(0, int(round(gap / pitch)) - 1)
                for m in range(missing):
                    row_centres.append(row_centres[-1] + gap / (missing + 1))
        remap[index] = len(row_centres)
        row_centres.append(yc)
    for word in ocr:
        word.row = remap[word.row]

    rows = [Row(y0=yc - ROW_HALF_HEIGHT * H, y1=yc + ROW_HALF_HEIGHT * H, yc=yc) for yc in row_centres]
    for k in range(len(rows) - 1):
        if rows[k].y1 > rows[k + 1].y0:
            mid = (rows[k].yc + rows[k + 1].yc) / 2
            rows[k].y1 = mid
            rows[k + 1].y0 = mid
    for row in rows:
        row.y0 = max(block_bbox[1], row.y0)
        row.y1 = min(block_bbox[3], row.y1)
        if row.y1 <= row.y0:
            row.y1 = min(block_bbox[3], row.y0 + 1.0)
    return rows, H, pitch


def _clip_x(box: BBox, block: BBox) -> BBox:
    x0 = min(max(box[0], block[0]), block[2])
    x1 = min(max(box[2], block[0]), block[2])
    if x1 <= x0:
        x1 = min(block[2], x0 + 1.0)
        if x1 <= x0:
            x0 = max(block[0], x1 - 1.0)
    return [x0, box[1], x1, box[3]]


def _layout_segment(indices: List[int], tokens: Sequence[Token], span: Tuple[float, float],
                    row: Row, rtl: bool, cw: float, fill: bool, out: Dict[int, Tuple[BBox, int]],
                    row_index: int) -> None:
    """Place a run of unmatched tokens inside ``span`` on ``row`` (reading order)."""
    if not indices:
        return
    x0, x1 = span
    avail = max(0.0, x1 - x0)
    gap = GAP_FACTOR * cw
    widths = [max(1.0, tokens[i].est_len * cw) for i in indices]
    total = sum(widths)
    m = len(indices)
    if fill:
        need = total + (m + 1) * gap
        if need > avail:
            f = avail / need if need > 0 else 0.0
            widths = [w * f for w in widths]
            gap *= f
        else:
            gap = (avail - total) / (m + 1)
    else:
        need = total + (m + 1) * gap
        if need > avail:
            f = avail / need if need > 0 else 0.0
            widths = [w * f for w in widths]
            gap *= f
    cursor = (x1 - gap) if rtl else (x0 + gap)
    for k, i in enumerate(indices):
        w = widths[k]
        if rtl:
            box = [cursor - w, row.y0, cursor, row.y1]
            cursor -= w + gap
        else:
            box = [cursor, row.y0, cursor + w, row.y1]
            cursor += w + gap
        out[i] = (box, row_index)


def _capacity_split(indices: List[int], tokens: Sequence[Token], capacities: List[float],
                    cw: float) -> List[List[int]]:
    """Greedy split of a token run over consecutive segments by natural width; the last takes the rest."""
    gap = GAP_FACTOR * cw
    segments: List[List[int]] = []
    pos = 0
    for s, cap in enumerate(capacities):
        seg: List[int] = []
        if s == len(capacities) - 1:
            seg = indices[pos:]
            pos = len(indices)
        else:
            used = gap
            while pos < len(indices):
                need = max(1.0, tokens[indices[pos]].est_len * cw) + gap
                if used + need > cap and seg:
                    break
                if used + need > cap and not seg:
                    break
                used += need
                seg.append(indices[pos])
                pos += 1
        segments.append(seg)
    if pos < len(indices):
        segments[-1].extend(indices[pos:])
    return segments


def place_words(tokens: Sequence[Token], assign: Sequence[Assignment], ocr: Sequence[OcrWord],
                block_bbox: BBox, rtl: bool) -> Tuple[List[Dict], int]:
    """
    Final per-token boxes: matched tokens take their OCR x-range on the uniform row;
    unmatched runs are interpolated between their matched neighbours (same row →
    fill the gap; across rows → finish the row, fill intermediate rows, lead into the
    next match; block edges → from the inline-start edge / onto virtual rows).
    Returns (words, row_count).
    """
    rows, H, pitch = build_rows(ocr, block_bbox)
    placed: Dict[int, Tuple[BBox, int]] = {}
    matched_widths = 0.0
    matched_chars = 0
    for i, entry in enumerate(assign):
        if entry is None:
            continue
        raw = _assigned_bbox(entry, ocr, rtl)
        row_index = _assigned_row(entry, ocr)
        row = rows[row_index]
        box = _clip_x([raw[0], row.y0, raw[2], row.y1], block_bbox)
        placed[i] = (box, row_index)
        matched_widths += box[2] - box[0]
        matched_chars += tokens[i].est_len
    block_w = max(1.0, block_bbox[2] - block_bbox[0])
    total_chars = sum(t.est_len for t in tokens) or 1
    cw = (matched_widths / matched_chars) if matched_chars else (block_w / total_chars)
    cw = max(cw, 0.5)

    virtual_rows: List[Row] = []

    def row_at(index: int) -> Row:
        if index < len(rows):
            return rows[index]
        k = index - len(rows)
        while len(virtual_rows) <= k:
            base = rows[-1].yc if rows else block_bbox[1] + ROW_HALF_HEIGHT * H
            yc = base + pitch * (len(virtual_rows) + 1)
            y0 = min(max(block_bbox[1], yc - ROW_HALF_HEIGHT * H), block_bbox[3] - 1.0)
            y1 = min(block_bbox[3], y0 + 2 * ROW_HALF_HEIGHT * H)
            if y1 <= y0:
                y1 = block_bbox[3]
                y0 = max(block_bbox[1], y1 - 2 * ROW_HALF_HEIGHT * H)
            virtual_rows.append(Row(y0=y0, y1=y1, yc=(y0 + y1) / 2))
        return virtual_rows[k]

    full_span = (block_bbox[0], block_bbox[2])

    def after_span(box: BBox) -> Tuple[float, float]:
        """Remainder of a row after a matched box (toward the inline-end edge)."""
        return (block_bbox[0], box[0]) if rtl else (box[2], block_bbox[2])

    def before_span(box: BBox) -> Tuple[float, float]:
        """Lead of a row before a matched box (from the inline-start edge)."""
        return (box[2], block_bbox[2]) if rtl else (block_bbox[0], box[0])

    def between_span(a: BBox, b: BBox) -> Tuple[float, float]:
        return (b[2], a[0]) if rtl else (a[2], b[0])

    n = len(tokens)
    i = 0
    while i < n:
        if i in placed:
            i += 1
            continue
        run_start = i
        while i < n and i not in placed:
            i += 1
        run = list(range(run_start, i))
        prev_i = run_start - 1 if run_start > 0 else None
        next_i = i if i < n else None
        a = placed.get(prev_i) if prev_i is not None else None
        b = placed.get(next_i) if next_i is not None else None

        if a is not None and b is not None and a[1] == b[1]:
            _layout_segment(run, tokens, between_span(a[0], b[0]), row_at(a[1]), rtl, cw, True, placed, a[1])
            continue

        # Build the ordered list of (span, row_index) segments the run flows through.
        segments: List[Tuple[Tuple[float, float], int]] = []
        if a is not None:
            segments.append((after_span(a[0]), a[1]))
            start_row = a[1] + 1
        else:
            start_row = 0
        if b is not None:
            for r in range(start_row, b[1]):
                segments.append((full_span, r))
            segments.append((before_span(b[0]), b[1]))
        else:
            for r in range(start_row, len(rows)):
                segments.append((full_span, r))
            # Overflow goes onto virtual rows below the last real row.
            gap = GAP_FACTOR * cw
            need = sum(max(1.0, tokens[k].est_len * cw) + gap for k in run)
            have = sum(max(0.0, s[1] - s[0]) for s, _ in segments)
            extra_row = len(rows)
            while have < need:
                segments.append((full_span, extra_row))
                have += block_w
                extra_row += 1
            if not segments:
                segments.append((full_span, len(rows)))

        capacities = [max(0.0, s[1] - s[0]) for s, _ in segments]
        split = _capacity_split(run, tokens, capacities, cw)
        for s, (span, row_index) in enumerate(segments):
            indices = split[s]
            if not indices:
                continue
            is_last_segment = all(not split[t] for t in range(s + 1, len(segments)))
            # A run that ENDS on a matched word's row remainder (or on the block's
            # final line) keeps natural widths hugging its neighbour; every other
            # segment is a full printed line and is justified.
            natural = is_last_segment and (b is None or (a is not None and s == 0))
            _layout_segment(indices, tokens, span, row_at(row_index), rtl, cw, not natural, placed, row_index)

    words = []
    for k, token in enumerate(tokens):
        box, row_index = placed[k]
        box = _clip_x(box, block_bbox)
        words.append({
            'start': token.start,
            'end': token.end,
            'bbox': [round(v, 1) for v in box],
            'line': row_index,
            'matched': assign[k] is not None,
        })
    return words, len(rows) + len(virtual_rows)


# ---------------------------------------------------------------------------
# Block-level entry points
# ---------------------------------------------------------------------------

def _meta(method: str, coverage: float, lines: int, tokens: int, matched: int) -> Dict:
    return {
        'engine': ENGINE,
        'version': WORD_GEOMETRY_VERSION,
        'method': method,
        'coverage': round(coverage, 3),
        'lines': lines,
        'dpi': RENDER_DPI,
        'tokens': tokens,
        'matched': matched,
    }


def _proportional_words(tokens: Sequence[Token], block_bbox: BBox, rtl: bool) -> List[Dict]:
    """Single-row split of the block bbox ∝ (est_len + 1), first token at the inline-start edge."""
    weights = [t.est_len + 1 for t in tokens]
    total = float(sum(weights)) or 1.0
    width = block_bbox[2] - block_bbox[0]
    words = []
    cursor = block_bbox[2] if rtl else block_bbox[0]
    for token, weight in zip(tokens, weights):
        w = width * weight / total
        box = [cursor - w, block_bbox[1], cursor, block_bbox[3]] if rtl else [cursor, block_bbox[1], cursor + w, block_bbox[3]]
        cursor = cursor - w if rtl else cursor + w
        words.append({
            'start': token.start, 'end': token.end,
            'bbox': [round(v, 1) for v in _clip_x(box, block_bbox)],
            'line': 0, 'matched': False,
        })
    return words


def scaled_ink_bbox(region: Optional[Dict], sx: float, sy: float, block_bbox: BBox) -> Optional[BBox]:
    """The sidecar's ink extent in layout units, clipped to the block; None when absent/degenerate."""
    raw = (region or {}).get('ink_bbox')
    if not isinstance(raw, (list, tuple)) or len(raw) != 4:
        return None
    try:
        box = [float(raw[0]) * sx, float(raw[1]) * sy, float(raw[2]) * sx, float(raw[3]) * sy]
    except (TypeError, ValueError):
        return None
    box = [
        min(max(box[0], block_bbox[0]), block_bbox[2]),
        min(max(box[1], block_bbox[1]), block_bbox[3]),
        min(max(box[2], block_bbox[0]), block_bbox[2]),
        min(max(box[3], block_bbox[1]), block_bbox[3]),
    ]
    if box[2] - box[0] < 2 or box[3] - box[1] < 2:
        return None
    return box


def is_small_block(text: str, tokens: Sequence[Token]) -> bool:
    return 0 < len(tokens) <= SMALL_BLOCK_TOKENS and '\n' not in (text or '')


def block_psm(text: str, tokens: Sequence[Token]) -> int:
    return SINGLE_LINE_PSM if is_small_block(text, tokens) else DEFAULT_PSM


def block_word_geometry(block: Dict, region: Optional[Dict], sx: float, sy: float,
                        default_rtl: bool = True) -> Optional[BlockResult]:
    """
    Compute word geometry for one layout block from its sidecar region result.

    ``region`` is the matching entry of the sidecar's ``regions`` list (image px) or
    None when the block needed no OCR (single token). Returns None when nothing
    should be recorded (no tokens, or the sidecar reported an error for the region
    so a later run can retry).
    """
    text = block.get('text') or ''
    bbox = block.get('bbox')
    if not isinstance(bbox, (list, tuple)) or len(bbox) != 4:
        return None
    block_bbox = [float(v) for v in bbox]
    if block_bbox[2] <= block_bbox[0] or block_bbox[3] <= block_bbox[1]:
        return None
    tokens = tokenize(text)
    n = len(tokens)
    if n == 0:
        return None
    rtl = is_rtl(text, default=default_rtl)
    # Printed extent (from the sidecar) — tighter than marker's block box and
    # available even when tesseract reads nothing (ornamental headers).
    ink = scaled_ink_bbox(region, sx, sy, block_bbox) if region and not region.get('error') else None
    extent = ink or block_bbox

    if n == 1:
        token = tokens[0]
        word = {'start': token.start, 'end': token.end, 'bbox': [round(v, 1) for v in extent],
                'line': 0, 'matched': False}
        return BlockResult(words=[word], meta=_meta('block', 1.0, 1, 1, 0))

    if region is None or region.get('error'):
        return None
    ocr = order_ocr_lines(region.get('lines') or [], sx, sy, rtl)

    if is_small_block(text, tokens):
        if len(ocr) == n:
            assign: List[Assignment] = [[j] for j in range(n)]
            words, row_count = place_words(tokens, assign, ocr, block_bbox, rtl)
            return BlockResult(words=words, meta=_meta('ocr', 1.0, row_count, n, n))
        return BlockResult(words=_proportional_words(tokens, extent, rtl),
                           meta=_meta('proportional', 1.0, 1, n, 0))

    alignable = [t for t in tokens if t.key]
    if not alignable:
        return BlockResult(words=_proportional_words(tokens, extent, rtl),
                           meta=_meta('proportional', 1.0, 1, n, 0))
    single_line = is_single_line_block(block, tokens)
    if not ocr:
        if single_line:
            return BlockResult(words=_proportional_words(tokens, extent, rtl),
                               meta=_meta('proportional', 0.0, 1, n, 0))
        return BlockResult(words=None, meta=_meta('ocr', 0.0, 0, n, 0))

    assign = align_tokens(tokens, ocr, rtl)
    matched = sum(1 for entry in assign if entry is not None)
    coverage = matched / len(alignable)
    longest_gap = 0
    current = 0
    for entry in assign:
        if entry is None:
            current += 1
            longest_gap = max(longest_gap, current)
        else:
            current = 0
    rows_seen = len({w.row for w in ocr})
    if coverage < MIN_COVERAGE or longest_gap > max(MAX_UNMATCHED_RUN, MAX_UNMATCHED_RUN_RATIO * n):
        if single_line:
            # A one-line header tesseract garbled: lay the words out proportionally
            # over the printed extent rather than leaving it to the frontend guess.
            return BlockResult(words=_proportional_words(tokens, extent, rtl),
                               meta=_meta('proportional', coverage, 1, n, matched))
        return BlockResult(words=None, meta=_meta('ocr', coverage, rows_seen, n, matched))

    words, row_count = place_words(tokens, assign, ocr, block_bbox, rtl)
    return BlockResult(words=words, meta=_meta('ocr', coverage, row_count, n, matched))


# ---------------------------------------------------------------------------
# Page-level helpers used by the task
# ---------------------------------------------------------------------------

def page_scale(layout: Dict, image_width: int, image_height: int) -> Tuple[float, float]:
    """Layout units per image pixel (marker raster vs our render differ in dpi and ~0.4% in aspect)."""
    width = float(layout.get('width') or 0) or float(image_width)
    height = float(layout.get('height') or 0) or float(image_height)
    return width / max(1, image_width), height / max(1, image_height)


def needs_geometry(block: Dict, force: bool = False) -> bool:
    if force:
        return True
    return not isinstance(block.get('word_geometry'), dict)


def page_regions(layout: Dict, sx: float, sy: float, force: bool = False) -> List[Dict]:
    """
    Sidecar regions (image px) for the blocks of one page that need geometry (or all
    of them when ``force``): multi-token blocks are OCR'd (Latin-dominant ones with
    ``lang='eng'``), single-token blocks only ask for their ink extent. Region ids are
    the block indices so results map back regardless of block id shape.
    """
    regions = []
    for index, block in enumerate(layout.get('blocks') or []):
        if not needs_geometry(block, force):
            continue
        bbox = block.get('bbox')
        if not isinstance(bbox, (list, tuple)) or len(bbox) != 4:
            continue
        text = block.get('text') or ''
        tokens = tokenize(text)
        if not tokens:
            continue
        x0, y0, x1, y1 = (float(v) for v in bbox)
        if x1 <= x0 or y1 <= y0:
            continue
        region = {'id': str(index), 'bbox': [x0 / sx, y0 / sy, x1 / sx, y1 / sy]}
        if len(tokens) == 1:
            # No OCR needed — only the printed extent for the single word.
            region['ink_only'] = True
        else:
            region['psm'] = block_psm(text, tokens)
            lang = block_lang(text)
            if lang:
                region['lang'] = lang
        regions.append(region)
    return regions


def apply_word_geometry_to_page(layout: Dict, sidecar_result: Optional[Dict], sx: float, sy: float,
                                default_rtl: bool = True, force: bool = False) -> Tuple[Dict, Dict]:
    """
    Return (new_layout, stats). ``new_layout`` is a fresh dict whose blocks carry
    ``words``/``word_geometry`` where computed; block text/offsets/bbox are copied
    untouched. ``sidecar_result`` may be None when the page had no OCR regions.
    """
    by_id: Dict[str, Dict] = {}
    for region in (sidecar_result or {}).get('regions') or []:
        if isinstance(region, dict) and region.get('id') is not None:
            by_id[str(region['id'])] = region

    stats = {'blocks': 0, 'attempted': 0, 'with_words': 0, 'low_coverage': 0, 'errors': 0,
             'skipped': 0, 'coverages': []}
    new_blocks = []
    for index, block in enumerate(layout.get('blocks') or []):
        stats['blocks'] += 1
        new_block = dict(block)
        if not needs_geometry(block, force):
            stats['skipped'] += 1
            new_blocks.append(new_block)
            continue
        region = by_id.get(str(index))
        if region is not None and region.get('error'):
            stats['errors'] += 1
        result = block_word_geometry(block, region, sx, sy, default_rtl=default_rtl)
        if result is None:
            new_block.pop('words', None) if force else None
            new_blocks.append(new_block)
            continue
        stats['attempted'] += 1
        stats['coverages'].append(result.meta['coverage'])
        new_block['word_geometry'] = result.meta
        if result.words is not None:
            new_block['words'] = result.words
            stats['with_words'] += 1
        else:
            new_block.pop('words', None)
            stats['low_coverage'] += 1
        new_blocks.append(new_block)

    coverages = stats.pop('coverages')
    stats['mean_coverage'] = round(sum(coverages) / len(coverages), 3) if coverages else None
    new_layout = dict(layout)
    new_layout['blocks'] = new_blocks
    return new_layout, stats


def render_page_images(pdf, first_page: int, last_page: int, dpi: int = RENDER_DPI):
    """
    Grayscale PNG renders of PDF pages ``first_page..last_page`` (1-based, inclusive):
    ``[(page_number, png_bytes, width, height), ...]``. ``pdf`` is a filesystem path
    (str) or the PDF bytes.
    """
    from pdf2image import convert_from_bytes, convert_from_path

    kwargs = {'first_page': first_page, 'last_page': last_page, 'dpi': dpi, 'grayscale': True}
    images = convert_from_path(pdf, **kwargs) if isinstance(pdf, str) else convert_from_bytes(pdf, **kwargs)
    rendered = []
    for offset, image in enumerate(images):
        if image.mode != 'L':
            image = image.convert('L')
        buffer = BytesIO()
        image.save(buffer, format='PNG', compress_level=1)
        rendered.append((first_page + offset, buffer.getvalue(), image.width, image.height))
        image.close()
    return rendered
