import logging
import os
import re
from datetime import datetime
from types import SimpleNamespace
from typing import Dict, List, Tuple

from django.core.cache import cache
from django.db.models import Q as DjangoQ
from elasticsearch_dsl import Q
from elasticsearch_dsl import connections
from rest_framework import generics, permissions, status, views
from rest_framework.response import Response

from . import ocr as ocr_registry
from .documents import DocumentIndex
from .models import Author, Category, Document, DocumentChunk
from .permissions import IsAuthenticatedReadOnlyOrEditor
from .semantic import VECTOR_DIMENSIONS, build_embedding, cosine_similarity
from .serializers import (
    AuthorDetailSerializer,
    AuthorListSerializer,
    CategoryListSerializer,
    DocumentDetailSerializer,
    DocumentListSerializer,
    DocumentSerializer,
)
from .tasks import process_document_task
from .utils import split_document_content_into_pages

logger = logging.getLogger(__name__)


# Canonical searchable fields + boosts for the corpus multi_match. Reused by
# build_multi_match_query and every raw ES body (execute_corpus_search,
# DocumentSearchView._execute_search, keyword_expansion) so the agent tool, the
# search endpoint, the list view, and the keyword expander never drift on which
# fields are searchable or how they're boosted.
MULTI_MATCH_FIELDS = [
    'title^2', 'title.arabic^2',
    'authors^1.5', 'authors.arabic^1.5',
    'categories^1.5',
    'description^1.2', 'description.arabic^1.2',
    'alternate_names^1.3', 'alternate_names.arabic^1.3',
    'content', 'content.arabic',
]


def build_multi_match_query(query: str) -> Q:
    return Q(
        'multi_match',
        query=query,
        fields=MULTI_MATCH_FIELDS,
        fuzziness='AUTO',
        type='best_fields',
    )


def apply_document_filters(queryset, request):
    authors = request.query_params.get('authors', None)
    if authors:
        author_list = [a.strip() for a in authors.split(',') if a.strip()]
        if author_list:
            author_objects = Author.objects.filter(name__in=author_list)
            if author_objects.exists():
                queryset = queryset.filter(authors__in=author_objects).distinct()
            else:
                author_ids = [int(a) for a in author_list if a.isdigit()]
                if author_ids:
                    queryset = queryset.filter(authors__id__in=author_ids).distinct()
                else:
                    # A requested author name resolves to no known Author (e.g. a
                    # transliteration mismatch). Return no matches rather than
                    # silently ignoring the filter and returning every document —
                    # otherwise the caller (or the agent) mis-attributes results.
                    queryset = queryset.none()

    documents = request.query_params.get('documents', None)
    if documents:
        # Direct PK scope; no join, so no .distinct() needed. Non-digit tokens
        # are silently dropped, matching the date-parsing guards below.
        doc_ids = [int(d.strip()) for d in documents.split(',') if d.strip().isdigit()]
        if doc_ids:
            queryset = queryset.filter(id__in=doc_ids)

    categories = request.query_params.get('categories', None)
    if categories:
        category_list = [c.strip() for c in categories.split(',') if c.strip()]
        if category_list:
            queryset = queryset.filter(categories__name__in=category_list).distinct()

    language = request.query_params.get('language', None)
    if language:
        queryset = queryset.filter(language=language)

    date_from = request.query_params.get('date_from', None)
    if date_from:
        try:
            date_from_obj = datetime.strptime(date_from, '%Y-%m-%d').date()
            queryset = queryset.filter(uploaded_at__gte=date_from_obj)
        except ValueError:
            pass

    date_to = request.query_params.get('date_to', None)
    if date_to:
        try:
            date_to_obj = datetime.strptime(date_to, '%Y-%m-%d').date()
            queryset = queryset.filter(uploaded_at__lte=date_to_obj)
        except ValueError:
            pass

    rights_status = request.query_params.get('rights_status', None)
    if rights_status:
        valid_statuses = {choice for choice, _ in Document.RightsStatus.choices}
        statuses = [s.strip() for s in rights_status.split(',') if s.strip() in valid_statuses]
        if statuses:
            queryset = queryset.filter(rights_status__in=statuses)

    return queryset


def build_es_filter_clauses(request):
    """Build Elasticsearch ``bool.filter`` clauses for corpus-search pushdown.

    Mirrors ``apply_document_filters``' silent-drop parsing but targets the ES
    query body instead of the Django queryset, so relevance is computed only
    within the scoped candidate set (otherwise a narrow scope can rank outside
    the unfiltered top-N and silently vanish). Handles ``documents``,
    ``categories``, ``language`` and ``date_from``/``date_to``.

    ``authors`` is deliberately excluded: the ES ``authors`` field is analyzed
    text with no keyword sub-field, so a ``terms`` filter wouldn't reliably match
    whole author identities — author scoping stays Django-side only via
    ``apply_document_filters``.

    ``rights_status`` is also Django-side only: it is not indexed in ES (adding
    it would force a corpus reindex), so narrow rights slices are applied after
    ranking and can under-return from the top-N.
    """
    clauses: List[Dict] = []

    documents = request.query_params.get('documents', None)
    if documents:
        # ES ``_id`` is always string-typed, so keep the ids as strings. Non-digit
        # tokens are silently dropped, matching apply_document_filters.
        doc_ids = [d.strip() for d in documents.split(',') if d.strip().isdigit()]
        if doc_ids:
            clauses.append({"terms": {"_id": doc_ids}})

    categories = request.query_params.get('categories', None)
    if categories:
        # ``categories`` is a KeywordField(multi=True) — exact-match safe.
        category_list = [c.strip() for c in categories.split(',') if c.strip()]
        if category_list:
            clauses.append({"terms": {"categories": category_list}})

    language = request.query_params.get('language', None)
    if language:
        clauses.append({"term": {"language": language}})

    date_from = request.query_params.get('date_from', None)
    if date_from:
        try:
            datetime.strptime(date_from, '%Y-%m-%d')
            clauses.append({"range": {"uploaded_at": {"gte": date_from}}})
        except ValueError:
            pass

    date_to = request.query_params.get('date_to', None)
    if date_to:
        try:
            datetime.strptime(date_to, '%Y-%m-%d')
            clauses.append({"range": {"uploaded_at": {"lte": date_to}}})
        except ValueError:
            pass

    return clauses


