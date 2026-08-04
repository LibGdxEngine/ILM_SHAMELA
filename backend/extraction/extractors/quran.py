"""Quranic citation extractor.

Two signals:
1. Bracketed citations — ``[البقرة: ٢٥٥]`` / ``(سورة البقرة، الآية ٢٥٥)`` /
   aya ranges — matched against the 114-sura gazetteer on the normalized
   shadow string; normalized to ``quran:<sura>:<aya>[-<aya>]``.
2. ``﴿…﴾``-delimited verse spans; adopting the sura/aya of an immediately
   following citation when present, else flagged ``needs_review`` with the
   grouping key ``quran:unknown`` (verse-text matching against a Quran corpus
   is a later layer).

Sura names are matched ONLY inside citation brackets — never in free prose —
so single-letter sura names (ص، ق، طه، يس) don't false-positive.
"""
import re
from typing import Dict, List

from .base import BaseExtractor, DocContext, MentionSpan, register_extractor
from .textnorm import normalize, normalize_with_map, shadow_span_to_original

# number → canonical name (used for payloads); variants map below.
SURA_NAMES: Dict[int, str] = {
    1: 'الفاتحة', 2: 'البقرة', 3: 'آل عمران', 4: 'النساء', 5: 'المائدة',
    6: 'الأنعام', 7: 'الأعراف', 8: 'الأنفال', 9: 'التوبة', 10: 'يونس',
    11: 'هود', 12: 'يوسف', 13: 'الرعد', 14: 'إبراهيم', 15: 'الحجر',
    16: 'النحل', 17: 'الإسراء', 18: 'الكهف', 19: 'مريم', 20: 'طه',
    21: 'الأنبياء', 22: 'الحج', 23: 'المؤمنون', 24: 'النور', 25: 'الفرقان',
    26: 'الشعراء', 27: 'النمل', 28: 'القصص', 29: 'العنكبوت', 30: 'الروم',
    31: 'لقمان', 32: 'السجدة', 33: 'الأحزاب', 34: 'سبأ', 35: 'فاطر',
    36: 'يس', 37: 'الصافات', 38: 'ص', 39: 'الزمر', 40: 'غافر',
    41: 'فصلت', 42: 'الشورى', 43: 'الزخرف', 44: 'الدخان', 45: 'الجاثية',
    46: 'الأحقاف', 47: 'محمد', 48: 'الفتح', 49: 'الحجرات', 50: 'ق',
    51: 'الذاريات', 52: 'الطور', 53: 'النجم', 54: 'القمر', 55: 'الرحمن',
    56: 'الواقعة', 57: 'الحديد', 58: 'المجادلة', 59: 'الحشر', 60: 'الممتحنة',
    61: 'الصف', 62: 'الجمعة', 63: 'المنافقون', 64: 'التغابن', 65: 'الطلاق',
    66: 'التحريم', 67: 'الملك', 68: 'القلم', 69: 'الحاقة', 70: 'المعارج',
    71: 'نوح', 72: 'الجن', 73: 'المزمل', 74: 'المدثر', 75: 'القيامة',
    76: 'الإنسان', 77: 'المرسلات', 78: 'النبأ', 79: 'النازعات', 80: 'عبس',
    81: 'التكوير', 82: 'الانفطار', 83: 'المطففين', 84: 'الانشقاق', 85: 'البروج',
    86: 'الطارق', 87: 'الأعلى', 88: 'الغاشية', 89: 'الفجر', 90: 'البلد',
    91: 'الشمس', 92: 'الليل', 93: 'الضحى', 94: 'الشرح', 95: 'التين',
    96: 'العلق', 97: 'القدر', 98: 'البينة', 99: 'الزلزلة', 100: 'العاديات',
    101: 'القارعة', 102: 'التكاثر', 103: 'العصر', 104: 'الهمزة', 105: 'الفيل',
    106: 'قريش', 107: 'الماعون', 108: 'الكوثر', 109: 'الكافرون', 110: 'النصر',
    111: 'المسد', 112: 'الإخلاص', 113: 'الفلق', 114: 'الناس',
}

