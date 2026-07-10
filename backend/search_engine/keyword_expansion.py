"""Corpus-grounded alternative-keyword discovery for the library agent.

When a user's exact term or meaning is not found, the deep agent calls
``suggest_alternative_keywords`` to get related vocabulary drawn from the actual
corpus rather than hallucinated synonyms. The signal is Elasticsearch's
``significant_text`` aggregation (JLH score) over the Arabic-analyzed ``content``
field: given the documents that best match the query — found via fuzzy lexical
matching AND semantic kNN so it still works when the literal term is absent — it
surfaces the words statistically over-represented in those documents versus the
whole library.

``significant_text`` re-analyzes ``_source`` at query time, so it needs **no
``fielddata`` and no reindex** (unlike ``significant_terms``, which requires
fielddata on a ``text`` field).
"""
import logging
from typing import Dict, List

from elasticsearch_dsl import connections

from .documents import DocumentIndex
from .semantic import VECTOR_DIMENSIONS, build_embedding

logger = logging.getLogger(__name__)

DEFAULT_TOP_K = 10
CANDIDATE_KNN_K = 50
SAMPLE_SHARD_SIZE = 200


def _significant_text_agg(field: str, top_k: int) -> Dict:
    """A sampler-wrapped significant_text aggregation body for ``field``.

    The ``sampler`` bounds cost by scoring significance over only the top
    matching documents per shard.
    """
    return {
        "sample": {
            "sampler": {"shard_size": SAMPLE_SHARD_SIZE},
            "aggs": {
                "related_terms": {
                    "significant_text": {
                        "field": field,
                        "size": top_k,
                        "filter_duplicate_text": True,
                    }
                }
            },
        }
    }


def suggest_alternative_keywords(query: str, top_k: int = DEFAULT_TOP_K) -> Dict:
    """Return corpus-grounded related terms for ``query``.

    Result shape::

        {"query": str, "terms": [{"term", "score", "doc_count"}], "field_used": str|None}

    ``terms`` is ordered by descending significance and never includes the query
    itself. An empty ``terms`` list means the corpus surfaced nothing (the agent
    should then reason about synonyms on its own).
    """
    query = (query or "").strip()
    if not query:
        return {"query": query, "terms": [], "field_used": None}

    es = connections.get_connection()
    index_name = DocumentIndex._index._name

    # Foreground = docs matching the term fuzzily. Reuse the canonical search
    # field set (lazy import to avoid any import-order coupling) so the
    # significant_text foreground is drawn from the SAME documents the real
    # search would return — otherwise suggested keywords come from a different,
    # narrower doc set than the query the user actually ran.
    from .views import MULTI_MATCH_FIELDS

    foreground = {
        "multi_match": {
            "query": query,
            "fields": MULTI_MATCH_FIELDS,
            "fuzziness": "AUTO",
            "type": "best_fields",
        }
    }

    # The semantic kNN widens recall so we still find related terms when the
    # literal word never appears in the corpus (the "meaning not found" case).
    query_vector = build_embedding(query, task_type="RETRIEVAL_QUERY")
    knn = None
    if query_vector and len(query_vector) == VECTOR_DIMENSIONS:
        knn = {
            "field": "semantic_vector",
            "query_vector": query_vector,
            "k": CANDIDATE_KNN_K,
            "num_candidates": SAMPLE_SHARD_SIZE,
        }

    # `content.arabic` yields Arabic-stemmed, stopword-filtered terms; fall back
    # to the standard-analyzed `content` if the cluster rejects the multifield.
    for field in ("content.arabic", "content"):
        body: Dict = {
            "size": 0,
            "query": {"bool": {"should": [foreground], "minimum_should_match": 1}},
            "aggs": _significant_text_agg(field, top_k),
        }
        if knn is not None:
            body["knn"] = knn
        try:
            raw = es.search(index=index_name, body=body)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[KEYWORDS] significant_text on %s failed: %s", field, exc)
            continue

        buckets = (
            raw.get("aggregations", {})
            .get("sample", {})
            .get("related_terms", {})
            .get("buckets", [])
        )
        terms: List[Dict] = []
        for bucket in buckets:
            term = (bucket.get("key") or "").strip()
            if not term or term == query:
                continue
            terms.append({
                "term": term,
                "score": round(float(bucket.get("score", 0.0)), 4),
                "doc_count": bucket.get("doc_count", 0),
            })
        if terms:
            return {"query": query, "terms": terms[:top_k], "field_used": field}

    return {"query": query, "terms": [], "field_used": None}
