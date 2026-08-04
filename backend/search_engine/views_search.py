"""POST search endpoints: the multi-term corpus query executor.

``POST /documents/search/query/`` accepts a structured body — term rows with
per-term criteria, a scope (all / mine / selected books), and the same facet
filters as the GET endpoint — and runs the terms-native executor. The legacy
GET endpoints stay byte-identical (they never route through here); this is the
additive path the term-builder UI and downstream entity facets use.

Request body::

    {
      "version": 1,
      "terms": [
        {"text": "فضل العلم", "match": "phrase", "diacritics": "ignore", "op": "must"},
        {"text": "التصوف", "match": "fuzzy", "fuzziness": 1, "op": "should"},
        {"text": "فلسفة", "match": "word", "op": "must_not"}
      ],
      "scope": {"type": "selected", "ids": [12, 44]},
      "filters": {"authors": [...], "categories": [...], "languages": [...],
                   "countries": [...], "death_centuries": [...],
                   "date_from": "...", "date_to": "...", "rights_status": [...],
                   "facets": {"<registered_key>": ["v"]}},
      "mode": "hybrid",
      "page": 1
    }

Response items mirror the GET search shape (DocumentListSerializer +
score_lexical / score_semantic / score_final / explanations / snippet) plus
``term_hits`` — the request-array indexes of the terms that matched (from ES
named queries). ``next``/``previous`` are page numbers (URLs are meaningless
for POST).
"""
import logging
from types import SimpleNamespace
from typing import Dict, List, Optional, Tuple

from elasticsearch_dsl import connections
from rest_framework import permissions, serializers, status, views
from rest_framework.response import Response

from .documents import DocumentIndex
from .models import Document
from .query_builder import (
    MAX_TERMS,
    TERM_DIACRITICS,
    TERM_MATCHES,
    TERM_OPS,
    TermSpec,
    build_corpus_bool_query,
    build_facet_clauses,
    build_positive_gate_clauses,
    compose_query_text,
    normalize_highlight,
    term_hits_from_matched_queries,
)
from .semantic import VECTOR_DIMENSIONS, build_embedding
from .serializers import DocumentListSerializer
from .views import (
    VALID_CORPUS_SEARCH_MODES,
    VALID_SEARCH_MODES,
    _first_snippet,
    apply_document_filters,
    build_es_filter_clauses,
    search_within_document_terms,
)
from analytics.models import EventType
from analytics.services import record_event

logger = logging.getLogger(__name__)

PAGE_SIZE = 20  # mirrors REST_FRAMEWORK['PAGE_SIZE']


class FuzzinessField(serializers.Field):
    """0 | 1 | 2 | "AUTO" (case-insensitive on the string form)."""

    def to_internal_value(self, data):
        if isinstance(data, bool):
            raise serializers.ValidationError('fuzziness must be 0, 1, 2 or "AUTO"')
        if isinstance(data, int) and data in (0, 1, 2):
            return data
        if isinstance(data, str) and data.strip().upper() == 'AUTO':
            return 'AUTO'
        raise serializers.ValidationError('fuzziness must be 0, 1, 2 or "AUTO"')

    def to_representation(self, value):
        return value


class TermSpecSerializer(serializers.Serializer):
    text = serializers.CharField(max_length=200)
    match = serializers.ChoiceField(choices=TERM_MATCHES, default='word')
    fuzziness = FuzzinessField(required=False)
    diacritics = serializers.ChoiceField(choices=TERM_DIACRITICS, default='ignore')
    op = serializers.ChoiceField(choices=TERM_OPS, default='must')

    def validate(self, attrs):
        text = attrs['text'].strip()
        if not text:
            raise serializers.ValidationError({'text': 'term text is empty'})
        attrs['text'] = text
        if 'fuzziness' in attrs and attrs['match'] != 'fuzzy':
            raise serializers.ValidationError(
                {'fuzziness': 'fuzziness is only valid with match="fuzzy"'})
        if attrs['match'] == 'fuzzy':
            attrs.setdefault('fuzziness', 'AUTO')
        if attrs['match'] == 'stem':
            # A harakat-sensitive stem match is unsatisfiable (the stemmed
            # analyzer strips diacritics) — coerce, documented in the API.
            attrs['diacritics'] = 'ignore'
        return attrs


class ScopeSerializer(serializers.Serializer):
    type = serializers.ChoiceField(choices=('all', 'mine', 'selected'), default='all')
    ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=False,
        max_length=200,
    )

    def validate(self, attrs):
        if attrs.get('type') == 'selected' and not attrs.get('ids'):
            raise serializers.ValidationError({'ids': 'scope_ids_required'})
        return attrs


