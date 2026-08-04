"""Pure Elasticsearch DSL builders for multi-term corpus / in-book search.

A search is a flat list of term rows — each with its own match kind, fuzziness
and diacritics handling — combined as boolean rows:

    (all musts) AND (should₁ ∨ should₂ ∨ …) AND NOT (any must_not)

This module is deliberately DB-free and framework-free (mirroring
``hijri_dates``): it turns validated ``TermSpec`` rows into ES query dicts and
is unit-tested against exact DSL bodies, like
``tests/test_in_document_query_building.py`` does for the legacy single-term
builder (``views._build_lexical_query`` — untouched; the two coexist so the
legacy GET endpoints stay byte-identical).

Match kinds (per term):
- ``phrase``  exact phrase — order + adjacency (``multi_match type=phrase``)
- ``word``    exact word(s) — all required, no edit tolerance (``fuzziness=0``)
- ``fuzzy``   edit-distance tolerant (per-term ``fuzziness`` 0|1|2|"AUTO")
- ``stem``    root/derivative تقارب لفظي (the stemmed ``.arabic`` subfields)

Diacritics (per term):
- ``ignore``     match regardless of harakat → the ``.exact`` subfields
  (``arabic_exact`` analyzer: normalization, no stemming)
- ``sensitive``  vocalization as typed → the raw ``standard`` fields.
  ``stem`` rows are always ``ignore`` (the ``arabic`` analyzer strips harakat).
"""
from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Tuple

TERM_MATCHES = ('phrase', 'word', 'fuzzy', 'stem')
TERM_OPS = ('must', 'should', 'must_not')
TERM_DIACRITICS = ('ignore', 'sensitive')
FUZZINESS_VALUES = (0, 1, 2, 'AUTO')
MAX_TERMS = 8

# Prefix every named clause carries; ``matched_queries`` entries come back as
# ``term_<i>`` where ``i`` indexes the request's terms array.
TERM_NAME_PREFIX = 'term_'

# ── Corpus field routing ────────────────────────────────────────────────────
# Boosts mirror views.MULTI_MATCH_FIELDS so per-term relevance stays
# comparable with the legacy single-term ranking. ``categories`` is a keyword
# field: it participates in word/fuzzy token matching but is meaningless for
# phrase matching, and it has no ``.exact``/``.arabic`` subfields.
CORPUS_FIELDS_RAW = [
    'title^2', 'authors^1.5', 'categories^1.5',
    'description^1.2', 'alternate_names^1.3', 'content',
]
CORPUS_FIELDS_RAW_PHRASE = [
    'title^2', 'authors^1.5',
    'description^1.2', 'alternate_names^1.3', 'content',
]
CORPUS_FIELDS_EXACT = [
    'title.exact^2', 'authors.exact^1.5', 'categories^1.5',
    'description.exact^1.2', 'alternate_names.exact^1.3', 'content.exact',
]
CORPUS_FIELDS_EXACT_PHRASE = [
    'title.exact^2', 'authors.exact^1.5',
    'description.exact^1.2', 'alternate_names.exact^1.3', 'content.exact',
]
CORPUS_FIELDS_STEM = [
    'title.arabic^2', 'authors.arabic^1.5',
    'description.arabic^1.2', 'alternate_names.arabic^1.3', 'content.arabic',
]

# Every field the corpus highlighter should consider. Subfields highlight
# independently in ES; ``normalize_highlight`` folds them back onto their base
# field name so response consumers keep seeing ``title``/``content``/….
CORPUS_HIGHLIGHT_FIELDS = [
    'title', 'title.exact', 'title.arabic',
    'description', 'description.exact', 'description.arabic',
    'content', 'content.exact', 'content.arabic',
    'alternate_names', 'alternate_names.exact', 'alternate_names.arabic',
]


@dataclass(frozen=True)
class TermSpec:
    """One validated query row. ``fuzziness`` is only meaningful for
    ``match='fuzzy'``; ``diacritics`` is forced to ``ignore`` for ``stem``."""
    text: str
    match: str = 'word'
    fuzziness: object = 'AUTO'
    diacritics: str = 'ignore'
    op: str = 'must'


