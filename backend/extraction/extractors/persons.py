"""Person (أعلام) extractor — regex + gazetteer only, no LLM.

High-precision anchors, in priority order:
1. **Author gazetteer** — Person rows seeded from ``search_engine.Author``
   (``seed_persons`` command): exact normalized surface match, linked
   canonically. Confidence 0.9.
2. **Death-marker names** — a name window immediately followed by
   ``(ت ٧٢٨هـ)`` / ``المتوفى سنة``: the strongest disambiguation signal in
   Arabic biographical text. Confidence 0.85, name parts decomposed.
3. **Honorific-bounded names** — a name window followed by رضي الله عنه /
   رحمه الله / عليه السلام: the honorific also classifies status (sahabi…).
   Confidence 0.75.
4. **Title + name** — الإمام/الشيخ/الحافظ/القاضي/العلامة + name window.
   Confidence 0.7, pending review.

Everything ambiguous stays a pending mention with a blocking key — canonical
``Person`` rows are only created by the seed command (Author import) or by a
human in the admin; a future linking layer promotes pending mentions. This
keeps precision failures cheap (review time) instead of corrupting facets.

Like ``places``, this extractor lazily caches DB state (the seeded-person
surface map); ``reload_persons()`` resets it.
"""
import re
from typing import Dict, List, Optional, Tuple

from .base import BaseExtractor, DocContext, MentionSpan, register_extractor
from .textnorm import normalize, normalize_with_map, shadow_span_to_original

# ── Name-window grammar (on the shadow string) ──────────────────────────────
# A name token: an Arabic word, optionally ال-prefixed. Windows chain with
# بن/ابن and kunya أبو/أم particles. Kept deliberately tight (≤6 tokens).
_TOKEN = r'[ء-ي]{2,}'
_NAME_WINDOW = (
    r'(?:(?:ابو|ابي|ام)\s+)?'          # kunya particle
    + _TOKEN +
    r'(?:\s+(?:بن|ابن)\s+' + _TOKEN + r'){0,4}'   # nasab chain
    r'(?:\s+ال' + _TOKEN + r'){0,2}'   # trailing nisba/laqab tokens
)

_HONORIFICS: Dict[str, str] = {
    'صلي الله عليه وسلم': 'prophet',
    'عليه السلام': 'prophet',
    'عليها السلام': 'prophet',
    'رضي الله عنه': 'sahabi',
    'رضي الله عنها': 'sahabi',
    'رضي الله عنهما': 'sahabi',
    'رحمه الله': 'scholar',
    'رحمها الله': 'scholar',
    'رحمهما الله': 'scholar',
}
_HONORIFIC_ALT = '|'.join(re.escape(h) for h in sorted(_HONORIFICS, key=len, reverse=True))

_TITLES = r'(?:الامام|الشيخ|الحافظ|القاضي|العلامه|المحدث|الفقيه)'

_DEATH_RE = re.compile(
    r'(' + _NAME_WINDOW + r')\s*\(\s*(?:ت|المتوفي)\s*[:.]?\s*(\d{1,4})\s*(?:ه|م)?\s*\)')
_HONORIFIC_RE = re.compile(r'(' + _NAME_WINDOW + r')\s+(' + _HONORIFIC_ALT + r')')
_TITLE_RE = re.compile(_TITLES + r'\s+(' + _NAME_WINDOW + r')')

# Person-gazetteer matcher cache (from seeded Person rows).
_PERSON_MATCHER: Optional[Tuple[re.Pattern, Dict[str, int]]] = None
_PERSON_LOADED = False


def reload_persons() -> None:
    global _PERSON_MATCHER, _PERSON_LOADED
    _PERSON_MATCHER = None
    _PERSON_LOADED = False


def _person_matcher():
    global _PERSON_MATCHER, _PERSON_LOADED
    if _PERSON_LOADED:
        return _PERSON_MATCHER
    from extraction.models import Person

    lookup: Dict[str, int] = {}
    for person_id, display_name, aliases in Person.objects.exclude(
            review_status='rejected').values_list('id', 'display_name', 'aliases'):
        for surface in [display_name, *(aliases or [])]:
            key = normalize(surface or '')
            # Require ≥2 tokens or ≥6 chars so bare common words never match.
            if key and (len(key) >= 6 or ' ' in key):
                lookup.setdefault(key, person_id)
    if lookup:
        alternation = '|'.join(
            re.escape(s) for s in sorted(lookup, key=len, reverse=True))
        _PERSON_MATCHER = (
            re.compile(r'(?<![\w])(' + alternation + r')(?![\w])'), lookup)
    else:
        _PERSON_MATCHER = None
    _PERSON_LOADED = True
    return _PERSON_MATCHER