class SearchFiltersSerializer(serializers.Serializer):
    """The GET endpoint's facet filters, as JSON lists instead of CSV."""
    authors = serializers.ListField(child=serializers.CharField(), required=False)
    categories = serializers.ListField(child=serializers.CharField(), required=False)
    languages = serializers.ListField(child=serializers.CharField(), required=False)
    countries = serializers.ListField(child=serializers.CharField(), required=False)
    death_centuries = serializers.ListField(
        child=serializers.IntegerField(), required=False)
    rights_status = serializers.ListField(child=serializers.CharField(), required=False)
    date_from = serializers.DateField(required=False, allow_null=True)
    date_to = serializers.DateField(required=False, allow_null=True)
    facets = serializers.DictField(
        child=serializers.ListField(child=serializers.CharField()),
        required=False,
    )


class CorpusQuerySerializer(serializers.Serializer):
    version = serializers.IntegerField(required=False)
    terms = TermSpecSerializer(many=True, min_length=1, max_length=MAX_TERMS)
    scope = ScopeSerializer(required=False)
    filters = SearchFiltersSerializer(required=False)
    mode = serializers.ChoiceField(choices=VALID_CORPUS_SEARCH_MODES, default='hybrid')
    page = serializers.IntegerField(min_value=1, default=1)

    def validate_terms(self, value):
        if not any(t['op'] in ('must', 'should') for t in value):
            raise serializers.ValidationError('at_least_one_positive_term')
        return value


def _filters_shim(validated: dict, user) -> SimpleNamespace:
    """Adapt the validated POST body onto the GET filter contract
    (CSV-string ``query_params`` + ``user``) so ``build_es_filter_clauses``
    and ``apply_document_filters`` are reused verbatim."""
    filters = validated.get('filters') or {}
    params: Dict[str, str] = {}
    for key in ('authors', 'categories', 'languages', 'countries', 'rights_status'):
        values = filters.get(key)
        if values:
            params[key] = ','.join(str(v) for v in values)
    if filters.get('death_centuries'):
        params['death_centuries'] = ','.join(str(v) for v in filters['death_centuries'])
    for key in ('date_from', 'date_to'):
        if filters.get(key):
            params[key] = filters[key].isoformat()

    scope = validated.get('scope') or {'type': 'all'}
    if scope['type'] == 'mine':
        params['scope'] = 'mine'
    elif scope['type'] == 'selected':
        params['documents'] = ','.join(str(i) for i in scope['ids'])

    return SimpleNamespace(query_params=params, user=user)


