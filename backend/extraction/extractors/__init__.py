"""Extractor package — importing it populates ``EXTRACTOR_REGISTRY``."""
from .base import (  # noqa: F401
    EXTRACTOR_REGISTRY,
    BaseExtractor,
    DocContext,
    MentionSpan,
    register_extractor,
)
from . import quran  # noqa: F401
from . import takhrij  # noqa: F401
from . import dates  # noqa: F401

# persons/places register here when their phase lands (they need the gazetteer
# tables loaded, so they live behind the same registry without special-casing).
try:  # pragma: no cover
    from . import persons  # noqa: F401
    from . import places  # noqa: F401
except ImportError:
    pass