class DocumentListCreateView(generics.ListCreateAPIView):
    """
    List all documents or create a new document.
    """

    queryset = Document.objects.all()
    serializer_class = DocumentSerializer
    permission_classes = [IsAuthenticatedReadOnlyOrEditor]

    def get_throttles(self):
        self.throttle_scope = 'upload' if self.request.method == 'POST' else 'search'
        return super().get_throttles()

    def get_serializer_class(self):
        if self.request.method == 'GET':
            return DocumentListSerializer
        return DocumentSerializer

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['request'] = self.request
        return context

    def get_queryset(self):
        queryset = Document.objects.prefetch_related('authors', 'alternate_names', 'categories').all()
        queryset = apply_document_filters(queryset, self.request)

        search_query = self.request.query_params.get('q', '').strip()
        if not search_query:
            return queryset

        try:
            search = DocumentIndex.search()
            search = search.query(build_multi_match_query(search_query))
            response = search.execute()
            document_ids = [int(hit.meta.id) for hit in response]
            id_order = {doc_id: idx for idx, doc_id in enumerate(document_ids)}
            queryset = queryset.filter(id__in=document_ids)
            return sorted(list(queryset), key=lambda doc: id_order.get(doc.id, float('inf')))
        except Exception as exc:
            logger.error('[LIST] Elasticsearch search failed: %s', str(exc), exc_info=True)
            return queryset.filter(
                DjangoQ(title__icontains=search_query) | DjangoQ(content__icontains=search_query)
            )

    def create(self, request, *args, **kwargs):
        logger.info(
            '[UPLOAD] POST request received',
            extra={
                'path': request.path,
                'method': request.method,
                'user_id': getattr(request.user, 'id', None),
            },
        )
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        alternate_names = serializer.validated_data.pop('alternate_names', [])
        category_names = serializer.validated_data.pop('category_names', [])
        author_names = serializer.validated_data.pop('author_names', [])
        edition_fields = {
            'editor': serializer.validated_data.pop('edition_editor', ''),
            'publisher': serializer.validated_data.pop('edition_publisher', ''),
            'publication_year_hijri': serializer.validated_data.pop('edition_year_hijri', ''),
            'publication_year_gregorian': serializer.validated_data.pop(
                'edition_year_gregorian', ''),
            'volume_count': serializer.validated_data.pop('edition_volume_count', None),
        }

        document = serializer.save()

        if any(str(value).strip() for value in edition_fields.values() if value is not None):
            from .models import Edition

            try:
                Edition.objects.create(
                    document=document,
                    editor=(edition_fields['editor'] or '').strip(),
                    publisher=(edition_fields['publisher'] or '').strip(),
                    publication_year_hijri=(
                        edition_fields['publication_year_hijri'] or '').strip(),
                    publication_year_gregorian=(
                        edition_fields['publication_year_gregorian'] or '').strip(),
                    volume_count=edition_fields['volume_count'],
                )
            except Exception as exc:
                logger.warning(
                    '[UPLOAD] Could not create edition for document %s: %s',
                    document.id, str(exc))

        for author_name in author_names:
            if not author_name or not author_name.strip():
                continue
            try:
                author, _ = Author.objects.get_or_create(name=author_name.strip())
                document.authors.add(author)
            except Exception as exc:
                logger.warning('[UPLOAD] Could not link author %s: %s', author_name, str(exc))

        for category_name in category_names:
            if not category_name or not category_name.strip():
                continue
            try:
                category, _ = Category.objects.get_or_create(name=category_name.strip())
                document.categories.add(category)
            except Exception as exc:
                logger.warning('[UPLOAD] Could not link category %s: %s', category_name, str(exc))

        if alternate_names:
            from .models import DocumentAlternateName

            for name in alternate_names:
                if not name or not name.strip():
                    continue
                try:
                    DocumentAlternateName.objects.get_or_create(
                        document=document,
                        name=name.strip(),
                        defaults={'name': name.strip()},
                    )
                except Exception as exc:
                    logger.warning('[UPLOAD] Could not add alternate name %s: %s', name, str(exc))

        try:
            process_document_task.delay(document.id)
        except Exception as exc:
            logger.error(
                '[UPLOAD] Failed to queue processing for document %s: %s',
                document.id,
                str(exc),
                exc_info=True,
            )


class DocumentDetailView(generics.RetrieveUpdateDestroyAPIView):
    queryset = Document.objects.prefetch_related(
        'authors', 'alternate_names', 'categories', 'editions').all()
    serializer_class = DocumentDetailSerializer
    permission_classes = [IsAuthenticatedReadOnlyOrEditor]

    def get_throttles(self):
        self.throttle_scope = 'upload' if self.request.method not in permissions.SAFE_METHODS else 'search'
        return super().get_throttles()


def execute_corpus_search(
    query: str,
    *,
    filters=None,
    size: int = 200,
    include_snippets: bool = False,
) -> Tuple[List[Document], Dict[int, Dict[str, object]]]:
    """Hybrid corpus search: BM25 lexical + kNN semantic, merged in Python.

    The stable single-path ranker for the CopilotKit ``search_library`` agent
    tool. ``filters`` is any object exposing ``.get(key)`` (a DRF
    ``QueryDict`` or a plain dict) with the keys understood by
    ``apply_document_filters`` (authors, categories, language, date_from,
    date_to); pass ``None`` to skip filtering. When ``include_snippets`` is set,
    each metadata entry also carries a plain-text ``snippet`` (first highlight
    fragment) for the agent to show — the REST endpoint leaves it off so its
    response shape is unchanged.

    The lexical (BM25) and semantic (kNN) stages run as two separate ES requests
    and are merged/reranked here with a 0.60 / 0.40 weighted blend of their
    max-normalized scores (the same weighting as the in-document "mix" mode).
    This deliberately avoids Elasticsearch's ``rank.rrf`` fusion, which is a
    *licensed* feature — a basic-license cluster 403s on it — so semantic and
    cross-lingual matches (e.g. an Arabic query finding a Latin-script record by
    meaning) work on any license. Degrades to lexical-only when no embedding is
    available or the kNN request fails.

    Returns ``(ordered_docs, metadata)``.
    """
    es = connections.get_connection()
    index_name = DocumentIndex._index._name

    # Push non-author filters (categories/language/dates/documents) INTO the ES
    # query so relevance is computed only within the scoped candidate set —
    # otherwise a matching doc can rank outside the unfiltered top-N and silently
    # vanish. Authors stay Django-side (see build_es_filter_clauses's docstring).
    filter_clauses = (
        build_es_filter_clauses(SimpleNamespace(query_params=filters))
        if filters is not None else []
    )

    bm25_query = {
        "multi_match": {
            "query": query,
            "fields": MULTI_MATCH_FIELDS,
            "fuzziness": "AUTO",
            "type": "best_fields",
        }
    }
    lex_query = (
        {"bool": {"must": [bm25_query], "filter": filter_clauses}}
        if filter_clauses else bm25_query
    )

    # --- Lexical stage (BM25) --- always run; carries the highlights/snippets.
    lex_scores: Dict[int, float] = {}
    hit_by_id: Dict[int, dict] = {}
    lex_body = {
        "size": size,
        "query": lex_query,
        "highlight": {
            "fields": {
                "title": {}, "description": {}, "content": {}, "alternate_names": {},
            }
        },
    }
    try:
        lex_raw = es.search(index=index_name, body=lex_body)
        for hit in lex_raw.get("hits", {}).get("hits", []):
            doc_id = int(hit["_id"])
            lex_scores[doc_id] = float(hit.get("_score") or 0.0)
            hit_by_id[doc_id] = hit
    except Exception as exc:  # noqa: BLE001
        logger.error("[SEARCH] BM25 request failed: %s", exc, exc_info=True)

    # --- Semantic stage (kNN) --- plain top-level kNN is license-free; merged in
    # Python below (NOT via the licensed rank.rrf), so this works on basic ES.
    sem_scores: Dict[int, float] = {}
    query_vector = build_embedding(query, task_type="RETRIEVAL_QUERY")
    use_semantic = bool(query_vector and len(query_vector) == VECTOR_DIMENSIONS)
    if use_semantic:
        knn_clause = {
            "field": "semantic_vector",
            "query_vector": query_vector,
            "k": min(size, 100),
            "num_candidates": max(size, 200),
        }
        if filter_clauses:
            knn_clause["filter"] = {"bool": {"filter": filter_clauses}}
        knn_body = {"size": size, "knn": knn_clause, "_source": False}
        try:
            sem_raw = es.search(index=index_name, body=knn_body)
            for hit in sem_raw.get("hits", {}).get("hits", []):
                sem_scores[int(hit["_id"])] = float(hit.get("_score") or 0.0)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[SEARCH] kNN request failed (%s); continuing lexical-only", exc)
            use_semantic = False

    if not lex_scores and not sem_scores:
        return [], {}

    # --- Merge: max-normalize each signal, then weighted blend over the union ---
    semantic_active = use_semantic and bool(sem_scores)
    max_lex = max(lex_scores.values()) if lex_scores else 0.0
    max_sem = max(sem_scores.values()) if sem_scores else 0.0
    lex_weight, sem_weight = 0.60, 0.40  # matches the in-document "mix" blend

    document_ids: List[int] = list(lex_scores.keys())
    document_ids += [i for i in sem_scores if i not in lex_scores]

    base_queryset = Document.objects.prefetch_related(
        'authors', 'alternate_names', 'categories'
    ).filter(id__in=document_ids)
    if filters is not None:
        base_queryset = apply_document_filters(
            base_queryset, SimpleNamespace(query_params=filters)
        )
    docs = list(base_queryset)
    if not docs:
        return [], {}

    metadata: Dict[int, Dict] = {}
    method = "hybrid" if semantic_active else "bm25"
    for doc in docs:
        lex_n = (lex_scores.get(doc.id, 0.0) / max_lex) if max_lex > 0 else 0.0
        sem_n = (sem_scores.get(doc.id, 0.0) / max_sem) if max_sem > 0 else 0.0
        final = (lex_weight * lex_n + sem_weight * sem_n) if semantic_active else lex_n

        hit = hit_by_id.get(doc.id, {})
        hl = hit.get("highlight", {})
        entry = {
            "score_lexical": round(lex_n, 4),
            # Numeric 0.0 (not None) when kNN didn't contribute, so consumers
            # keep seeing a number in this field.
            "score_semantic": round(sem_n, 4) if semantic_active else 0.0,
            "score_final": round(final, 4),
            "explanations": {
                "matched_fields": list(hl.keys()),
                "method": method,
            },
        }
        if include_snippets:
            # Content-first (show the matching passage), tags stripped for plain
            # agent display. Shares the extractor with the REST endpoint.
            entry["snippet"] = _first_snippet(
                hl, fields=("content", "description", "title"), strip=True
            ) or ""
        metadata[doc.id] = entry

    ordered_docs = sorted(docs, key=lambda d: metadata[d.id]["score_final"], reverse=True)
    return ordered_docs, metadata


