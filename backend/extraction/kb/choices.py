"""Django ``choices`` lists derived from the pydantic enums in ``kb.schema``.

Mirrors the value-tuple pattern already used in ``kb.extract``
(``RELATION_TYPE_VALUES`` etc.): ``schema.py`` is the single source of truth for
the vocabulary and the ORM follows it instead of duplicating 14 enums by hand.

Safe against migration churn: since Django 4.1 ``choices`` is in
``Field.non_db_attrs``, so editing an enum emits an ``AlterField`` that produces
no SQL. ``choices`` are validation-only and ``bulk_create`` never calls
``full_clean``, so a forgotten ``makemigrations`` cannot corrupt data either.

Column ``max_length`` is deliberately NEVER derived — a derived length would
emit real DDL on every enum edit. The values below are hardcoded with headroom
and guarded by ``extraction.tests.test_kb_persist.ChoiceVocabularyTests``, which
fails if any enum value outgrows its column.
"""
from . import schema
from .extract import MENTION_LABELS


def _choices(enum_cls) -> list[tuple[str, str]]:
    return [(m.value, m.name.replace('_', ' ').title()) for m in enum_cls]


def _merge(*lists) -> list[tuple[str, str]]:
    """Union preserving first-seen order. Values shared across vocabularies
    (``other``/``unknown``) collapse to a single entry."""
    seen: set[str] = set()
    out: list[tuple[str, str]] = []
    for lst in lists:
        for value, label in lst:
            if value not in seen:
                seen.add(value)
                out.append((value, label))
    return out


# --- mention layer -----------------------------------------------------------
MENTION_LABEL_CHOICES = [(v, v.replace('_', ' ').title()) for v in MENTION_LABELS]
MENTION_LABEL_MAX = 16

# One column carries three vocabularies; which one applies is keyed off `label`
# (work -> WorkSubtype, organization -> OrganizationSubtype, sect -> SectKind).
MENTION_SUBTYPE_CHOICES = _merge(_choices(schema.WorkSubtype),
                                 _choices(schema.OrganizationSubtype),
                                 _choices(schema.SectKind))
MENTION_SUBTYPE_MAX = 20

QUOTATION_TYPE_CHOICES = _choices(schema.QuotationType)
QUOTATION_TYPE_MAX = 20

MATCH_METHOD_CHOICES = _choices(schema.MatchMethod)
MATCH_METHOD_MAX = 12

TIME_KIND_CHOICES = [('absolute', 'Absolute'), ('range', 'Range'),
                     ('relative', 'Relative')]
TIME_KIND_MAX = 10

# --- provenance --------------------------------------------------------------
EXTRACTION_METHOD_CHOICES = _choices(schema.ExtractionMethod)
EXTRACTION_METHOD_MAX = 12

TEXT_STREAM_CHOICES = _choices(schema.TextStream)
TEXT_STREAM_MAX = 16

SEGMENT_TYPE_CHOICES = _choices(schema.SegmentType)
SEGMENT_TYPE_MAX = 20

# --- entity resolution landing slots ----------------------------------------
LINKING_STATUS_CHOICES = _choices(schema.LinkingStatus)
LINKING_STATUS_MAX = 12

# --- assertions --------------------------------------------------------------
RELATION_TYPE_CHOICES = _choices(schema.RelationType)
RELATION_TYPE_MAX = 32

CLAIM_PREDICATE_CHOICES = _choices(schema.ClaimPredicate)
CLAIM_PREDICATE_MAX = 20

APPRAISAL_POLARITY_CHOICES = _choices(schema.AppraisalPolarity)
APPRAISAL_POLARITY_MAX = 12

APPRAISAL_RANK_CHOICES = _choices(schema.AppraisalRank)
APPRAISAL_RANK_MAX = 32

APPRAISAL_SCOPE_KIND_CHOICES = _choices(schema.AppraisalScopeKind)
APPRAISAL_SCOPE_KIND_MAX = 16

# (model field name, choices, max_length) — the guard test walks this.
VOCABULARIES = (
    ('label', MENTION_LABEL_CHOICES, MENTION_LABEL_MAX),
    ('subtype', MENTION_SUBTYPE_CHOICES, MENTION_SUBTYPE_MAX),
    ('quote_type', QUOTATION_TYPE_CHOICES, QUOTATION_TYPE_MAX),
    ('match_method', MATCH_METHOD_CHOICES, MATCH_METHOD_MAX),
    ('time_kind', TIME_KIND_CHOICES, TIME_KIND_MAX),
    ('extraction_method', EXTRACTION_METHOD_CHOICES, EXTRACTION_METHOD_MAX),
    ('stream', TEXT_STREAM_CHOICES, TEXT_STREAM_MAX),
    ('segment_type', SEGMENT_TYPE_CHOICES, SEGMENT_TYPE_MAX),
    ('linking_status', LINKING_STATUS_CHOICES, LINKING_STATUS_MAX),
    ('relation_type', RELATION_TYPE_CHOICES, RELATION_TYPE_MAX),
    ('predicate', CLAIM_PREDICATE_CHOICES, CLAIM_PREDICATE_MAX),
    ('polarity', APPRAISAL_POLARITY_CHOICES, APPRAISAL_POLARITY_MAX),
    ('rank', APPRAISAL_RANK_CHOICES, APPRAISAL_RANK_MAX),
    ('scope_kind', APPRAISAL_SCOPE_KIND_CHOICES, APPRAISAL_SCOPE_KIND_MAX),
)
