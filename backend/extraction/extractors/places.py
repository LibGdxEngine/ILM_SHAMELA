"""Toponym extractor over the DB-backed gazetteer (``PlaceName``).

Matching runs on the normalized shadow string with a compiled longest-first
alternation over all gazetteer surface forms, word-boundary checked. At the
current curated-seed scale (a few hundred surfaces) a single compiled regex is
fast; when a full GeoNames/al-Thurayya import lands (tens of thousands of
surfaces), swap ``_build_matcher`` for a ``pyahocorasick`` automaton — the
interface is already shaped for it.

Nisba handling: ``النيسابوري``-form surfaces match only via gazetteer rows of
``kind='nisba'`` at confidence 0.6 + pending review (a nisba may be
inherited, not biographical); anything in ``data/nisba_stoplist.txt``
(madhhab/tribal/occupational) is suppressed entirely.

This extractor needs the gazetteer tables, so unlike the pure pattern
extractors it lazily loads (and caches) DB state; ``reload_gazetteer()``
resets the cache (tests, post-import refresh).
"""
import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from .base import BaseExtractor, DocContext, MentionSpan, register_extractor
from .textnorm import normalize, normalize_with_map, shadow_span_to_original

_STOPLIST_PATH = Path(__file__).resolve().parents[1] / 'data' / 'nisba_stoplist.txt'

# surface(normalized) → (place_id, kind); compiled regex; None until loaded.
_MATCHER: Optional[Tuple[re.Pattern, Dict[str, Tuple[int, str]]]] = None
_STOPLIST: Optional[set] = None


def _load_stoplist() -> set:
    global _STOPLIST
    if _STOPLIST is None:
        entries = set()
        if _STOPLIST_PATH.exists():
            for line in _STOPLIST_PATH.read_text(encoding='utf-8').splitlines():
                line = line.strip()
                if line and not line.startswith('#'):
                    entries.add(normalize(line))
        _STOPLIST = entries
    return _STOPLIST


def _build_matcher() -> Optional[Tuple[re.Pattern, Dict[str, Tuple[int, str]]]]:
    from extraction.models import PlaceName

    stoplist = _load_stoplist()
    lookup: Dict[str, Tuple[int, str]] = {}
    for normalized, place_id, kind in PlaceName.objects.values_list(
            'normalized', 'place_id', 'kind'):
        if not normalized or normalized in stoplist:
            continue
        # First writer wins on duplicate surfaces across places (rare in the
        # curated seed; the admin merge action is the cleanup tool).
        lookup.setdefault(normalized, (place_id, kind))
    if not lookup:
        return None
    alternation = '|'.join(
        re.escape(s) for s in sorted(lookup, key=len, reverse=True))
    pattern = re.compile(r'(?<![\w])(' + alternation + r')(?![\w])')
    return pattern, lookup


def reload_gazetteer() -> None:
    """Drop the cached matcher (call after load_gazetteer or in tests)."""
    global _MATCHER
    _MATCHER = None


def _matcher():
    global _MATCHER
    if _MATCHER is None:
        _MATCHER = _build_matcher() or (None, {})
    return _MATCHER


@register_extractor
class PlacesExtractor(BaseExtractor):
    name = 'places'
    version = '1'
    entity_types = ('place',)

    def extract(self, page_text: str, page_number: int, ctx: DocContext) -> List[MentionSpan]:
        pattern, lookup = _matcher()
        if pattern is None:
            return []
        mentions: List[MentionSpan] = []
        shadow, index_map = normalize_with_map(page_text)
        for m in pattern.finditer(shadow):
            surface_norm = m.group(1)
            place_id, kind = lookup[surface_norm]
            start, end = shadow_span_to_original(index_map, m.start(1), m.end(1))
            is_nisba = kind == 'nisba'
            mentions.append(MentionSpan(
                entity_type='place',
                char_start=start,
                char_end=end,
                surface_text=page_text[start:end],
                normalized_text=surface_norm,
                normalized={'kind': kind},
                confidence=0.6 if is_nisba else 0.85,
                needs_review=is_nisba,
                canonical_hint={'place_id': place_id},
            ))
        return mentions