def execute_corpus_query(
    terms: List[TermSpec],
    *,
    filters_request: SimpleNamespace,
    mode: str = 'hybrid',
    extra_filter_clauses: Optional[List[Dict]] = None,
    size: int = 200,
) -> Tuple[List[Document], Dict[int, Dict[str, object]], Optional[str]]:
    """Terms-native corpus executor: BM25 bool query (named per-term clauses)
    + optional kNN on the composed positive text, merged in Python exactly
    like ``views.execute_corpus_search`` (0.60/0.40 max-normalized blend — the
    licensed ``rank.rrf`` stays avoided).

    The kNN stage is hard-gated by the must / must_not clauses (filter
    context): يجب and بدون are promises, so a semantically-similar document
    that lacks a must term never surfaces.

    Returns ``(ordered_docs, metadata, degraded_reason)``; metadata entries
    carry the GET shape plus ``term_hits``.
    """
    es = connections.get_connection()
    index_name = DocumentIndex._index._name

    filter_clauses = build_es_filter_clauses(filters_request)
    if extra_filter_clauses:
        filter_clauses = filter_clauses + extra_filter_clauses

    lex_scores: Dict[int, float] = {}
    hit_by_id: Dict[int, dict] = {}
    if mode in ('exact', 'hybrid'):
        lex_body = {
            'size': size,
            'query': build_corpus_bool_query(terms, filter_clauses),
            'highlight': {
                'fields': {
                    'title': {}, 'title.exact': {}, 'title.arabic': {},
                    'description': {}, 'description.exact': {}, 'description.arabic': {},
                    'content': {}, 'content.exact': {}, 'content.arabic': {},
                    'alternate_names': {}, 'alternate_names.exact': {},
                    'alternate_names.arabic': {},
                },
                'pre_tags': ['<mark>'],
                'post_tags': ['</mark>'],
            },
        }
        try:
            lex_raw = es.search(index=index_name, body=lex_body)
            for hit in lex_raw.get('hits', {}).get('hits', []):
                doc_id = int(hit['_id'])
                lex_scores[doc_id] = float(hit.get('_score') or 0.0)
                hit_by_id[doc_id] = hit
        except Exception as exc:  # noqa: BLE001
            logger.error('[SEARCH-Q] BM25 request failed: %s', exc, exc_info=True)

    sem_scores: Dict[int, float] = {}
    use_semantic = False
    degraded_reason: Optional[str] = None
    if mode in ('semantic', 'hybrid'):
        query_text = compose_query_text(terms)
        query_vector = build_embedding(query_text, task_type='RETRIEVAL_QUERY')
        use_semantic = bool(query_vector and len(query_vector) == VECTOR_DIMENSIONS)
        if not use_semantic and mode == 'semantic':
            return [], {}, 'embedding_unavailable'
        if use_semantic:
            must_gates, not_gates = build_positive_gate_clauses(terms)
            knn_filter: Dict = {'bool': {'filter': filter_clauses + must_gates}}
            if not_gates:
                knn_filter['bool']['must_not'] = not_gates
            knn_clause = {
                'field': 'semantic_vector',
                'query_vector': query_vector,
                'k': min(size, 100),
                'num_candidates': max(size, 200),
                'filter': knn_filter,
            }
            knn_body = {'size': size, 'knn': knn_clause, '_source': False}
            try:
                sem_raw = es.search(index=index_name, body=knn_body)
                for hit in sem_raw.get('hits', {}).get('hits', []):
                    sem_scores[int(hit['_id'])] = float(hit.get('_score') or 0.0)
            except Exception as exc:  # noqa: BLE001
                logger.warning('[SEARCH-Q] kNN request failed (%s); lexical-only', exc)
                use_semantic = False

    if not lex_scores and not sem_scores:
        return [], {}, degraded_reason

    semantic_active = use_semantic and bool(sem_scores)
    max_lex = max(lex_scores.values()) if lex_scores else 0.0
    max_sem = max(sem_scores.values()) if sem_scores else 0.0

    document_ids = list(lex_scores.keys())
    document_ids += [i for i in sem_scores if i not in lex_scores]

    base_queryset = Document.objects.prefetch_related(
        'authors', 'alternate_names', 'categories'
    ).filter(id__in=document_ids)
    base_queryset = apply_document_filters(base_queryset, filters_request)
    docs = list(base_queryset)
    if not docs:
        return [], {}, degraded_reason

    if mode == 'semantic':
        method = 'knn'
    elif semantic_active:
        method = 'hybrid'
    else:
        method = 'bm25'
    metadata: Dict[int, Dict] = {}
    for doc in docs:
        lex_n = (lex_scores.get(doc.id, 0.0) / max_lex) if max_lex > 0 else 0.0
        sem_n = (sem_scores.get(doc.id, 0.0) / max_sem) if max_sem > 0 else 0.0
        if mode == 'exact':
            final = lex_n
        elif mode == 'semantic':
            final = sem_n
        else:
            final = (0.60 * lex_n + 0.40 * sem_n) if semantic_active else lex_n

        hit = hit_by_id.get(doc.id, {})
        hl = normalize_highlight(hit.get('highlight', {}))
        metadata[doc.id] = {
            'score_lexical': None if mode == 'semantic' else round(lex_n, 4),
            'score_semantic': (
                None if mode == 'exact'
                else round(sem_n, 4) if semantic_active or mode == 'semantic'
                else 0.0
            ),
            'score_final': round(final, 4),
            'explanations': {'matched_fields': list(hl.keys()), 'method': method},
            'snippet': _first_snippet(hl),
            # Docs surfaced only by the kNN stage carry no matched_queries;
            # they still satisfy every must (the kNN filter gates on them).
            'term_hits': term_hits_from_matched_queries(hit.get('matched_queries', [])),
        }

    ordered_docs = sorted(docs, key=lambda d: metadata[d.id]['score_final'], reverse=True)
    return ordered_docs, metadata, degraded_reason


class InBookQuerySerializer(serializers.Serializer):
    version = serializers.IntegerField(required=False)
    terms = TermSpecSerializer(many=True, min_length=1, max_length=MAX_TERMS)
    mode = serializers.ChoiceField(choices=VALID_SEARCH_MODES, default='all')
    threshold = serializers.FloatField(
        required=False, allow_null=True, min_value=0.0, max_value=1.0)

    def validate_terms(self, value):
        if not any(t['op'] in ('must', 'should') for t in value):
            raise serializers.ValidationError('at_least_one_positive_term')
        return value