def decompose_name(surface_norm: str) -> Dict[str, str]:
    """Positional name-part split of a normalized name window."""
    parts: Dict[str, str] = {}
    tokens = surface_norm.split()
    if not tokens:
        return parts
    rest = tokens[:]
    if rest[0] in ('ابو', 'ابي', 'ام') and len(rest) > 1:
        parts['kunya'] = ' '.join(rest[:2])
        rest = rest[2:]
    if rest and rest[0] in ('ابن', 'بن') and len(rest) > 1:
        parts['shuhra'] = ' '.join(rest[:2])
        rest = rest[2:]
    elif len(rest) == 1 and rest[0].startswith('ال') and len(rest[0]) > 4:
        # A kunya followed by a single ال-token is kunya+nisba (أبو حامد
        # الغزالي), not kunya+ism.
        parts['nisba'] = rest[0]
        rest = []
    elif rest:
        parts['ism'] = rest[0]
        rest = rest[1:]
    nasab: List[str] = []
    while len(rest) >= 2 and rest[0] in ('بن', 'ابن'):
        nasab.extend(rest[:2])
        rest = rest[2:]
    if nasab:
        parts['nasab'] = ' '.join(nasab)
    if rest and rest[-1].startswith('ال') and len(rest[-1]) > 4:
        parts['nisba'] = rest[-1]
    return parts


def blocking_key(surface_norm: str) -> str:
    parts = decompose_name(surface_norm)
    return parts.get('shuhra') or parts.get('kunya') or parts.get('ism') or surface_norm


@register_extractor
class PersonsExtractor(BaseExtractor):
    name = 'persons'
    version = '1'
    entity_types = ('person',)

    def extract(self, page_text: str, page_number: int, ctx: DocContext) -> List[MentionSpan]:
        mentions: List[MentionSpan] = []
        shadow, index_map = normalize_with_map(page_text)
        taken: List[Tuple[int, int]] = []

        def overlaps(sh_start: int, sh_end: int) -> bool:
            return any(s < sh_end and sh_start < e for s, e in taken)

        def emit(sh_start: int, sh_end: int, surface_norm: str, *, confidence: float,
                 needs_review: bool, payload: Dict, hint: Optional[Dict] = None):
            if overlaps(sh_start, sh_end):
                return
            taken.append((sh_start, sh_end))
            start, end = shadow_span_to_original(index_map, sh_start, sh_end)
            key = blocking_key(surface_norm)
            mentions.append(MentionSpan(
                entity_type='person',
                char_start=start,
                char_end=end,
                surface_text=page_text[start:end],
                normalized_text=key,
                normalized={**decompose_name(surface_norm), **payload},
                confidence=confidence,
                needs_review=needs_review,
                canonical_hint=hint or {'person_blocking_key': key},
            ))

        # 1. Seeded-person gazetteer (canonical link).
        matcher = _person_matcher()
        if matcher is not None:
            pattern, lookup = matcher
            for m in pattern.finditer(shadow):
                emit(m.start(1), m.end(1), m.group(1),
                     confidence=0.9, needs_review=False,
                     payload={'anchor': 'gazetteer'},
                     hint={'person_id': lookup[m.group(1)]})

        # 2. Death-marker-anchored names.
        for m in _DEATH_RE.finditer(shadow):
            emit(m.start(1), m.end(1), m.group(1),
                 confidence=0.85, needs_review=False,
                 payload={'anchor': 'death_marker', 'death_year': int(m.group(2))})

        # 3. Honorific-bounded names.
        for m in _HONORIFIC_RE.finditer(shadow):
            honorific = _HONORIFICS.get(m.group(2), '')
            emit(m.start(1), m.end(1), m.group(1),
                 confidence=0.75, needs_review=True,
                 payload={'anchor': 'honorific', 'honorific_class': honorific})

        # 4. Title-prefixed names.
        for m in _TITLE_RE.finditer(shadow):
            emit(m.start(1), m.end(1), m.group(1),
                 confidence=0.7, needs_review=True,
                 payload={'anchor': 'title'})

        return mentions
