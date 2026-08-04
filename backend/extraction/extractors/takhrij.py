"""Hadith takhrij extractor — ``رواه البخاري``, ``أخرجه مسلم (رقم ١٢٣)``,
``متفق عليه``, chained ``رواه البخاري ومسلم`` (one mention per collection).

Pure pattern table + collection gazetteer on the normalized shadow string.
The ~15 canonical collections are a code-level enum (closed space — a
canonical DB table would add a join with no resolution value).
"""
import re
from typing import Dict, List

from .base import BaseExtractor, DocContext, MentionSpan, register_extractor
from .textnorm import normalize, normalize_with_map, shadow_span_to_original

# canonical slug → display name (Arabic)
COLLECTIONS: Dict[str, str] = {
    'bukhari': 'صحيح البخاري',
    'muslim': 'صحيح مسلم',
    'abudawud': 'سنن أبي داود',
    'tirmidhi': 'سنن الترمذي',
    'nasai': 'سنن النسائي',
    'ibnmajah': 'سنن ابن ماجه',
    'ahmad': 'مسند أحمد',
    'malik': 'موطأ مالك',
    'darimi': 'سنن الدارمي',
    'ibnhibban': 'صحيح ابن حبان',
    'hakim': 'المستدرك للحاكم',
    'bayhaqi': 'السنن الكبرى للبيهقي',
    'tabarani': 'المعجم للطبراني',
    'daraqutni': 'سنن الدارقطني',
    'ibnkhuzayma': 'صحيح ابن خزيمة',
    'muttafaq': 'متفق عليه',
}

# surface variants (pre-normalization) → slug
_VARIANTS: Dict[str, str] = {
    'البخاري': 'bukhari',
    'مسلم': 'muslim',
    'أبو داود': 'abudawud', 'أبي داود': 'abudawud', 'ابو داود': 'abudawud',
    'الترمذي': 'tirmidhi',
    'النسائي': 'nasai',
    'ابن ماجه': 'ibnmajah', 'ابن ماجة': 'ibnmajah',
    'أحمد': 'ahmad',
    'مالك': 'malik', 'الموطأ': 'malik',
    'الدارمي': 'darimi',
    'ابن حبان': 'ibnhibban',
    'الحاكم': 'hakim', 'المستدرك': 'hakim',
    'البيهقي': 'bayhaqi',
    'الطبراني': 'tabarani',
    'الدارقطني': 'daraqutni',
    'ابن خزيمة': 'ibnkhuzayma',
    'الشيخان': 'muttafaq',
}

_LOOKUP: Dict[str, str] = {normalize(k): v for k, v in _VARIANTS.items()}
_COLL_ALT = '|'.join(
    re.escape(name) for name in sorted(_LOOKUP, key=len, reverse=True))

_VERB = r'(?:رواه|اخرجه|خرجه|صححه|حسنه|عزاه الي|اورده)'
_TAKHRIJ_RE = re.compile(_VERB + r'\s+(' + _COLL_ALT + r')')
# Chain continuation right after a matched collection: «ومسلم», «و مسلم», «والترمذي».
_CHAIN_RE = re.compile(r'\s*[,،]?\s*و\s*(' + _COLL_ALT + r')')
# Optional hadith number shortly after: «(رقم 123)», «برقم 123», «ح 123».
_NUMBER_RE = re.compile(r'\s*\(?\s*(?:رقم|برقم|ح)\s*[:.]?\s*(\d{1,6})\s*\)?')
_MUTTAFAQ_RE = re.compile(r'متفق\s+عليه')


@register_extractor
class TakhrijExtractor(BaseExtractor):
    name = 'takhrij'
    version = '1'
    entity_types = ('hadith_source',)

    def extract(self, page_text: str, page_number: int, ctx: DocContext) -> List[MentionSpan]:
        mentions: List[MentionSpan] = []
        shadow, index_map = normalize_with_map(page_text)

        def emit(sh_start: int, sh_end: int, slug: str, number=None, confidence=0.9):
            start, end = shadow_span_to_original(index_map, sh_start, sh_end)
            key = f'{slug}:{number}' if number else slug
            payload = {'collection': slug, 'collection_name': COLLECTIONS[slug]}
            if number:
                payload['number'] = number
            mentions.append(MentionSpan(
                entity_type='hadith_source',
                char_start=start,
                char_end=end,
                surface_text=page_text[start:end],
                normalized_text=key,
                normalized=payload,
                confidence=confidence,
            ))

        consumed_muttafaq_spans = []
        for m in _TAKHRIJ_RE.finditer(shadow):
            collections = [(m.start(), m.end(), _LOOKUP[m.group(1)])]
            pos = m.end()
            while True:
                chain = _CHAIN_RE.match(shadow, pos)
                if not chain:
                    break
                collections.append((chain.start(1) - 1, chain.end(1), _LOOKUP[chain.group(1)]))
                pos = chain.end()
            number = None
            if len(collections) == 1:
                num_match = _NUMBER_RE.match(shadow, pos)
                if num_match:
                    number = int(num_match.group(1))
                    collections[0] = (collections[0][0], num_match.end(), collections[0][2])
            for sh_start, sh_end, slug in collections:
                emit(sh_start, sh_end, slug, number if len(collections) == 1 else None)

        for m in _MUTTAFAQ_RE.finditer(shadow):
            if any(s <= m.start() < e for s, e in consumed_muttafaq_spans):
                continue
            emit(m.start(), m.end(), 'muttafaq', confidence=0.95)

        return mentions