def term_name(index: int) -> str:
    return f'{TERM_NAME_PREFIX}{index}'


def parse_term_name(name: str) -> Optional[int]:
    """``term_3`` → 3; anything else → None."""
    if not name.startswith(TERM_NAME_PREFIX):
        return None
    suffix = name[len(TERM_NAME_PREFIX):]
    return int(suffix) if suffix.isdigit() else None


def _corpus_fields(term: TermSpec) -> List[str]:
    if term.match == 'stem':
        return CORPUS_FIELDS_STEM
    if term.diacritics == 'sensitive':
        return CORPUS_FIELDS_RAW_PHRASE if term.match == 'phrase' else CORPUS_FIELDS_RAW
    return CORPUS_FIELDS_EXACT_PHRASE if term.match == 'phrase' else CORPUS_FIELDS_EXACT


def build_corpus_term_clause(term: TermSpec, name: Optional[str] = None) -> Dict:
    """One term row → one ``multi_match`` clause over the routed field set."""
    inner: Dict = {'query': term.text, 'fields': _corpus_fields(term)}
    if term.match == 'phrase':
        inner['type'] = 'phrase'
    else:
        inner['type'] = 'best_fields'
        inner['operator'] = 'and'
        if term.match == 'word':
            inner['fuzziness'] = 0
        elif term.match == 'fuzzy':
            inner['fuzziness'] = term.fuzziness
        # stem: no fuzziness — the analyzer does the widening.
    if name is not None:
        inner['_name'] = name
    return {'multi_match': inner}


def split_terms(terms: Sequence[TermSpec]) -> Tuple[List[Tuple[int, TermSpec]],
                                                    List[Tuple[int, TermSpec]],
                                                    List[Tuple[int, TermSpec]]]:
    """(musts, shoulds, must_nots), each as (original_index, term)."""
    musts, shoulds, must_nots = [], [], []
    for i, term in enumerate(terms):
        bucket = musts if term.op == 'must' else shoulds if term.op == 'should' else must_nots
        bucket.append((i, term))
    return musts, shoulds, must_nots


def build_corpus_bool_query(
    terms: Sequence[TermSpec],
    filter_clauses: Optional[List[Dict]] = None,
) -> Dict:
    """The full corpus ``bool`` query for a term-row list.

    Positive clauses are named ``term_<i>`` (``i`` = index in the request's
    terms array) so ``matched_queries`` attributes hits per term; ``must_not``
    clauses stay unnamed (they can never appear on a returned hit).
    ``minimum_should_match`` is emitted only when should rows exist, keeping
    "(all musts) AND (≥1 should) AND NOT(nots)" deterministic.
    """
    musts, shoulds, must_nots = split_terms(terms)
    bool_body: Dict = {}
    if musts:
        bool_body['must'] = [build_corpus_term_clause(t, term_name(i)) for i, t in musts]
    if shoulds:
        bool_body['should'] = [build_corpus_term_clause(t, term_name(i)) for i, t in shoulds]
        bool_body['minimum_should_match'] = 1
    if must_nots:
        bool_body['must_not'] = [build_corpus_term_clause(t) for _, t in must_nots]
    if filter_clauses:
        bool_body['filter'] = filter_clauses
    return {'bool': bool_body}


def build_positive_gate_clauses(terms: Sequence[TermSpec]) -> Tuple[List[Dict], List[Dict]]:
    """(must_clauses, must_not_clauses), unnamed — for gating the kNN stage.

    The semantic stage ranks by meaning of the composed query text, but يجب /
    بدون are hard promises: a doc lacking a must term (or containing a
    must_not term) must never surface. These clauses go into the kNN
    ``filter`` context (non-scoring).
    """
    musts, _, must_nots = split_terms(terms)
    return (
        [build_corpus_term_clause(t) for _, t in musts],
        [build_corpus_term_clause(t) for _, t in must_nots],
    )


