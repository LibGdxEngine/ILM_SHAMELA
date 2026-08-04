"""Extractor interface + registry.

Extractors are pure modules (no model imports — mirroring
``search_engine.hijri_dates``): page text in, ``MentionSpan`` list out, with
offsets into the ORIGINAL page string. The task layer persists spans, resolves
canonical hints, and handles versioning/supersession.

Version bump policy: any pattern/gazetteer-logic change that alters output
bumps the extractor's ``version`` string; the run machinery re-extracts and
supersedes the old version's rows.
"""
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple, Type


@dataclass(frozen=True)
class DocContext:
    """Read-only document-level hints so extractors stay pure/testable."""
    title: str = ''
    language: str = ''
    author_death_centuries: Tuple[int, ...] = ()


@dataclass(frozen=True)
class MentionSpan:
    entity_type: str           # EntityMention.EntityType value
    char_start: int            # offsets into the ORIGINAL page content string
    char_end: int
    surface_text: str
    normalized_text: str       # grouping key ('quran:2:255', 'bukhari:52', 'hijri:728'…)
    normalized: Dict = field(default_factory=dict)
    confidence: float = 1.0
    needs_review: bool = False
    # e.g. {'place_id': 17} or {'person_blocking_key': '...'} — resolved to FKs
    # by the task layer.
    canonical_hint: Optional[Dict] = None


class BaseExtractor:
    name: str = ''
    version: str = '1'
    entity_types: Tuple[str, ...] = ()

    def extract(self, page_text: str, page_number: int, ctx: DocContext) -> List[MentionSpan]:
        raise NotImplementedError


EXTRACTOR_REGISTRY: Dict[str, Type[BaseExtractor]] = {}


def register_extractor(cls: Type[BaseExtractor]) -> Type[BaseExtractor]:
    if not cls.name:
        raise ValueError('extractor needs a name')
    EXTRACTOR_REGISTRY[cls.name] = cls
    return cls
