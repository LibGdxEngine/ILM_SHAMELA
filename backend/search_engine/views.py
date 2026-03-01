import logging
import re
from datetime import datetime
from typing import Dict, List, Tuple

from django.db.models import Q as DjangoQ
from elasticsearch_dsl import Q
from elasticsearch_dsl import connections
from rest_framework import generics, permissions, status, views
from rest_framework.response import Response

from .documents import DocumentIndex
from .models import Author, Category, Document
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
        search = DocumentIndex.search()
        search = search.query(build_multi_match_query(query))
        search = search.highlight('title', 'description', 'content', 'alternate_names')
        search = search.extra(size=200)

        response = search.execute()
        hits = list(response)
        if not hits:
            return [], {}

        hit_by_id = {}
        lexical_scores = {}
        document_ids = []
        for hit in hits:
            doc_id = int(hit.meta.id)
            hit_by_id[doc_id] = hit
            lexical_scores[doc_id] = float(getattr(hit.meta, 'score', 0.0) or 0.0)
            document_ids.append(doc_id)

        base_queryset = Document.objects.prefetch_related('authors', 'alternate_names', 'categories').filter(
            id__in=document_ids
        )
        base_queryset = apply_document_filters(base_queryset, self.request)
        docs = list(base_queryset)
        if not docs:
            return [], {}

        query_vector = build_embedding(query, task_type="RETRIEVAL_QUERY")
        max_lexical = max(lexical_scores.values()) if lexical_scores else 1.0
        metadata = {}

        for doc in docs:
            lexical_raw = lexical_scores.get(doc.id, 0.0)
            lexical_score = lexical_raw / max_lexical if max_lexical > 0 else 0.0
            semantic_score = max(
                0.0,
                cosine_similarity(query_vector, doc.semantic_vector or []),
            )
            final_score = 0.75 * lexical_score + 0.25 * semantic_score

            highlight_fields = []
            hit = hit_by_id.get(doc.id)
            if hit and hasattr(hit.meta, 'highlight'):
                highlight_data = hit.meta.highlight.to_dict() if hasattr(hit.meta.highlight, 'to_dict') else {}
                highlight_fields = list(highlight_data.keys())

            metadata[doc.id] = {
                'score_lexical': round(lexical_score, 4),
                'score_semantic': round(semantic_score, 4),
                'score_final': round(final_score, 4),
                'explanations': {
                    'matched_fields': highlight_fields,
                    'weights': {'lexical': 0.75, 'semantic': 0.25},
                },
            }

        ordered_docs = sorted(docs, key=lambda doc: metadata[doc.id]['score_final'], reverse=True)
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
                content = document.content or ''
            except Document.DoesNotExist:
                return Response(
                    {'error': f'Document with ID {pk} not found'},
                    status=status.HTTP_404_NOT_FOUND,
                )

            pages = split_document_content_into_pages(content)
            search = DocumentIndex.search()
            search = search.filter('ids', values=[pk])
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

            response = search.execute()
            matches = []
            if response.hits:
                hit = response.hits[0]
                if 'highlight' in hit.meta:
                    for snippet in hit.meta.highlight.content:
                        plain_snippet = re.sub(r'</?mark>', '', snippet)
                        page_number = 1
                        for page in pages:
                            if plain_snippet and plain_snippet in page['content']:
                                page_number = page['page_number']
                                break

                        matches.append(
                            {
                                'page_number': page_number,
                                'snippet': snippet,
                                'score': hit.meta.score,
                            }
                        )

            return Response(
                {'matches': matches, 'total_matches': len(matches), 'query': query},
                status=status.HTTP_200_OK,
            )
        except Exception as exc:
            logger.error('[DOC_SEARCH] Error: %s', str(exc), exc_info=True)
            return Response({'error': str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


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
