"""In-text date extractor: ``سنة ٧٢٨ هـ``, death markers ``(ت ٢٠٤هـ)`` /
``المتوفى سنة ٩١١``, era-marked ranges, and a bounded spelled-out-numeral
grammar (``سنة ثمان وعشرين وسبعمائة`` → 728, summation of unit/ten/hundred
words). Deliberately does NOT move or replace ``search_engine.hijri_dates``
(Author.save() depends on it) — that module normalizes *metadata* death
fields; this one finds dates inside page text.

Calendar inference: ``هـ``→hijri, ``م``→gregorian (confidence 0.9); no marker
→ hijri when year ≤ 1500, else gregorian (confidence 0.6). Day/month
resolution and per-date CE↔AH conversion are out of scope for v1.
"""
import re
from typing import List, Optional, Tuple

from .base import BaseExtractor, DocContext, MentionSpan, register_extractor
from .textnorm import normalize_with_map, shadow_span_to_original

_MAX_HIJRI = 1500
_MAX_YEAR = 2200

# Post-normalization word values (ة→ه). Summation composes classical year
# phrases: ثمان + وعشرين + وسبعمائه = 728; خمس عشره = 15.
_NUMBER_WORDS = {
    'واحد': 1, 'واحده': 1, 'احدي': 1, 'اثنين': 2, 'اثنتين': 2,
    'ثلاث': 3, 'ثلاثه': 3, 'اربع': 4, 'اربعه': 4, 'خمس': 5, 'خمسه': 5,
    'ست': 6, 'سته': 6, 'سبع': 7, 'سبعه': 7,
    'ثمان': 8, 'ثمانيه': 8, 'ثماني': 8, 'تسع': 9, 'تسعه': 9,
    'عشر': 10, 'عشره': 10, 'عشرين': 20, 'ثلاثين': 30, 'اربعين': 40,
    'خمسين': 50, 'ستين': 60, 'سبعين': 70, 'ثمانين': 80, 'تسعين': 90,
    'مائه': 100, 'مئه': 100, 'مايه': 100,
    'مائتين': 200, 'مئتين': 200, 'ثلاثمائه': 300, 'ثلثمائه': 300,
    'اربعمائه': 400, 'خمسمائه': 500, 'ستمائه': 600, 'سبعمائه': 700,
    'ثمانمائه': 800, 'ثمانيمائه': 800, 'تسعمائه': 900, 'الف': 1000,
}
_WORD_ALT = '|'.join(sorted(_NUMBER_WORDS, key=len, reverse=True))

# «سنة/عام ٧٢٨ هـ» (marker optional). هـ normalizes to bare ه (tatweel skipped).
_YEAR_RE = re.compile(
    r'(?:سنه|عام)\s+(\d{1,4})\s*(هجريه|ميلاديه|ه|م)?(?![\w])')
# Death markers: «(ت 728 هـ)», «ت: 728», «توفي/المتوفي سنة 728».
_DEATH_PAREN_RE = re.compile(r'\(\s*ت\s*[:.]?\s*(\d{1,4})\s*(ه|م)?\s*\)')
_DEATH_WORD_RE = re.compile(
    r'(?:توفي|المتوفي|مات)\s+(?:سنه|عام)?\s*(\d{1,4})\s*(هجريه|ميلاديه|ه|م)?(?![\w])')
# Era-marked ranges: «712-728 هـ» (marker REQUIRED to avoid page-ref noise).
_RANGE_RE = re.compile(r'(\d{3,4})\s*[-–—]\s*(\d{3,4})\s*(هجريه|ميلاديه|ه|م)(?![\w])')
# Spelled-out years after سنة/عام.
_SPELLED_RE = re.compile(
    r'(?:سنه|عام)\s+((?:(?:' + _WORD_ALT + r')(?:\s+و?|\s*و\s*|$))+)')


def _calendar(marker: Optional[str], year: int) -> Tuple[str, float]:
    if marker in ('ه', 'هجريه'):
        return 'hijri', 0.9
    if marker in ('م', 'ميلاديه'):
        return 'gregorian', 0.9
    return ('hijri', 0.6) if year <= _MAX_HIJRI else ('gregorian', 0.6)


def _key(calendar: str, year: int, year_end: Optional[int] = None) -> str:
    prefix = 'hijri' if calendar == 'hijri' else 'greg'
    if year_end and year_end != year:
        return f'{prefix}:{year}-{year_end}'
    return f'{prefix}:{year}'


def _parse_spelled(phrase: str) -> Optional[int]:
    total = 0
    seen = False
    for token in re.split(r'\s+|و', phrase):
        token = token.strip()
        if not token:
            continue
        value = _NUMBER_WORDS.get(token)
        if value is None:
            return None
        total += value
        seen = True
    return total if seen and 0 < total <= _MAX_YEAR else None


@register_extractor
class DatesExtractor(BaseExtractor):
    name = 'dates'
    version = '1'
    entity_types = ('date',)

    def extract(self, page_text: str, page_number: int, ctx: DocContext) -> List[MentionSpan]:
        mentions: List[MentionSpan] = []
        shadow, index_map = normalize_with_map(page_text)
        taken: List[Tuple[int, int]] = []

        def overlaps(sh_start: int, sh_end: int) -> bool:
            return any(s < sh_end and sh_start < e for s, e in taken)

        def emit(sh_start, sh_end, year, marker, *, year_end=None, death=False,
                 confidence=None):
            if overlaps(sh_start, sh_end) or not (0 < year <= _MAX_YEAR):
                return
            calendar, conf = _calendar(marker, year)
            taken.append((sh_start, sh_end))
            start, end = shadow_span_to_original(index_map, sh_start, sh_end)
            payload = {'calendar': calendar, 'year': year}
            if year_end and year_end != year:
                payload['year_end'] = year_end
            if death:
                payload['death'] = True
            mentions.append(MentionSpan(
                entity_type='date',
                char_start=start,
                char_end=end,
                surface_text=page_text[start:end],
                normalized_text=_key(calendar, year, year_end),
                normalized=payload,
                confidence=confidence if confidence is not None else conf,
                needs_review=conf < 0.7 if confidence is None else False,
            ))

        for m in _DEATH_PAREN_RE.finditer(shadow):
            emit(m.start(), m.end(), int(m.group(1)), m.group(2), death=True)
        for m in _DEATH_WORD_RE.finditer(shadow):
            emit(m.start(), m.end(), int(m.group(1)), m.group(2), death=True)
        for m in _RANGE_RE.finditer(shadow):
            emit(m.start(), m.end(), int(m.group(1)), m.group(3),
                 year_end=int(m.group(2)))
        for m in _YEAR_RE.finditer(shadow):
            emit(m.start(), m.end(), int(m.group(1)), m.group(2))
        for m in _SPELLED_RE.finditer(shadow):
            year = _parse_spelled(m.group(1))
            if year is not None and year >= 3:
                # Trim trailing whitespace/و from the span.
                sh_end = m.start(1) + len(m.group(1).rstrip(' و'))
                emit(m.start(), sh_end, year, None, confidence=0.7)

        return mentions