_EXTRA_VARIANTS: Dict[str, int] = {
    'بني إسرائيل': 17, 'براءة': 9, 'المؤمن': 40, 'حم السجدة': 41,
    'الدهر': 76, 'الانشراح': 94, 'ألم نشرح': 94, 'اللهب': 111, 'القتال': 47,
    'الإنشقاق': 84, 'الإنفطار': 82,
}

# normalized surface → sura number
SURA_LOOKUP: Dict[str, int] = {}
for _n, _name in SURA_NAMES.items():
    SURA_LOOKUP[normalize(_name)] = _n
for _name, _n in _EXTRA_VARIANTS.items():
    SURA_LOOKUP[normalize(_name)] = _n

# Longest-first alternation so 'آل عمران' beats 'عمران'-style prefixes.
_SURA_ALT = '|'.join(
    re.escape(name) for name in sorted(SURA_LOOKUP, key=len, reverse=True))

# Bracketed citation on the SHADOW string. Examples it covers (post-normalize):
#   [البقره: 255]  (سوره البقره، الايه 255)  [البقره 255-257]  (البقره/255)
_CITATION_RE = re.compile(
    r'[\[\(]\s*'
    r'(?:سوره\s+)?(' + _SURA_ALT + r')\s*'
    r'[:،,/\s]\s*'
    r'(?:الايه\s+|ايه\s+)?'
    r'(\d{1,3})'
    r'(?:\s*[-–—]\s*(\d{1,3}))?'
    r'\s*[\]\)]'
)

# Verse brackets on the ORIGINAL string (ornate parens aren't folded away).
_VERSE_RE = re.compile(r'﴿([^﴾]{1,600})﴾')

# How far after a ﴿…﴾ span a citation may sit to be adopted (original chars).
_ADJACENCY = 60


def _key(sura: int, aya_start: int, aya_end: int) -> str:
    if aya_end and aya_end != aya_start:
        return f'quran:{sura}:{aya_start}-{aya_end}'
    return f'quran:{sura}:{aya_start}'


@register_extractor
class QuranExtractor(BaseExtractor):
    name = 'quran'
    version = '1'
    entity_types = ('quran',)

    def extract(self, page_text: str, page_number: int, ctx: DocContext) -> List[MentionSpan]:
        mentions: List[MentionSpan] = []
        shadow, index_map = normalize_with_map(page_text)

        citations = []  # (orig_start, orig_end, sura, aya_start, aya_end)
        for m in _CITATION_RE.finditer(shadow):
            sura = SURA_LOOKUP.get(m.group(1))
            if sura is None:
                continue
            aya_start = int(m.group(2))
            aya_end = int(m.group(3)) if m.group(3) else aya_start
            if not (1 <= aya_start <= 286) or not (aya_start <= aya_end <= 286):
                continue
            start, end = shadow_span_to_original(index_map, m.start(), m.end())
            citations.append((start, end, sura, aya_start, aya_end))
            mentions.append(MentionSpan(
                entity_type='quran',
                char_start=start,
                char_end=end,
                surface_text=page_text[start:end],
                normalized_text=_key(sura, aya_start, aya_end),
                normalized={
                    'sura': sura, 'sura_name': SURA_NAMES[sura],
                    'aya_start': aya_start, 'aya_end': aya_end,
                    'kind': 'citation',
                },
                confidence=0.95,
            ))

        for m in _VERSE_RE.finditer(page_text):
            start, end = m.start(), m.end()
            adopted = next(
                (c for c in citations if start < c[0] <= end + _ADJACENCY),
                None,
            )
            if adopted:
                _cs, _ce, sura, aya_start, aya_end = adopted
                mentions.append(MentionSpan(
                    entity_type='quran',
                    char_start=start,
                    char_end=end,
                    normalized_text=_key(sura, aya_start, aya_end),
                    surface_text=page_text[start:end],
                    normalized={
                        'sura': sura, 'sura_name': SURA_NAMES[sura],
                        'aya_start': aya_start, 'aya_end': aya_end,
                        'kind': 'verse',
                    },
                    confidence=0.9,
                ))
            else:
                mentions.append(MentionSpan(
                    entity_type='quran',
                    char_start=start,
                    char_end=end,
                    surface_text=page_text[start:end],
                    normalized_text='quran:unknown',
                    normalized={'kind': 'verse'},
                    confidence=0.5,
                    needs_review=True,
                ))

        return mentions
