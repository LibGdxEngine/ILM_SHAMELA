"""Shared Arabic normalization for gazetteer/pattern matching.

Deliberately mirrors the folding of the ``arabic_exact`` ES analyzer
(``search_engine/documents.py``: harakat/tatweel stripped, آ/أ/إ→ا, ى→ي, ة→ه,
lowercase) so gazetteer keys and index-time behavior agree, plus
Arabic-Indic → ASCII digit translation for numeric parsing.

Critical rule: normalization changes string length (harakat removal), so
matchers run on the normalized *shadow* string and translate spans back via
the returned index map — mention offsets ALWAYS index the original page text.
"""
from typing import List, Tuple

# Skipped entirely (zero-width in the shadow string): harakat, tatweel,
# Quranic annotation signs, BOM/zero-width marks.
_SKIP = set()
for _lo, _hi in (
    (0x064B, 0x065F),   # tashkeel
    (0x06D6, 0x06ED),   # Quranic annotation marks
):
    _SKIP.update(chr(c) for c in range(_lo, _hi + 1))
_SKIP.update({'ـ', 'ٰ', '﻿', '​', '‌', '‍', '‎', '‏'})

_FOLD = {
    'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا',
    'ى': 'ي', 'ة': 'ه',
    # Arabic-Indic and Extended (Persian) digits → ASCII
    '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
    '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
    '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
    '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
}


def normalize_with_map(text: str) -> Tuple[str, List[int]]:
    """``(normalized, index_map)`` where ``index_map[i]`` is the ORIGINAL index
    of the character that produced ``normalized[i]``. To translate a shadow
    span ``[s, e)`` back: start = index_map[s], end = index_map[e-1] + 1."""
    out_chars: List[str] = []
    index_map: List[int] = []
    for i, ch in enumerate(text):
        if ch in _SKIP:
            continue
        out_chars.append(_FOLD.get(ch, ch.lower()))
        index_map.append(i)
    return ''.join(out_chars), index_map


def normalize(text: str) -> str:
    """Normalization without the offset map (gazetteer keys, comparisons)."""
    return normalize_with_map(text)[0]


def shadow_span_to_original(index_map: List[int], start: int, end: int) -> Tuple[int, int]:
    """Translate a ``[start, end)`` span in the shadow string to original
    offsets. ``end`` must be > ``start``."""
    return index_map[start], index_map[end - 1] + 1