class InBookQueryView(views.APIView):
    """``POST /api/search_engine/documents/<pk>/search/query/`` — the
    multi-term variant of the in-book search. Matches carry
    ``matched_terms`` (request-array term indexes); the single-term GET
    endpoint stays untouched."""

    permission_classes = [permissions.IsAuthenticated]
    throttle_scope = 'search'

    def post(self, request, pk):
        serializer = InBookQuerySerializer(data=request.data)
        if not serializer.is_valid():
            return Response(
                {'error': 'invalid_query', 'detail': serializer.errors},
                status=status.HTTP_400_BAD_REQUEST,
            )
        validated = serializer.validated_data

        try:
            document = Document.objects.get(id=pk)
        except Document.DoesNotExist:
            return Response(
                {'error': f'Document with ID {pk} not found'},
                status=status.HTTP_404_NOT_FOUND,
            )

        terms = [
            TermSpec(
                text=t['text'],
                match=t['match'],
                fuzziness=t.get('fuzziness', 'AUTO'),
                diacritics=t['diacritics'],
                op=t['op'],
            )
            for t in validated['terms']
        ]

        try:
            result = search_within_document_terms(
                document,
                terms,
                mode=validated['mode'],
                threshold=validated.get('threshold'),
            )
        except Exception as exc:  # noqa: BLE001
            logger.error('[DOC_SEARCH-Q] Error: %s', exc, exc_info=True)
            return Response(
                {'error': str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        record_event(
            user_id=request.user.id,
            event_type=EventType.IN_DOC_SEARCH,
            document_id=pk,
            metadata={
                'q': result['query'],
                'mode': validated['mode'],
                'term_count': len(terms),
                'terms': [{'match': t.match, 'op': t.op} for t in terms],
            },
            source='reader',
        )
        return Response(result, status=status.HTTP_200_OK)


class CorpusQueryView(views.APIView):
    """``POST /api/search_engine/documents/search/query/``"""

    permission_classes = [permissions.IsAuthenticated]
    throttle_scope = 'search'

    def post(self, request):
        serializer = CorpusQuerySerializer(data=request.data)
        if not serializer.is_valid():
            return Response(
                {'error': 'invalid_query', 'detail': serializer.errors},
                status=status.HTTP_400_BAD_REQUEST,
            )
        validated = serializer.validated_data

        facet_values = (validated.get('filters') or {}).get('facets') or {}
        facet_clauses, unknown_facets = build_facet_clauses(facet_values)
        if unknown_facets:
            return Response(
                {'error': 'unknown_facet', 'facets': unknown_facets},
                status=status.HTTP_400_BAD_REQUEST,
            )

        terms = [
            TermSpec(
                text=t['text'],
                match=t['match'],
                fuzziness=t.get('fuzziness', 'AUTO'),
                diacritics=t['diacritics'],
                op=t['op'],
            )
            for t in validated['terms']
        ]
        filters_request = _filters_shim(validated, request.user)
        mode = validated['mode']

        try:
            ordered_docs, metadata, degraded_reason = execute_corpus_query(
                terms,
                filters_request=filters_request,
                mode=mode,
                extra_filter_clauses=facet_clauses,
            )
        except Exception as exc:  # noqa: BLE001
            logger.error('[SEARCH-Q] executor failed: %s', exc, exc_info=True)
            ordered_docs, metadata, degraded_reason = [], {}, None

        page = validated['page']
        start = (page - 1) * PAGE_SIZE
        page_docs = ordered_docs[start:start + PAGE_SIZE]
        data = DocumentListSerializer(
            page_docs, many=True, context={'request': request}
        ).data
        for item in data:
            extra = metadata.get(item['id'])
            if extra:
                item.update(extra)

        count = len(ordered_docs)
        body = {
            'count': count,
            'next': page + 1 if start + PAGE_SIZE < count else None,
            'previous': page - 1 if page > 1 else None,
            'results': data,
        }
        if degraded_reason:
            body['degraded_reason'] = degraded_reason

        scope = validated.get('scope') or {'type': 'all'}
        record_event(
            user_id=request.user.id,
            event_type=EventType.SEARCH,
            metadata={
                'q': compose_query_text(terms),
                'mode': mode,
                'result_count': count,
                'scope': scope['type'],
                'term_count': len(terms),
                'terms': [{'match': t.match, 'op': t.op} for t in terms],
                'filters': {
                    k: v for k, v in filters_request.query_params.items()
                    if k not in ('scope',)
                },
            },
        )

        return Response(body)
