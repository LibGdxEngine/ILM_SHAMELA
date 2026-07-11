"""Document recommender v1 — ranks unseen documents from UserDocumentAffinity.

Layered, best-effort strategy (each layer degrades to the next; never raises):

  A. Personalized — engagement-weighted taste centroid over the user's
     top-affinity docs' ``semantic_vector``s → Elasticsearch kNN, re-ranked with
     a favored-author/category overlap boost (mirrors the 0.60/0.40 blend in
     ``search_engine.views.execute_corpus_search``).
  B. Weak signal — favored authors/categories (pure Django) when the user has
     history but no usable vectors.
  C. Cold start — "Popular in the library": aggregate engagement across all users.
  D. Empty library — newest processed documents.

Returns an ordered ``list[dict]``: ``{document, score, reason, reason_detail}``.
The centroid is normalized because ``search_engine.semantic.cosine_similarity``
(and ES kNN scoring) expect unit vectors. Reuses the same ES ``dense_vector``
kNN path as corpus search — no new ML infra.
"""
import logging

from django.db.models import Q, Sum

from search_engine.documents import DocumentIndex
from search_engine.models import Document
from search_engine.semantic import VECTOR_DIMENSIONS, normalize_vector

from .models import UserDocumentAffinity

logger = logging.getLogger(__name__)

# How many top-affinity docs feed the taste centroid / favored facets.
_CENTROID_SOURCE_LIMIT = 25
# Personalized re-rank blend: semantic similarity vs favored author/category.
_W_SEMANTIC = 0.7
_W_FACET = 0.3


def _rec(document, score, reason, reason_detail=None):
    return {
        'document': document,
        'score': round(float(score), 4),
        'reason': reason,
        'reason_detail': reason_detail,
    }


def build_recommendations(user, limit=12):
    """Return up to ``limit`` recommended documents for ``user`` (see module docstring)."""
    try:
        limit = max(1, min(int(limit or 12), 50))
    except (TypeError, ValueError):
        limit = 12

    try:
        affinities = list(
            UserDocumentAffinity.objects
            .filter(user=user)
            .select_related('document')
            .order_by('-engagement_score')
        )
    except Exception:  # noqa: BLE001 — recommender must never raise into the request
        logger.exception('[recs] affinity load failed')
        affinities = []

    engaged_ids = {a.document_id for a in affinities}

    if affinities:
        recs = _personalized(affinities, engaged_ids, limit)
        if recs:
            return recs
        recs = _by_favored_facets(affinities, engaged_ids, limit)
        if recs:
            return recs

    recs = _popular(engaged_ids, limit)
    if recs:
        return recs
    return _newest(engaged_ids, limit)


# ── Favored facets (authors / categories weighted by engagement) ─────────
def _favored_facets(affinities):
    """Return ``(author_weight, category_weight, author_name)`` maps.

    Weights sum each favored doc's (engagement_score + 1) onto its authors and
    categories, so a book you engaged with heavily pulls its author/category up.
    """
    top = affinities[:_CENTROID_SOURCE_LIMIT]
    weight_by_doc = {a.document_id: max(a.engagement_score, 0.0) + 1.0 for a in top}
    author_w, cat_w, author_name = {}, {}, {}
    docs = (
        Document.objects
        .filter(id__in=list(weight_by_doc.keys()))
        .prefetch_related('authors', 'categories')
    )
    for doc in docs:
        w = weight_by_doc.get(doc.id, 1.0)
        for a in doc.authors.all():
            author_w[a.id] = author_w.get(a.id, 0.0) + w
            author_name[a.id] = a.name
        for c in doc.categories.all():
            cat_w[c.id] = cat_w.get(c.id, 0.0) + w
    return author_w, cat_w, author_name


def _facet_score(doc, author_w, cat_w, author_name):
    """Return ``(facet_score_0_1, best_shared_author_name_or_None)`` for a candidate."""
    raw = 0.0
    best_author, best = None, 0.0
    for a in doc.authors.all():
        aw = author_w.get(a.id, 0.0)
        if aw > 0:
            raw += aw
            if aw > best:
                best, best_author = aw, author_name.get(a.id)
    for c in doc.categories.all():
        raw += cat_w.get(c.id, 0.0)
    # Diminishing-returns squash to keep the boost in ~[0, 1).
    facet_n = raw / (raw + 3.0) if raw > 0 else 0.0
    return facet_n, best_author