def compose_query_text(terms: Sequence[TermSpec]) -> str:
    """Positive text only (must + should, in request order) — feeds the
    whole-query embedding and analytics. ``must_not`` text is excluded so the
    semantic vector isn't pulled toward what the user wants filtered out."""
    return ' '.join(t.text for t in terms if t.op != 'must_not').strip()


def normalize_highlight(highlight: Dict[str, List[str]]) -> Dict[str, List[str]]:
    """Fold subfield highlight keys (``title.exact``…) onto their base field,
    preserving order and de-duplicating identical fragments."""
    normalized: Dict[str, List[str]] = {}
    for field, fragments in highlight.items():
        base = field.split('.', 1)[0]
        bucket = normalized.setdefault(base, [])
        for fragment in fragments:
            if fragment not in bucket:
                bucket.append(fragment)
    return normalized


def term_hits_from_matched_queries(matched_queries: Sequence[str]) -> List[int]:
    """ES ``matched_queries`` values → sorted request-array term indexes."""
    hits = {parse_term_name(name) for name in matched_queries}
    return sorted(h for h in hits if h is not None)


def terms_from_legacy_params(query: str) -> List[TermSpec]:
    """The single-input translation: plain ``q`` = one must/fuzzy-AUTO row.

    Note the legacy GET endpoints do NOT route through this — they keep their
    historical single ``multi_match`` body verbatim. This exists for callers
    (agent tools, assist) that want to enter the terms model from a plain
    string.
    """
    return [TermSpec(text=query.strip(), match='fuzzy', fuzziness='AUTO')]


# ── In-book (single document) per-term queries ─────────────────────────────
# Content-only routing; returns (query_dict, highlight_fields) like the legacy
# ``views._build_lexical_query`` contract. ``match_kind`` labels the fragment
# for the reader's kind tabs: phrase→'exact', word/fuzzy/stem→'lexical'.

def build_inbook_term_query(term: TermSpec) -> Tuple[Dict, List[str]]:
    if term.match == 'stem':
        return (
            {'match': {'content.arabic': {'query': term.text, 'operator': 'and'}}},
            ['content.arabic'],
        )
    field = 'content' if term.diacritics == 'sensitive' else 'content.exact'
    if term.match == 'phrase':
        return {'match_phrase': {field: {'query': term.text}}}, [field]
    fuzziness = 0 if term.match == 'word' else term.fuzziness
    return (
        {'match': {field: {'query': term.text, 'operator': 'and', 'fuzziness': fuzziness}}},
        [field],
    )


def inbook_match_kind(term: TermSpec) -> str:
    """Reader ``match_kind`` bucket for fragments produced by this term."""
    return 'exact' if term.match == 'phrase' else 'lexical'


# ── Facet registry ──────────────────────────────────────────────────────────
# The composition point for downstream workstreams (entity extraction): a
# registered facet becomes addressable from the POST body's
# ``filters.facets[key]`` without touching the executor.

@dataclass(frozen=True)
class FacetDef:
    """``es_field`` receives a ``terms`` clause with the raw value list.
    ``django_lookup`` (e.g. ``'extracted_meta__genre__in'``) mirrors it on the
    hydration queryset; ``None`` = ES-only."""
    es_field: str
    django_lookup: Optional[str] = None
    # 'terms' today; future kinds ('range', 'nested') extend here.
    kind: str = 'terms'


FACET_REGISTRY: Dict[str, FacetDef] = {}


def register_facet(key: str, facet_def: FacetDef) -> None:
    FACET_REGISTRY[key] = facet_def


def build_facet_clauses(facets: Dict[str, List]) -> Tuple[List[Dict], List[str]]:
    """(es_filter_clauses, unknown_keys) for a POST ``filters.facets`` map.
    Unknown keys are returned for the caller to 400 on — these are
    programmatic, so failing loud beats silently widening the search."""
    clauses: List[Dict] = []
    unknown: List[str] = []
    for key, values in facets.items():
        facet = FACET_REGISTRY.get(key)
        if facet is None:
            unknown.append(key)
            continue
        cleaned = [v for v in values if v not in (None, '')]
        if cleaned:
            clauses.append({'terms': {facet.es_field: cleaned}})
    return clauses, unknown