# Corpus-wide search modes for DocumentSearchView. Intentionally distinct from
# the 4-value VALID_SEARCH_MODES used by the unrelated in-document search
# endpoint (DocumentInDocumentSearchView) — do not conflate them.
VALID_CORPUS_SEARCH_MODES = ('exact', 'semantic', 'hybrid')


def _first_snippet(
    highlight,
    *,
    fields=('title', 'description', 'alternate_names', 'content'),
    strip=False,
):
    """Return the first available highlight fragment for a corpus-search hit.

    ``fields`` sets the descending display priority (the REST endpoint prefers
    the title; the agent tool passes content-first). By default the fragment is
    returned verbatim with its ``<mark>`` tags for the UI to render; pass
    ``strip=True`` to get plain text (for the agent). Returns ``None`` when
    nothing was highlighted (e.g. pure-``semantic`` mode has no lexical clause).
    """
    for field in fields:
        frags = highlight.get(field) or []
        if frags:
            frag = frags[0]
            return re.sub(r'</?mark>', '', frag).strip() if strip else frag
    return None


class DocumentSearchView(generics.ListAPIView):
    """
    Search documents using lexical Elasticsearch score + semantic reranking.
    """

    serializer_class = DocumentListSerializer
    permission_classes = [permissions.IsAuthenticated]
    throttle_scope = 'search'

    def _execute_search(
        self, query: str, mode: str
    ) -> Tuple[List[Document], Dict[int, Dict[str, object]]]:
        """Mode-aware corpus search over Elasticsearch.

        - ``hybrid`` (default): delegates to the module-level
          ``execute_corpus_search`` helper, which runs BM25 and kNN as two
          *separate* ES requests and merges them in Python with a 0.60/0.40
          weighted blend of max-normalized scores. This deliberately avoids
          Elasticsearch's ``rank.rrf`` fusion — a *licensed* feature that always
          403s on a basic-license cluster — so hybrid genuinely combines lexical
          + semantic on any license (the previous in-view ``rank.rrf`` attempt
          always failed and silently fell back to BM25-only, making ``hybrid``
          identical to ``exact``). The helper's return shape (``score_lexical`` /
          ``score_semantic`` / ``score_final`` / ``explanations{matched_fields,
          method}`` / ``snippet``) is exactly what ``list`` merges onto the
          serialized results, so it is returned unchanged. This is the same
          single-path ranker the CopilotKit ``search_library`` agent tool uses,
          so the two never drift.
        - ``exact``: BM25 only — no embedding call, no ``knn``. Pure lexical, so
          no licensing concern.
        - ``semantic``: kNN only — no ``query``. Pure top-level kNN, also
          license-free. With no usable embedding there is no lexical fallback, so
          it returns empty and sets
          ``self.search_degraded_reason = 'embedding_unavailable'``.
        """
        # Hybrid reuses the proven, license-free helper (BM25 + kNN merged in
        # Python) instead of ES ``rank.rrf``, which 403s on a basic license and
        # would otherwise always degrade to BM25-only here. The helper's
        # (ordered_docs, metadata) shape is already what the caller expects.
        if mode == 'hybrid':
            return execute_corpus_search(
                query,
                filters=self.request.query_params,
                size=200,
                include_snippets=True,
            )

        filter_clauses = build_es_filter_clauses(self.request)
        es = connections.get_connection()
        index_name = DocumentIndex._index._name

        bm25_query = {
            "multi_match": {
                "query": query,
                "fields": MULTI_MATCH_FIELDS,
                "fuzziness": "AUTO",
                "type": "best_fields",
            }
        }
        highlight = {
            "fields": {
                "title": {},
                "description": {},
                "content": {},
                "alternate_names": {},
            },
            "pre_tags": ["<mark>"],
            "post_tags": ["</mark>"],
        }

        if mode == 'semantic':
            # Only semantic needs an embedding; exact skips the API round-trip.
            query_vector = build_embedding(query, task_type="RETRIEVAL_QUERY")
            use_knn = bool(query_vector and len(query_vector) == VECTOR_DIMENSIONS)
            if not use_knn:
                logger.warning(
                    "[SEARCH] semantic mode requested but embedding unavailable; "
                    "no lexical fallback"
                )
                self.search_degraded_reason = 'embedding_unavailable'
                return [], {}
            knn_clause = {
                "field": "semantic_vector",
                "query_vector": query_vector,
                "k": 50,
                "num_candidates": 200,
            }
            if filter_clauses:
                knn_clause["filter"] = {"bool": {"filter": filter_clauses}}
            body = {"size": 200, "knn": knn_clause}
        else:  # exact: BM25 lexical body only (no kNN, no rank).
            # Wrap in ``bool`` only when there are filter clauses so the no-filter
            # body stays byte-for-byte identical to the historical behavior.
            if filter_clauses:
                query_clause = {"bool": {"must": [bm25_query], "filter": filter_clauses}}
            else:
                query_clause = bm25_query
            body = {"size": 200, "query": query_clause, "highlight": highlight}

        try:
            raw = es.search(index=index_name, body=body)
        except Exception as exc:
            # exact (BM25) and semantic (top-level kNN) are both license-free
            # single-request queries; a failure here has no fallback path.
            logger.error("[SEARCH] ES request failed: %s", exc, exc_info=True)
            return [], {}

        hits = raw.get("hits", {}).get("hits", [])
        if not hits:
            return [], {}

        hit_by_id: Dict[int, dict] = {}
        es_scores: Dict[int, float] = {}
        document_ids: List[int] = []
        for hit in hits:
            doc_id = int(hit["_id"])
            hit_by_id[doc_id] = hit
            es_scores[doc_id] = float(hit.get("_score") or 0.0)
            document_ids.append(doc_id)

        base_queryset = Document.objects.prefetch_related(
            'authors', 'alternate_names', 'categories'
        ).filter(id__in=document_ids)
        # Django-side filters stay authoritative — especially ``authors``, which
        # has no reliable ES keyword equivalent and is intentionally not pushed
        # into the ES body.
        base_queryset = apply_document_filters(base_queryset, self.request)
        docs = list(base_queryset)
        if not docs:
            return [], {}

        max_score = max(es_scores.values()) if es_scores else 1.0
        metadata: Dict[int, Dict] = {}
        for doc in docs:
            raw_score = es_scores.get(doc.id, 0.0)
            norm_score = raw_score / max_score if max_score > 0 else 0.0

            hit = hit_by_id.get(doc.id, {})
            hl = hit.get("highlight", {})
            highlight_fields = list(hl.keys())
            snippet = _first_snippet(hl)

            if mode == 'exact':
                entry = {
                    "score_lexical": round(norm_score, 4),
                    "score_semantic": None,
                    "score_final": round(norm_score, 4),
                    "explanations": {"matched_fields": highlight_fields, "method": "bm25"},
                    "snippet": snippet,
                }
            else:  # semantic
                entry = {
                    "score_lexical": None,
                    "score_semantic": round(norm_score, 4),
                    "score_final": round(norm_score, 4),
                    "explanations": {"matched_fields": highlight_fields, "method": "knn"},
                    "snippet": snippet,
                }
            metadata[doc.id] = entry

        ordered_docs = sorted(docs, key=lambda d: metadata[d.id]["score_final"], reverse=True)
        return ordered_docs, metadata

    def get_queryset(self):
        self.search_degraded_reason = None
        query = self.request.query_params.get('q', '').strip()
        if not query:
            return Document.objects.none()
        mode = self.request.query_params.get('mode', 'hybrid').strip().lower()
        if mode not in VALID_CORPUS_SEARCH_MODES:
            # Authoritative validation happens in list(); fall back defensively.
            mode = 'hybrid'
        try:
            ordered_docs, metadata = self._execute_search(query, mode)
            self.search_metadata = metadata
            return ordered_docs
        except Exception as exc:
            logger.error('[SEARCH] Elasticsearch search failed: %s', str(exc), exc_info=True)
            self.search_metadata = {}
            return Document.objects.none()

    def list(self, request, *args, **kwargs):
        query = request.query_params.get('q', '').strip()
        if not query:
            return Response(
                {'error': 'Query parameter "q" is required'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        mode = request.query_params.get('mode', 'hybrid').strip().lower()
        if mode not in VALID_CORPUS_SEARCH_MODES:
            return Response(
                {'error': f'Invalid mode. Choose one of: {", ".join(VALID_CORPUS_SEARCH_MODES)}'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        serializer = self.get_serializer(page if page is not None else queryset, many=True)
        data = serializer.data

        metadata = getattr(self, 'search_metadata', {})
        for item in data:
            extra = metadata.get(item['id'])
            if extra:
                item.update(extra)

        if page is not None:
            response = self.get_paginated_response(data)
        else:
            response = Response(data)

        # Surface an optional degraded-search signal uniformly on the response
        # body (only semantic mode with an unavailable embedding sets it today).
        degraded_reason = getattr(self, 'search_degraded_reason', None)
        if degraded_reason and isinstance(response.data, dict):
            response.data['degraded_reason'] = degraded_reason

        return response


class DocumentSuggestionsView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]
    throttle_scope = 'search'

    def get(self, request):
        query = request.query_params.get('q', '').strip()
        if len(query) < 2:
            return Response({'query': query, 'suggestions': []})

        title_candidates = list(
            Document.objects.filter(title__icontains=query)
            .order_by('title')
            .values_list('title', flat=True)[:10]
        )
        author_candidates = list(
            Author.objects.filter(name__icontains=query)
            .order_by('name')
            .values_list('name', flat=True)[:10]
        )
        category_candidates = list(
            Category.objects.filter(name__icontains=query)
            .order_by('name')
            .values_list('name', flat=True)[:10]
        )

        combined = list(dict.fromkeys(title_candidates + author_candidates + category_candidates))
        combined.sort(key=lambda item: (0 if item.lower().startswith(query.lower()) else 1, len(item)))

        return Response(
            {
                'query': query,
                'suggestions': combined[:10],
            },
            status=status.HTTP_200_OK,
        )


# ---------------------------------------------------------------------------
# Natural-language search assistant
# ---------------------------------------------------------------------------
# Turns a free-form Arabic/English query typed into the /documents command
# palette into the structured filter shape the page already consumes
# (frontend ``DocumentFilterValues``). The LLM only *extracts* intent — it never
# runs the search. The frontend applies the returned filters and its existing
# fetch pipeline retrieves results, so URL-sync / persistence / pagination stay
# single-sourced. Reuses ``make_openrouter_chat`` (llm.py) so the OpenRouter
# client never drifts from the reader chat / deep-agent sidecar.

# OpenAI function-calling schema — LangChain ``bind_tools`` accepts these dicts
# directly (same convention as ``agent_tools.TOOL_SCHEMAS``).
ASSIST_FILTER_TOOL = {
    'type': 'function',
    'function': {
        'name': 'set_library_filters',
        'description': (
            'Record the structured library-search filters extracted from the '
            "user's natural-language query. Call this exactly once."
        ),
        'parameters': {
            'type': 'object',
            'properties': {
                'search_terms': {
                    'type': 'string',
                    'description': (
                        'Residual free-text keywords to full-text search for, in '
                        'the SAME language/script the user typed, with author, '
                        'category, language and date phrases removed. May be empty '
                        'when the query is fully captured by facet filters. Put '
                        'anything you are unsure how to classify here.'
                    ),
                },
                'authors': {
                    'type': 'array', 'items': {'type': 'string'},
                    'description': 'Author / writer names mentioned (e.g. "الغزالي", "Ibn Taymiyyah").',
                },
                'categories': {
                    'type': 'array', 'items': {'type': 'string'},
                    'description': 'Subject / category / genre names mentioned (e.g. "العقيدة", "fiqh", "ethics").',
                },
                'languages': {
                    'type': 'array', 'items': {'type': 'string'},
                    'description': 'Language codes if the user restricts language, e.g. "ar", "en".',
                },
                'date_from': {
                    'type': 'string',
                    'description': (
                        'Upload-date lower bound as YYYY-MM-DD, ONLY when the user '
                        'refers to when a book was added/uploaded to the library. '
                        'Never infer authorship/composition (e.g. Hijri) dates.'
                    ),
                },
                'date_to': {
                    'type': 'string',
                    'description': 'Upload-date upper bound as YYYY-MM-DD; same rules as date_from.',
                },
                'mode': {
                    'type': 'string', 'enum': list(VALID_CORPUS_SEARCH_MODES),
                    'description': (
                        'Search mode: "exact" for a literal phrase, "semantic" for '
                        'meaning-based, "hybrid" (default) otherwise.'
                    ),
                },
                'interpretation': {
                    'type': 'string',
                    'description': "One short sentence, in the user's language, summarising how you read the query.",
                },
            },
            'required': ['search_terms'],
        },
    },
}

ASSIST_SYSTEM_PROMPT = (
    "You convert a library patron's natural-language book-search request into "
    'structured filters by calling set_library_filters exactly once. The library '
    'holds classical and modern Arabic-Islamic books. Decompose the request into '
    'author names, subject/category names, language codes, and residual keywords.\n'
    'Rules:\n'
    '- Keep search_terms in the SAME language and script the user typed.\n'
    '- Put author names in `authors` and topics/genres in `categories`; leave '
    'anything ambiguous in `search_terms` rather than guessing a facet.\n'
    '- Only set date_from/date_to for when a book was uploaded/added to the '
    'library. NEVER translate authorship or Hijri/Gregorian composition dates '
    '(e.g. "قبل 700 هـ", "before 1900") into date filters — keep such phrases in '
    'search_terms.\n'
    '- Default mode to "hybrid" unless the user clearly wants an exact phrase '
    '("exact") or a purely conceptual/meaning search ("semantic").\n'
    "- Write a brief interpretation in the user's language."
)


# Short-lived cache of the corpus's distinct language codes, used to validate
# assist language guesses without a per-request distinct scan.
_ASSIST_LANGUAGES_CACHE_KEY = 'assist_known_languages_v1'


def _empty_assist_filters(raw: str) -> Dict:
    """The degraded/no-op filter set: a plain hybrid search over the raw text."""
    return {
        'q': raw,
        'mode': 'hybrid',
        'authors': [],
        'categories': [],
        'languages': [],
        'dateFrom': None,
        'dateTo': None,
    }


def _valid_iso_date(value) -> str | None:
    """Return ``value`` iff it is a valid ``YYYY-MM-DD`` string, else ``None``."""
    if not value:
        return None
    try:
        datetime.strptime(value, '%Y-%m-%d')
        return value
    except (ValueError, TypeError):
        return None


class DocumentSearchAssistView(views.APIView):
    """POST a natural-language query; get back structured ``DocumentFilterValues``.

    Never runs the search itself. Degrades gracefully to a plain hybrid search
    over the raw text (with a ``degraded_reason`` flag mirroring
    ``DocumentSearchView``) whenever the LLM is unavailable or errors, so the
    palette's submit path always produces *some* result.
    """

    permission_classes = [permissions.IsAuthenticated]
    throttle_scope = 'search'

    def post(self, request):
        raw = (request.data.get('q') or '').strip()
        locale = (request.data.get('locale') or 'ar').strip()[:5] or 'ar'
        if not raw:
            return Response({'detail': 'q is required'}, status=status.HTTP_400_BAD_REQUEST)

        parsed = self._parse_with_llm(raw, locale)
        if parsed is None:
            return Response({
                'filters': _empty_assist_filters(raw),
                'interpretation': None,
                'degraded_reason': 'ai_unavailable',
            })

        filters, interpretation = self._resolve(parsed, raw)
        return Response({'filters': filters, 'interpretation': interpretation})

    def _parse_with_llm(self, raw: str, locale: str):
        """Return the model's tool-call args dict, or ``None`` on any failure."""
        if not os.environ.get('OPENROUTER_API_KEY'):
            return None
        try:
            from langchain_core.messages import HumanMessage, SystemMessage
            from .llm import make_openrouter_chat

            chat = make_openrouter_chat(
                streaming=False, max_tokens=512, x_title='ILM Shamela Library',
            ).bind_tools([ASSIST_FILTER_TOOL], tool_choice='set_library_filters')
            response = chat.invoke([
                SystemMessage(content=ASSIST_SYSTEM_PROMPT),
                HumanMessage(content=f'User locale: {locale}\nQuery: {raw}'),
            ])
            calls = getattr(response, 'tool_calls', None) or []
            if not calls:
                return None
            args = calls[0].get('args')
            # A malformed tool call (args missing / not an object / empty) is
            # treated as a parse failure so the caller takes the explicit
            # degraded path (plain search + ``degraded_reason``) instead of
            # silently returning an empty, unfiltered filter set.
            return args if isinstance(args, dict) and args else None
        except Exception:  # noqa: BLE001 — any LLM/transport error degrades to plain search
            logger.exception('[ASSIST] natural-language parse failed')
            return None

    def _resolve(self, parsed: Dict, raw: str) -> Tuple[Dict, str | None]:
        """Map the model's raw guesses onto validated, canonical filter values."""
        # Facet guesses that don't resolve to a real DB value are folded back
        # into the free-text query rather than emitted as a filter that would
        # match nothing and silently zero the result set (cf. apply_document_filters).
        extra_terms: List[str] = []
        authors = self._resolve_names(parsed.get('authors'), Author, extra_terms)
        categories = self._resolve_names(parsed.get('categories'), Category, extra_terms)
        languages = self._resolve_languages(parsed.get('languages'))

        mode = parsed.get('mode')
        if mode not in VALID_CORPUS_SEARCH_MODES:
            mode = 'hybrid'

        terms = (parsed.get('search_terms') or '').strip()
        if extra_terms:
            terms = ' '.join(part for part in [terms, *extra_terms] if part).strip()

        filters = {
            'q': terms,
            'mode': mode,
            'authors': authors,
            'categories': categories,
            'languages': languages,
            'dateFrom': _valid_iso_date(parsed.get('date_from')),
            'dateTo': _valid_iso_date(parsed.get('date_to')),
        }
        interpretation = (parsed.get('interpretation') or '').strip() or None
        return filters, interpretation

    @staticmethod
    def _resolve_names(values, model, extra_terms: List[str]) -> List[str]:
        """Resolve model-emitted names to canonical ``model.name`` values.

        Unresolved names are appended to ``extra_terms`` (folded into free text).
        Runs a single query for all guesses (instead of one per name) and maps
        each guess to its first name-ordered match in Python.
        """
        names = [n for n in ((v or '').strip() for v in (values or [])) if n]
        if not names:
            return []
        # One OR'd query for every guess (note: module-level ``Q`` is the
        # elasticsearch_dsl one — use ``DjangoQ`` for the ORM), then map each
        # guess to its first name-ordered candidate. icontains is a
        # case-insensitive substring match, mirrored here by ``in``/``lower()``.
        lookup = DjangoQ()
        for name in names:
            lookup |= DjangoQ(name__icontains=name)
        candidates = list(
            model.objects.filter(lookup)
            .order_by('name')
            .values_list('name', flat=True)
            .distinct()
        )
        resolved: List[str] = []
        seen = set()
        for name in names:
            needle = name.lower()
            match = next((c for c in candidates if needle in c.lower()), None)
            if match:
                if match not in seen:
                    seen.add(match)
                    resolved.append(match)
            else:
                extra_terms.append(name)
        return resolved

    @staticmethod
    def _resolve_languages(values) -> List[str]:
        """Keep only language codes that exist on some document (case-insensitive).

        The known-language set only changes on upload, so it is cached briefly to
        avoid a distinct-scan of the documents table on every assist request.
        """
        if not values:
            return []
        known = cache.get(_ASSIST_LANGUAGES_CACHE_KEY)
        if known is None:
            known = {
                (lang or '').lower(): lang
                for lang in Document.objects.exclude(language__isnull=True)
                .exclude(language='')
                .values_list('language', flat=True)
                .distinct()
            }
            cache.set(_ASSIST_LANGUAGES_CACHE_KEY, known, 300)
        out: List[str] = []
        seen = set()
        for value in values:
            canonical = known.get((value or '').strip().lower())
            if canonical and canonical not in seen:
                seen.add(canonical)
                out.append(canonical)
        return out


class DocumentStatusView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, doc_id):
        try:
            document = Document.objects.get(id=doc_id)
            status_info = {
                'document_id': document.id,
                'title': document.title,
                'uploaded_at': document.uploaded_at,
                'processed': document.processed,
                'processing_status': document.processing_status,
                'processing_error': document.processing_error,
                'processing_attempts': document.processing_attempts,
                'processing_started_at': document.processing_started_at,
                'processing_completed_at': document.processing_completed_at,
                'has_content': bool(document.content),
                'content_length': len(document.content) if document.content else 0,
                'language': document.language,
                'semantic_vector_dimensions': len(document.semantic_vector or []),
                'file_name': document.file.name if document.file else None,
                'file_size': document.file.size if document.file else 0,
            }

            try:
                es = connections.get_connection()
                index_name = DocumentIndex._index._name
                result = es.get(index=index_name, id=document.id)
                status_info['elasticsearch'] = {
                    'indexed': True,
                    'index_name': index_name,
                    'document_id': result.get('_id'),
                    'found': result.get('found', False),
                }
            except Exception as exc:
                status_info['elasticsearch'] = {
                    'indexed': False,
                    'error': str(exc),
                    'index_name': DocumentIndex._index._name,
                }

            return Response(status_info, status=status.HTTP_200_OK)

        except Document.DoesNotExist:
            return Response(
                {'error': f'Document with ID {doc_id} not found'},
                status=status.HTTP_404_NOT_FOUND,
            )
        except Exception as exc:
            logger.error('[STATUS] Error checking document status: %s', str(exc), exc_info=True)
            return Response(
                {'error': f'Error checking document status: {str(exc)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class DocumentContentPagesView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        try:
            document = Document.objects.get(id=pk)

            page = int(request.query_params.get('page', 1))
            page_size = int(request.query_params.get('page_size', 1))

            edition = document.primary_edition

            if document.has_layout:
                # PDF-overlay mode: pages come from chunks carrying OCR geometry
                # and a rendered page image (empty picture-only pages included).
                chunks = (
                    DocumentChunk.objects.filter(document=document)
                    .order_by('page_number')
                    .only('page_number', 'content', 'layout', 'page_image')
                )
                total_pages = chunks.count()
                if not total_pages:
                    return Response(
                        {'error': 'Document has no content available'},
                        status=status.HTTP_404_NOT_FOUND,
                    )
                start_idx = (page - 1) * page_size
                pages = [
                    {
                        'page_number': chunk.page_number,
                        'content': chunk.content,
                        'image_url': (
                            request.build_absolute_uri(chunk.page_image.url)
                            if chunk.page_image
                            else None
                        ),
                        'layout': chunk.layout,
                        'printed_ref': (
                            edition.printed_ref(chunk.page_number) if edition else None
                        ),
                    }
                    for chunk in chunks[start_idx:start_idx + page_size]
                ]
            else:
                if not document.content:
                    return Response(
                        {'error': 'Document has no content available'},
                        status=status.HTTP_404_NOT_FOUND,
                    )

                all_pages = split_document_content_into_pages(document.content)
                total_pages = len(all_pages)
                start_idx = (page - 1) * page_size
                pages = [
                    {
                        **page_dict,
                        'printed_ref': (
                            edition.printed_ref(page_dict.get('page_number'))
                            if edition else None
                        ),
                    }
                    for page_dict in all_pages[start_idx:start_idx + page_size]
                ]

            return Response(
                {
                    'total_pages': total_pages,
                    'current_page': page,
                    'page_size': page_size,
                    'pages': pages,
                },
                status=status.HTTP_200_OK,
            )
        except Document.DoesNotExist:
            return Response(
                {'error': f'Document with ID {pk} not found'},
                status=status.HTTP_404_NOT_FOUND,
            )
        except Exception as exc:
            logger.error('[PAGES] Error getting document pages: %s', str(exc), exc_info=True)
            return Response(
                {'error': f'Error getting document pages: {str(exc)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


SEMANTIC_FALLBACK_THRESHOLD = 0.3
SEMANTIC_FALLBACK_TOP_K = 20
DEFAULT_SEMANTIC_THRESHOLD = 0.5
LEXICAL_WEIGHT = 0.60
SEMANTIC_WEIGHT = 0.40
VALID_SEARCH_MODES = ('exact', 'similar', 'semantic', 'mix')


def _es_lexical_stage(document, query: str, pages: List[Dict], *, phrase: bool) -> List[Dict]:
    """Run the Elasticsearch lexical stage and return ``[{page_number, snippet,
    es_score}, ...]``.

    ``phrase=True`` uses ``match_phrase`` (literal contiguous phrase → "exact"
    mode); otherwise the fuzzy ``match`` query (``fuzziness:'AUTO'`` → "similar"
    / "mix"). Returns an empty list if ES is unavailable so callers can degrade.
    """
    search = DocumentIndex.search()
    search = search.filter('ids', values=[str(document.id)])
    # `content.exact` (arabic_exact analyzer) makes both stages tashkeel- and
    # alef-variant-insensitive without stemming; highlight fragments still come
    # from the original `_source.content` text.
    if phrase:
        search = search.query('match_phrase', **{'content.exact': {'query': query}})
    else:
        search = search.query(
            'match',
            **{'content.exact': {'query': query, 'fuzziness': 'AUTO', 'operator': 'and'}},
        )
    search = search.highlight(
        'content.exact',
        fragment_size=150,
        number_of_fragments=50,
        pre_tags=['<mark>'],
        post_tags=['</mark>'],
        max_analyzed_offset=1000000,
    )
    try:
        response = search.execute()
    except Exception as exc:  # noqa: BLE001
        # Elasticsearch down or index missing: degrade rather than failing the
        # whole search.
        logger.warning('[DOC_SEARCH] ES lexical stage unavailable: %s', exc)
        return []

    lexical_matches: List[Dict] = []
    if response is not None and response.hits:
        hit = response.hits[0]
        es_score = float(getattr(hit.meta, 'score', 0.0) or 0.0)
        if 'highlight' in hit.meta:
            # Dotted field names can't be attribute-accessed on the AttrDict.
            for snippet in hit.meta.highlight.to_dict().get('content.exact', []):
                plain_snippet = re.sub(r'</?mark>', '', snippet)
                page_number = 1
                for page in pages:
                    if plain_snippet and plain_snippet in page['content']:
                        page_number = page['page_number']
                        break
                lexical_matches.append({
                    'page_number': page_number,
                    'snippet': snippet,
                    'es_score': es_score,
                })
    return lexical_matches


def _semantic_stage(document, query: str):
    """Per-chunk semantic scoring. Returns ``(has_semantic, query_vector,
    page_semantic, chunks)`` where ``page_semantic`` maps page → best cosine."""
    chunks = list(
        DocumentChunk.objects.filter(document=document)
        .order_by('chunk_index')
        .values('chunk_index', 'page_number', 'content', 'embedding')
    )
    has_semantic = bool(chunks)
    query_vector: List[float] = []
    page_semantic: Dict[int, float] = {}
    if has_semantic:
        query_vector = build_embedding(query, task_type="RETRIEVAL_QUERY")
        if query_vector:
            for chunk in chunks:
                emb = chunk['embedding'] or []
                sim = max(0.0, cosine_similarity(query_vector, emb))
                chunk['_sim'] = sim  # cache per-chunk so semantic/mix callers don't recompute
                pn = chunk['page_number']
                page_semantic[pn] = max(page_semantic.get(pn, 0.0), sim)
    return has_semantic, query_vector, page_semantic, chunks


def _empty_result(query: str, has_semantic: bool = False) -> Dict:
    return {'matches': [], 'total_matches': 0, 'query': query, 'has_semantic': has_semantic}


def _best_semantic_pages(chunks: List[Dict], min_sim: float) -> List[Dict]:
    """Best-per-page semantic matches from the cosine cached on each chunk
    (``_sim``, set by ``_semantic_stage``). Chunks scoring below ``min_sim`` are
    dropped; the rest are collapsed to the top page score and returned sorted by
    descending semantic score. Shared by ``semantic`` mode and the ``mix``
    no-lexical fallback so the match/snippet/scoring shape never drifts."""
    best_by_page: Dict[int, Dict] = {}
    for chunk in chunks:
        sim = chunk.get('_sim', 0.0)  # reuse the cosine computed in _semantic_stage
        if sim < min_sim:
            continue
        pn = chunk['page_number']
        if pn not in best_by_page or sim > best_by_page[pn]['score_final']:
            best_by_page[pn] = {
                'page_number': pn,
                'snippet': chunk['content'][:300].replace('\n', ' '),
                'score': sim,
                'score_lexical': 0.0,
                'score_semantic': round(sim, 4),
                'score_final': round(sim, 4),
            }
    return sorted(best_by_page.values(), key=lambda r: r['score_final'], reverse=True)


def search_within_document(
    document,
    query: str,
    *,
    mode: str = 'mix',
    threshold: float | None = None,
    top_k: int | None = None,
) -> Dict:
    """In-document search with four selectable modes.

    - ``exact``    — ES ``match_phrase`` (literal contiguous phrase), lexical
      ranking only; ``score_semantic`` is ``None``.
    - ``similar``  — ES fuzzy ``match`` (``fuzziness:'AUTO'``), lexical ranking
      only; no semantic blend or fallback.
    - ``semantic`` — per-chunk cosine only; pages with ``sim >= threshold`` are
      kept, ranked by semantic score.
    - ``mix``      — hybrid ``0.60*lexical + 0.40*semantic`` over lexical hits,
      with semantic-only pages above ``threshold`` merged in; pure-semantic
      fallback when there are no lexical hits.

    When ``threshold`` is ``None`` the strict paths (``semantic`` mode and the
    ``mix`` semantic-merge) default to ``0.5`` and the ``mix`` no-lexical
    fallback to a lenient ``0.3``; an explicit ``threshold`` applies to all
    paths uniformly. When ``top_k`` is given the match list is capped.

    Returns ``{'matches': [...], 'total_matches': int, 'query': str,
    'has_semantic': bool}``. Shared with the assistant's ``search_in_document``
    tool (default ``mode='mix'``) so scoring never drifts between callers.
    """
    if mode not in VALID_SEARCH_MODES:
        mode = 'mix'
    # The strict bar (semantic mode + the mix semantic-merge) defaults to 0.5;
    # the no-lexical-hits fallback defaults to a more lenient 0.3 so users still
    # get plausible pages when ES returns nothing. An explicit user-supplied
    # threshold overrides BOTH, so the inclusion rule is identical whether or
    # not a lexical hit happened.
    strict_threshold = DEFAULT_SEMANTIC_THRESHOLD if threshold is None else threshold
    fallback_threshold = SEMANTIC_FALLBACK_THRESHOLD if threshold is None else threshold

    content = document.content or ''
    pages = split_document_content_into_pages(content)

    # ---- Pure semantic mode ----
    if mode == 'semantic':
        has_semantic, query_vector, _page_semantic, chunks = _semantic_stage(document, query)
        if not has_semantic or not query_vector:
            return _empty_result(query, has_semantic)
        results = _best_semantic_pages(chunks, strict_threshold)
        if top_k:
            results = results[:top_k]
        return {'matches': results, 'total_matches': len(results), 'query': query, 'has_semantic': True}

    # ---- Lexical stage (exact / similar / mix) ----
    lexical_matches = _es_lexical_stage(document, query, pages, phrase=(mode == 'exact'))

    # ---- Lexical-only modes: no semantic blend or fallback ----
    if mode in ('exact', 'similar'):
        if not lexical_matches:
            return _empty_result(query, has_semantic=False)
        max_lexical = max(m['es_score'] for m in lexical_matches) or 1.0
        results = []
        for match in lexical_matches:
            norm_lex = match['es_score'] / max_lexical
            results.append({
                'page_number': match['page_number'],
                'snippet': match['snippet'],
                'score': match['es_score'],
                'score_lexical': round(norm_lex, 4),
                'score_semantic': None,
                'score_final': round(norm_lex, 4),
            })
        results.sort(key=lambda r: r['score_final'], reverse=True)
        if top_k:
            results = results[:top_k]
        return {'matches': results, 'total_matches': len(results), 'query': query, 'has_semantic': False}

    # ---- mix: hybrid lexical + semantic ----
    has_semantic, query_vector, page_semantic, chunks = _semantic_stage(document, query)

    if lexical_matches:
        max_lexical = max(m['es_score'] for m in lexical_matches) or 1.0
        results = []
        seen_pages = set()
        for match in lexical_matches:
            norm_lex = match['es_score'] / max_lexical
            pn = match['page_number']
            sem = page_semantic.get(pn, 0.0)
            if has_semantic and query_vector:
                final = LEXICAL_WEIGHT * norm_lex + SEMANTIC_WEIGHT * sem
            else:
                final = norm_lex
                sem = None  # signal: no chunks
            seen_pages.add(pn)
            results.append({
                'page_number': pn,
                'snippet': match['snippet'],
                'score': match['es_score'],
                'score_lexical': round(norm_lex, 4),
                'score_semantic': round(sem, 4) if sem is not None else None,
                'score_final': round(final, 4),
            })
        # Merge semantic-only pages above threshold not already surfaced lexically.
        if has_semantic and query_vector:
            page_content = {p['page_number']: p['content'] for p in pages}
            for pn, sem in page_semantic.items():
                if pn in seen_pages or sem < strict_threshold:
                    continue
                results.append({
                    'page_number': pn,
                    'snippet': page_content.get(pn, '')[:300].replace('\n', ' '),
                    'score': sem,
                    'score_lexical': 0.0,
                    'score_semantic': round(sem, 4),
                    'score_final': round(SEMANTIC_WEIGHT * sem, 4),
                })
        results.sort(key=lambda r: r['score_final'], reverse=True)
        if top_k:
            results = results[:top_k]
        return {'matches': results, 'total_matches': len(results), 'query': query, 'has_semantic': has_semantic}

    # ---- mix with no lexical hits → pure semantic fallback (lenient bar) ----
    if not has_semantic or not query_vector:
        return _empty_result(query, has_semantic)
    sem_results = _best_semantic_pages(chunks, fallback_threshold)
    sem_results = sem_results[:(top_k or SEMANTIC_FALLBACK_TOP_K)]
    return {'matches': sem_results, 'total_matches': len(sem_results), 'query': query, 'has_semantic': True}


class DocumentInDocumentSearchView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]
    throttle_scope = 'search'

    def get(self, request, pk):
        query = request.query_params.get('q', '').strip()
        if not query:
            return Response(
                {'error': 'Query parameter "q" is required'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        mode = request.query_params.get('mode', 'mix').strip().lower()
        if mode not in VALID_SEARCH_MODES:
            return Response(
                {'error': f'Invalid mode. Choose one of: {", ".join(VALID_SEARCH_MODES)}'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        threshold: float | None = None
        raw_threshold = request.query_params.get('threshold')
        if raw_threshold is not None:
            try:
                threshold = max(0.0, min(1.0, float(raw_threshold)))
            except (TypeError, ValueError):
                threshold = None  # tolerate bad input → mode default

        try:
            try:
                document = Document.objects.get(id=pk)
            except Document.DoesNotExist:
                return Response(
                    {'error': f'Document with ID {pk} not found'},
                    status=status.HTTP_404_NOT_FOUND,
                )
            result = search_within_document(document, query, mode=mode, threshold=threshold)
            return Response(result, status=status.HTTP_200_OK)
        except Exception as exc:
            logger.error('[DOC_SEARCH] Error: %s', str(exc), exc_info=True)
            return Response({'error': str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class OCREngineListView(views.APIView):
    """
    List available OCR engines with their current availability.
    Response schema: [{id, label, available}]
    """
    permission_classes = [IsAuthenticatedReadOnlyOrEditor]
    _CACHE_KEY = 'ocr_engines_health_v1'
    _CACHE_TTL = 30  # seconds

    def get(self, request):
        engines = cache.get(self._CACHE_KEY)
        if engines is None:
            engines = ocr_registry.list_engines()
            cache.set(self._CACHE_KEY, engines, self._CACHE_TTL)
        # Prepend the two non-sidecar meta-options that the UI needs to offer.
        meta_options = [
            {'id': Document.OCREngine.AUTO, 'label': 'Auto (recommended)', 'available': True},
            {'id': Document.OCREngine.NONE, 'label': 'No OCR', 'available': True},
        ]
        return Response(meta_options + engines, status=status.HTTP_200_OK)


class AuthorListView(generics.ListAPIView):
    queryset = Author.objects.all()
    serializer_class = AuthorListSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = Author.objects.all()
        search_query = self.request.query_params.get('search', '').strip()
        if search_query:
            queryset = queryset.filter(name__icontains=search_query)

        ordering = self.request.query_params.get('ordering', 'name')
        allowed_orderings = ['name', '-name', 'created_at', '-created_at', 'updated_at', '-updated_at']
        if ordering in allowed_orderings:
            queryset = queryset.order_by(ordering)
        else:
            queryset = queryset.order_by('name')
        return queryset

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['request'] = self.request
        return context


class AuthorDetailView(generics.RetrieveAPIView):
    queryset = Author.objects.prefetch_related('documents').all()
    serializer_class = AuthorDetailSerializer
    permission_classes = [permissions.IsAuthenticated]
    lookup_field = 'pk'

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['request'] = self.request
        return context


class CategoryListView(generics.ListAPIView):
    queryset = Category.objects.all()
    serializer_class = CategoryListSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = Category.objects.all()
        search_query = self.request.query_params.get('search', '').strip()
        if search_query:
            queryset = queryset.filter(name__icontains=search_query)

        ordering = self.request.query_params.get('ordering', 'name')
        allowed_orderings = ['name', '-name', 'created_at', '-created_at', 'updated_at', '-updated_at']
        if ordering in allowed_orderings:
            queryset = queryset.order_by(ordering)
        else:
            queryset = queryset.order_by('name')
        return queryset

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['request'] = self.request
        return context

class DocumentByCountryView(generics.ListAPIView):
    """
    List books (documents) for a specific country (author's nationality),
    paginated and sorted by author name.
    """
    serializer_class = DocumentListSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        country = self.kwargs.get('country')
        queryset = Document.objects.filter(
            authors__nationality__iexact=country
        ).prefetch_related('authors', 'alternate_names', 'categories')
        
        return queryset.order_by('authors__name').distinct()


class CountryDocumentStatsView(views.APIView):
    """
    Return aggregated document counts per country from the denormalized
    CountryDocumentCount table.

    Response: [{ country, document_count }, ...]
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from .models import CountryDocumentCount

        rows = CountryDocumentCount.objects.all().values(
            'country', 'document_count',
        )
        return Response(list(rows), status=status.HTTP_200_OK)

