import logging
import re
from datetime import datetime
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


def build_multi_match_query(query: str) -> Q:
    return Q(
        'multi_match',
        query=query,
        fields=[
            'title^2',
            'title.arabic^2',
            'authors^1.5',
            'authors.arabic^1.5',
            'categories^1.5',
            'description^1.2',
            'description.arabic^1.2',
            'alternate_names^1.3',
            'alternate_names.arabic^1.3',
            'content',
            'content.arabic',
        ],
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

    return queryset


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

        document = serializer.save()

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
    queryset = Document.objects.prefetch_related('authors', 'alternate_names', 'categories').all()
    serializer_class = DocumentDetailSerializer
    permission_classes = [IsAuthenticatedReadOnlyOrEditor]

    def get_throttles(self):
        self.throttle_scope = 'upload' if self.request.method not in permissions.SAFE_METHODS else 'search'
        return super().get_throttles()


class DocumentSearchView(generics.ListAPIView):
    """
    Search documents using lexical Elasticsearch score + semantic reranking.
    """

    serializer_class = DocumentListSerializer
    permission_classes = [permissions.IsAuthenticated]
    throttle_scope = 'search'

    def _execute_search(self, query: str) -> Tuple[List[Document], Dict[int, Dict[str, object]]]:
        query_vector = build_embedding(query, task_type="RETRIEVAL_QUERY")
        es = connections.get_connection()
        index_name = DocumentIndex._index._name

        bm25_query = {
            "multi_match": {
                "query": query,
                "fields": [
                    "title^2", "title.arabic^2",
                    "authors^1.5", "authors.arabic^1.5",
                    "categories^1.5",
                    "description^1.2", "description.arabic^1.2",
                    "alternate_names^1.3", "alternate_names.arabic^1.3",
                    "content", "content.arabic",
                ],
                "fuzziness": "AUTO",
                "type": "best_fields",
            }
        }

        body: Dict = {
            "size": 200,
            "query": bm25_query,
            "highlight": {
                "fields": {
                    "title": {},
                    "description": {},
                    "content": {},
                    "alternate_names": {},
                }
            },
        }

        use_knn = bool(query_vector and len(query_vector) == VECTOR_DIMENSIONS)
        if use_knn:
            body["knn"] = {
                "field": "semantic_vector",
                "query_vector": query_vector,
                "k": 50,
                "num_candidates": 200,
            }
            body["rank"] = {"rrf": {"window_size": 200, "rank_constant": 60}}

        try:
            raw = es.search(index=index_name, body=body)
        except Exception as exc:
            logger.error("[SEARCH] ES kNN+RRF request failed: %s", exc, exc_info=True)
            return [], {}

        hits = raw.get("hits", {}).get("hits", [])
        if not hits:
            return [], {}

        hit_by_id: Dict[int, dict] = {}
        rrf_scores: Dict[int, float] = {}
        document_ids: List[int] = []
        for hit in hits:
            doc_id = int(hit["_id"])
            hit_by_id[doc_id] = hit
            rrf_scores[doc_id] = float(hit.get("_score") or 0.0)
            document_ids.append(doc_id)

        base_queryset = Document.objects.prefetch_related(
            'authors', 'alternate_names', 'categories'
        ).filter(id__in=document_ids)
        base_queryset = apply_document_filters(base_queryset, self.request)
        docs = list(base_queryset)
        if not docs:
            return [], {}

        max_score = max(rrf_scores.values()) if rrf_scores else 1.0
        metadata: Dict[int, Dict] = {}

        for doc in docs:
            raw_score = rrf_scores.get(doc.id, 0.0)
            norm_score = raw_score / max_score if max_score > 0 else 0.0

            highlight_fields: List[str] = []
            hit = hit_by_id.get(doc.id, {})
            hl = hit.get("highlight", {})
            highlight_fields = list(hl.keys())

            method = "rrf+knn" if use_knn else "bm25"
            metadata[doc.id] = {
                "score_lexical": round(norm_score, 4),
                "score_semantic": round(norm_score, 4) if use_knn else 0.0,
                "score_final": round(norm_score, 4),
                "explanations": {
                    "matched_fields": highlight_fields,
                    "method": method,
                },
            }

        ordered_docs = sorted(docs, key=lambda d: metadata[d.id]["score_final"], reverse=True)
        return ordered_docs, metadata

    def get_queryset(self):
        query = self.request.query_params.get('q', '').strip()
        if not query:
            return Document.objects.none()
        try:
            ordered_docs, metadata = self._execute_search(query)
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
            return self.get_paginated_response(data)
        return Response(data)


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
            if not document.content:
                return Response(
                    {'error': 'Document has no content available'},
                    status=status.HTTP_404_NOT_FOUND,
                )

            pages = split_document_content_into_pages(document.content)

            page = int(request.query_params.get('page', 1))
            page_size = int(request.query_params.get('page_size', 1))

            total_pages = len(pages)
            start_idx = (page - 1) * page_size
            end_idx = start_idx + page_size

            return Response(
                {
                    'total_pages': total_pages,
                    'current_page': page,
                    'page_size': page_size,
                    'pages': pages[start_idx:end_idx],
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


def search_within_document(document, query: str, top_k: int | None = None) -> Dict:
    """Hybrid in-document search: ES lexical/fuzzy + per-chunk semantic, merged
    as ``0.60*lexical + 0.40*semantic``, with a pure-semantic fallback when
    there are no lexical hits.

    Returns ``{'matches': [...], 'total_matches': int, 'query': str,
    'has_semantic': bool}``. When ``top_k`` is given the match list is capped.

    Extracted from ``DocumentInDocumentSearchView`` so the assistant's
    ``search_in_document`` tool can reuse the exact same scoring (the view now
    calls this; the scoring must not drift between the two callers).
    """
    content = document.content or ''
    pages = split_document_content_into_pages(content)

    # --- Stage 1: ES lexical/fuzzy search ---
    search = DocumentIndex.search()
    search = search.filter('ids', values=[str(document.id)])
    search = search.query(
        'match',
        content={'query': query, 'fuzziness': 'AUTO', 'operator': 'and'},
    )
    search = search.highlight(
        'content',
        fragment_size=150,
        number_of_fragments=50,
        pre_tags=['<mark>'],
        post_tags=['</mark>'],
        max_analyzed_offset=1000000,
    )
    try:
        response = search.execute()
    except Exception as exc:  # noqa: BLE001
        # Elasticsearch down or index missing: degrade to the semantic stage
        # rather than failing the whole search.
        logger.warning('[DOC_SEARCH] ES lexical stage unavailable, using semantic only: %s', exc)
        response = None

    lexical_matches: List[Dict] = []
    es_score = 0.0
    if response is not None and response.hits:
        hit = response.hits[0]
        es_score = float(getattr(hit.meta, 'score', 0.0) or 0.0)
        if 'highlight' in hit.meta:
            for snippet in hit.meta.highlight.content:
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

    # --- Stage 2: Per-chunk semantic scoring ---
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
                pn = chunk['page_number']
                page_semantic[pn] = max(page_semantic.get(pn, 0.0), sim)

    # --- Stage 3: Merge & hybrid score ---
    if lexical_matches:
        max_lexical = max(m['es_score'] for m in lexical_matches) or 1.0
        results: List[Dict] = []
        for match in lexical_matches:
            norm_lex = match['es_score'] / max_lexical
            sem = page_semantic.get(match['page_number'], 0.0)
            if has_semantic and query_vector:
                final = 0.60 * norm_lex + 0.40 * sem
            else:
                final = norm_lex
                sem = None  # signal: no chunks
            results.append({
                'page_number': match['page_number'],
                'snippet': match['snippet'],
                'score': match['es_score'],
                'score_lexical': round(norm_lex, 4),
                'score_semantic': round(sem, 4) if sem is not None else None,
                'score_final': round(final, 4),
            })
        results.sort(key=lambda r: r['score_final'], reverse=True)
        if top_k:
            results = results[:top_k]
        return {
            'matches': results,
            'total_matches': len(results),
            'query': query,
            'has_semantic': has_semantic,
        }

    # --- Stage 4: Pure semantic fallback (0 lexical hits) ---
    if not has_semantic or not query_vector:
        return {'matches': [], 'total_matches': 0, 'query': query, 'has_semantic': has_semantic}

    sem_results = []
    for chunk in chunks:
        emb = chunk['embedding'] or []
        sim = max(0.0, cosine_similarity(query_vector, emb))
        if sim >= SEMANTIC_FALLBACK_THRESHOLD:
            pn = chunk['page_number']
            snippet = chunk['content'][:300].replace('\n', ' ')
            sem_results.append({
                'page_number': pn,
                'snippet': snippet,
                'score': sim,
                'score_lexical': 0.0,
                'score_semantic': round(sim, 4),
                'score_final': round(sim, 4),
            })
    sem_results.sort(key=lambda r: r['score_final'], reverse=True)
    sem_results = sem_results[:(top_k or SEMANTIC_FALLBACK_TOP_K)]
    return {
        'matches': sem_results,
        'total_matches': len(sem_results),
        'query': query,
        'has_semantic': True,
    }


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

        try:
            try:
                document = Document.objects.get(id=pk)
            except Document.DoesNotExist:
                return Response(
                    {'error': f'Document with ID {pk} not found'},
                    status=status.HTTP_404_NOT_FOUND,
                )
            result = search_within_document(document, query)
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

