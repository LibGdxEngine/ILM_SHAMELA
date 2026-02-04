import logging
import re
from datetime import datetime
from django.db.models import Q as DjangoQ
from rest_framework import generics, status, permissions, views
from rest_framework.response import Response
from elasticsearch_dsl import Q
from elasticsearch_dsl import connections
from .models import Document
from .serializers import DocumentSerializer, DocumentListSerializer, DocumentDetailSerializer, DocumentPageSerializer
from .tasks import process_document_task
from .documents import DocumentIndex

logger = logging.getLogger(__name__)


class DocumentListCreateView(generics.ListCreateAPIView):
    """
    List all documents or create a new document.

    When a file is uploaded, it saves to S3 and creates the DB record.
    Text processing is triggered asynchronously via Celery task.
    """
    queryset = Document.objects.all()
    serializer_class = DocumentSerializer
    permission_classes = [permissions.AllowAny]

    def get_serializer_class(self):
        """Use list serializer for GET requests, full serializer for POST."""
        if self.request.method == 'GET':
            return DocumentListSerializer
        return DocumentSerializer

    def get_queryset(self):
        """Apply filtering to queryset."""
        queryset = Document.objects.all()

        # Filter by authors (supports multiple, comma-separated)
        authors = self.request.query_params.get('authors', None)
        if authors:
            author_list = [a.strip() for a in authors.split(',') if a.strip()]
            if author_list:
                queryset = queryset.filter(authors__overlap=author_list)

        # Filter by categories (supports multiple, comma-separated)
        categories = self.request.query_params.get('categories', None)
        if categories:
            category_list = [c.strip()
                             for c in categories.split(',') if c.strip()]
            if category_list:
                queryset = queryset.filter(categories__overlap=category_list)

        # Filter by language
        language = self.request.query_params.get('language', None)
        if language:
            queryset = queryset.filter(language=language)

        # Filter by date range
        date_from = self.request.query_params.get('date_from', None)
        if date_from:
            try:
                date_from_obj = datetime.strptime(date_from, '%Y-%m-%d').date()
                queryset = queryset.filter(uploaded_at__gte=date_from_obj)
            except ValueError:
                pass

        date_to = self.request.query_params.get('date_to', None)
        if date_to:
            try:
                date_to_obj = datetime.strptime(date_to, '%Y-%m-%d').date()
                queryset = queryset.filter(uploaded_at__lte=date_to_obj)
            except ValueError:
                pass

        # Search query (if provided, use Elasticsearch)
        search_query = self.request.query_params.get('q', '').strip()
        if search_query:
            try:
                search = DocumentIndex.search()
                multi_match = Q(
                    'multi_match',
                    query=search_query,
                    fields=[
                        'title^2',
                        'title.arabic^2',
                        'authors^1.5',
                        'authors.arabic^1.5',
                        'categories^1.5',
                        'content',
                        'content.arabic'
                    ],
                    fuzziness='AUTO',
                    type='best_fields'
                )
                search = search.query(multi_match)
                response = search.execute()
                document_ids = [int(hit.meta.id) for hit in response]
                queryset = queryset.filter(id__in=document_ids)
                # Preserve Elasticsearch order
                id_order = {doc_id: idx for idx,
                            doc_id in enumerate(document_ids)}
                queryset = sorted(
                    list(queryset), key=lambda doc: id_order.get(doc.id, float('inf')))
            except Exception as e:
                logger.error(
                    f"[LIST] Elasticsearch search failed: {str(e)}", exc_info=True)
                # Fallback to simple title/content search
                queryset = queryset.filter(
                    DjangoQ(title__icontains=search_query) |
                    DjangoQ(content__icontains=search_query)
                )

        return queryset

    def create(self, request, *args, **kwargs):
        """
        Override create to provide better error handling and logging.
        """
        logger.info("=" * 80)
        logger.info(f"POST request received for document upload")
        logger.info(f"Request scheme: {request.scheme}")
        logger.info(f"Request host: {request.get_host()}")
        logger.info(f"Request path: {request.path}")
        logger.info(
            f"Remote address: {request.META.get('REMOTE_ADDR', 'unknown')}")
        logger.info(f"Files in request: {list(request.FILES.keys())}")

        try:
            serializer = self.get_serializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            logger.info(
                f"Serializer validation passed for document: {request.data.get('title', 'Unknown')}")
            self.perform_create(serializer)
            headers = self.get_success_headers(serializer.data)
            logger.info(
                f"Document created successfully with ID: {serializer.data.get('id')}")
            logger.info("=" * 80)
            return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)
        except Exception as e:
            logger.error(f"Error in create method: {str(e)}", exc_info=True)
            logger.error("=" * 80)
            # Re-raise to let DRF handle it properly
            raise

    def perform_create(self, serializer):
        """
        Save the document and trigger async processing task.
        File will be uploaded to S3 automatically via FileField and DEFAULT_FILE_STORAGE setting.
        """
        try:
            document = serializer.save()
            logger.info(
                f"[UPLOAD] Document {document.id} created successfully")
            logger.info(f"[UPLOAD] Title: {document.title}")
            logger.info(
                f"[UPLOAD] File: {document.file.name if document.file else 'No file'}")
            logger.info(
                f"[UPLOAD] File size: {document.file.size if document.file else 0} bytes")
            logger.info(f"[UPLOAD] Uploaded at: {document.uploaded_at}")
            logger.info(
                f"[UPLOAD] Initial processed status: {document.processed}")

            # Trigger async Celery task to process the document
            try:
                task_result = process_document_task.delay(document.id)
                logger.info(
                    f"[UPLOAD] Celery task queued for document {document.id}")
                logger.info(f"[UPLOAD] Task ID: {task_result.id}")
                logger.info(f"[UPLOAD] Task state: {task_result.state}")
            except Exception as e:
                # If Celery is not available, log the error but don't fail the request
                # The document is already saved, so we can process it later
                logger.error(
                    f"[UPLOAD] Failed to queue Celery task for document {document.id}: {str(e)}", exc_info=True)
                logger.warning("[UPLOAD] Document saved but processing task could not be queued. "
                               "Make sure Celery worker is running.")
        except Exception as e:
            logger.error(
                f"[UPLOAD] Error creating document: {str(e)}", exc_info=True)
            raise