# ── A. Personalized: taste centroid → ES kNN → facet re-rank ─────────────
def _centroid(affinities):
    """Engagement-weighted, normalized mean of top-affinity docs' vectors, or None."""
    acc, total_w = None, 0.0
    for a in affinities[:_CENTROID_SOURCE_LIMIT]:
        vec = a.document.semantic_vector or []
        if len(vec) != VECTOR_DIMENSIONS or not any(vec):
            continue
        w = max(a.engagement_score, 0.0) + 1.0
        if acc is None:
            acc = [0.0] * VECTOR_DIMENSIONS
        for i in range(VECTOR_DIMENSIONS):
            acc[i] += vec[i] * w
        total_w += w
    if acc is None or total_w == 0:
        return None
    return normalize_vector([v / total_w for v in acc])


def _personalized(affinities, engaged_ids, limit):
    centroid = _centroid(affinities)
    if centroid is None:
        return []

    try:
        from elasticsearch_dsl.connections import connections
        es = connections.get_connection()
        knn = {
            "field": "semantic_vector",
            "query_vector": centroid,
            "k": min(limit * 4, 100),
            "num_candidates": 200,
        }
        excl = [str(i) for i in engaged_ids]
        if excl:
            knn["filter"] = {"bool": {"must_not": [{"terms": {"_id": excl}}]}}
        raw = es.search(
            index=DocumentIndex._index._name,
            body={"size": limit * 4, "knn": knn, "_source": False},
        )
    except Exception:  # noqa: BLE001 — degrade to the facet/popular fallback
        logger.warning('[recs] kNN request failed; falling back', exc_info=True)
        return []

    sem_scores = {}
    for hit in raw.get("hits", {}).get("hits", []):
        try:
            did = int(hit["_id"])
        except (KeyError, ValueError, TypeError):
            continue
        if did not in engaged_ids:
            sem_scores[did] = float(hit.get("_score") or 0.0)
    if not sem_scores:
        return []

    author_w, cat_w, author_name = _favored_facets(affinities)
    max_sem = max(sem_scores.values()) or 1.0

    scored = []
    docs = (
        Document.objects
        .filter(id__in=list(sem_scores.keys()))
        .prefetch_related('authors', 'categories')
    )
    for doc in docs:
        sem_n = sem_scores.get(doc.id, 0.0) / max_sem
        facet_n, best_author = _facet_score(doc, author_w, cat_w, author_name)
        final = _W_SEMANTIC * sem_n + _W_FACET * facet_n
        if best_author:
            scored.append(_rec(doc, final, 'more_by_author', best_author))
        else:
            scored.append(_rec(doc, final, 'for_you'))

    scored.sort(key=lambda r: r['score'], reverse=True)
    return scored[:limit]


# ── B. Weak signal: favored authors/categories only ──────────────────────
def _by_favored_facets(affinities, engaged_ids, limit):
    author_w, cat_w, author_name = _favored_facets(affinities)
    if not author_w and not cat_w:
        return []
    candidates = (
        Document.objects
        .filter(processed=True)
        .filter(Q(authors__in=list(author_w.keys())) | Q(categories__in=list(cat_w.keys())))
        .exclude(id__in=engaged_ids)
        .prefetch_related('authors', 'categories')
        .distinct()[:limit * 4]
    )
    scored = []
    for doc in candidates:
        facet_n, best_author = _facet_score(doc, author_w, cat_w, author_name)
        reason = 'more_by_author' if best_author else 'for_you'
        scored.append(_rec(doc, facet_n, reason, best_author if best_author else None))
    scored.sort(key=lambda r: r['score'], reverse=True)
    return scored[:limit]


# ── C. Cold start: popular across the whole library ──────────────────────
def _popular(engaged_ids, limit):
    rows = (
        UserDocumentAffinity.objects
        .exclude(document_id__in=engaged_ids)
        .values('document_id')
        .annotate(pop=Sum('engagement_score'))
        .order_by('-pop')[:limit]
    )
    ordered_ids = [r['document_id'] for r in rows]
    if not ordered_ids:
        return []
    docs = _fetch_ordered(ordered_ids)
    return [_rec(doc, 0.0, 'popular') for doc in docs]


# ── D. Empty library: newest processed documents ─────────────────────────
def _newest(engaged_ids, limit):
    docs = (
        Document.objects
        .filter(processed=True)
        .exclude(id__in=engaged_ids)
        .prefetch_related('authors', 'categories')
        .order_by('-uploaded_at')[:limit]
    )
    return [_rec(doc, 0.0, 'newest') for doc in docs]


def _fetch_ordered(doc_ids):
    """Fetch processed Documents by id, preserving the given order."""
    by_id = {
        d.id: d for d in Document.objects
        .filter(id__in=doc_ids, processed=True)
        .prefetch_related('authors', 'categories')
    }
    return [by_id[i] for i in doc_ids if i in by_id]