class DocumentDetailView(generics.RetrieveUpdateDestroyAPIView):
    """
    Retrieve, update or delete a document instance.
    """
    queryset = Document.objects.all()
    serializer_class = DocumentDetailSerializer
    permission_classes = [permissions.AllowAny]


class DocumentSearchView(generics.ListAPIView):
    """
    Search documents using Elasticsearch MultiMatch query.

    Query parameter:
    - q: Search query string
    - authors: Filter by authors (comma-separated)
    - categories: Filter by categories (comma-separated)
    - language: Filter by language
    """
    serializer_class = DocumentListSerializer
    permission_classes = [permissions.AllowAny]

    def get_queryset(self):
        """Return queryset filtered by Elasticsearch search results."""
        query = self.request.query_params.get('q', '').strip()

        if not query:
            return Document.objects.none()

        # Create Elasticsearch search using DocumentIndex
        search = DocumentIndex.search()

        # MultiMatch query with fuzziness
        # Search in both standard and Arabic fields to support Arabic text
        multi_match = Q(
            'multi_match',
            query=query,
            fields=[
                'title^2',           # Standard analyzer for title
                'title.arabic^2',    # Arabic analyzer for title
                'authors^1.5',        # Authors field
                'authors.arabic^1.5',  # Arabic analyzer for authors
                'categories^1.5',     # Categories field
                'content',           # Standard analyzer for content
                'content.arabic'     # Arabic analyzer for content
            ],
            fuzziness='AUTO',
            type='best_fields'
        )

        search = search.query(multi_match)

        # Execute search and get document IDs
        try:
            response = search.execute()
            logger.info(
                f"[SEARCH] Query: '{query}', Total hits: {response.hits.total.value}")
            document_ids = [int(hit.meta.id) for hit in response]
            logger.info(
                f"[SEARCH] Found {len(document_ids)} document(s): {document_ids}")

            # Return documents in the order returned by Elasticsearch
            documents = Document.objects.filter(id__in=document_ids)

            # Apply additional filters
            authors = self.request.query_params.get('authors', None)
            if authors:
                author_list = [a.strip()
                               for a in authors.split(',') if a.strip()]
                if author_list:
                    documents = documents.filter(authors__overlap=author_list)

            categories = self.request.query_params.get('categories', None)
            if categories:
                category_list = [c.strip()
                                 for c in categories.split(',') if c.strip()]
                if category_list:
                    documents = documents.filter(
                        categories__overlap=category_list)

            language = self.request.query_params.get('language', None)
            if language:
                documents = documents.filter(language=language)

            # Preserve Elasticsearch order
            id_order = {doc_id: idx for idx, doc_id in enumerate(document_ids)}
            return sorted(documents, key=lambda doc: id_order.get(doc.id, float('inf')))
        except Exception as e:
            # If Elasticsearch fails, log the error and return empty queryset
            logger.error(
                f"[SEARCH] Elasticsearch search failed for query '{query}': {str(e)}", exc_info=True)
            return Document.objects.none()

    def list(self, request, *args, **kwargs):
        """Override list to handle empty query parameter."""
        query = request.query_params.get('q', '').strip()

        if not query:
            return Response(
                {'error': 'Query parameter "q" is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        return super().list(request, *args, **kwargs)


class DocumentStatusView(views.APIView):
    """
    Check the processing status of a document and verify Elasticsearch indexing.
    """
    permission_classes = [permissions.AllowAny]

    def get(self, request, doc_id):
        """
        Get the status of a document including:
        - Database record status
        - Processing status
        - Elasticsearch indexing status
        """
        try:
            document = Document.objects.get(id=doc_id)

            status_info = {
                'document_id': document.id,
                'title': document.title,
                'uploaded_at': document.uploaded_at,
                'processed': document.processed,
                'has_content': bool(document.content),
                'content_length': len(document.content) if document.content else 0,
                'language': document.language,
                'file_name': document.file.name if document.file else None,
                'file_size': document.file.size if document.file else 0,
            }

            # Check Elasticsearch indexing
            es_indexed = False
            es_info = {}
            try:
                es = connections.get_connection()
                index_name = DocumentIndex._index._name

                try:
                    result = es.get(index=index_name, id=document.id)
                    es_indexed = True
                    es_info = {
                        'indexed': True,
                        'index_name': index_name,
                        'document_id': result.get('_id'),
                        'found': result.get('found', False),
                        'has_source': bool(result.get('_source')),
                    }
                    if result.get('_source'):
                        es_info['source_title'] = result['_source'].get(
                            'title', 'N/A')
                        es_info['has_content'] = bool(
                            result['_source'].get('content'))
                except Exception as e:
                    es_info = {
                        'indexed': False,
                        'error': str(e),
                        'index_name': index_name,
                    }
            except Exception as e:
                es_info = {
                    'indexed': False,
                    'error': f'Could not connect to Elasticsearch: {str(e)}',
                }

            status_info['elasticsearch'] = es_info

            return Response(status_info, status=status.HTTP_200_OK)

        except Document.DoesNotExist:
            return Response(
                {'error': f'Document with ID {doc_id} not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        except Exception as e:
            logger.error(
                f"Error checking document status: {str(e)}", exc_info=True)
            return Response(
                {'error': f'Error checking document status: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class DocumentContentPagesView(views.APIView):
    """
    Get paginated content pages of a document.

    Splits document content by page breaks (form feed characters).
    Query parameters:
    - page: Page number (default: 1)
    - page_size: Number of pages per response (default: 1)
    """
    permission_classes = [permissions.AllowAny]

    def get(self, request, pk):
        """Return paginated document content pages."""
        try:
            document = Document.objects.get(id=pk)

            if not document.content:
                return Response(
                    {'error': 'Document has no content available'},
                    status=status.HTTP_404_NOT_FOUND
                )

            # Split content by page breaks (form feed: \f or \x0c)
            # Also handle \n\n\n as potential page breaks
            content = document.content
            page_breaks = re.split(r'[\f\x0c]', content)

            # If no form feed characters found, try splitting by multiple newlines
            if len(page_breaks) == 1:
                page_breaks = re.split(r'\n{3,}', content)

            # If still only one page, split by fixed size chunks (2000 chars)
            if len(page_breaks) == 1 and len(content) > 2000:
                chunk_size = 2000
                page_breaks = [content[i:i+chunk_size]
                               for i in range(0, len(content), chunk_size)]

            # Filter out empty pages
            pages = [{'page_number': i+1, 'content': page.strip()}
                     for i, page in enumerate(page_breaks) if page.strip()]

            if not pages:
                pages = [{'page_number': 1, 'content': content}]

            # Pagination
            page = int(request.query_params.get('page', 1))
            page_size = int(request.query_params.get('page_size', 1))

            total_pages = len(pages)
            start_idx = (page - 1) * page_size
            end_idx = start_idx + page_size

            paginated_pages = pages[start_idx:end_idx]

            return Response({
                'total_pages': total_pages,
                'current_page': page,
                'page_size': page_size,
                'pages': paginated_pages
            }, status=status.HTTP_200_OK)

        except Document.DoesNotExist:
            return Response(
                {'error': f'Document with ID {pk} not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        except Exception as e:
            logger.error(
                f"Error getting document pages: {str(e)}", exc_info=True)
            return Response(
                {'error': f'Error getting document pages: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class DocumentInDocumentSearchView(views.APIView):
    """
    Search within a single document using Elasticsearch.
    """
    permission_classes = [permissions.AllowAny]

    def get(self, request, pk):
        query = request.query_params.get('q', '').strip()

        if not query:
            return Response(
                {'error': 'Query parameter "q" is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            # 1. Start the Search Context
            # We don't hit the database (Postgres) at all! We go straight to ES.
            s = DocumentIndex.search()

            # 2. Filter: "Where ID is pk"
            # We use 'ids' query to restrict search to this specific document
            s = s.filter('ids', values=[pk])

            # 3. Query: "Content contains text"
            # 'match_phrase' keeps the words in order (closer to your original .find() logic)
            # Use 'match' if you want "red apple" to find docs with "apple" and "red" anywhere.
            s = s.query('match', content={
                "query": query,
                "fuzziness": "AUTO",    # Allows 1-2 character mistakes based on word length
                "operator": "and"       # Optional: Requires ALL words to be present
            })

            # 4. Highlighting: The Magic Part
            # This replaces your manual snippet extraction logic.
            s = s.highlight(
                'content',
                fragment_size=150,      # Length of the snippet
                number_of_fragments=50,  # Max number of matches to return
                pre_tags=['<mark>'],    # Wrap match in these tags
                post_tags=['</mark>'],
                max_analyzed_offset=1000000  # Avoid error on very large documents
            )

            # 5. Execute
            response = s.execute()

            # 6. Parse Results
            matches = []

            # Since we filtered by ID, we expect exactly 0 or 1 document hit
            if response.hits:
                hit = response.hits[0]

                # Check if there are highlights (matches found in content)
                if 'highlight' in hit.meta:
                    for snippet in hit.meta.highlight.content:
                        matches.append({
                            # NOTE: ES works on the whole text, so "page_number"
                            # concept doesn't exist natively unless you index pages separately.
                            # We return the snippet directly.
                            'snippet': snippet,
                            'score': hit.meta.score
                        })

            return Response({
                'matches': matches,
                'total_matches': len(matches),
                'query': query
            }, status=status.HTTP_200_OK)

        except Exception as e:
            # logger.error(...)
            return Response(
                {'error': str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
