import logging
from rest_framework import generics, status, permissions, views
from rest_framework.response import Response
from elasticsearch_dsl import Q
from elasticsearch_dsl import connections
from .models import Document
from .serializers import DocumentSerializer
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

    def create(self, request, *args, **kwargs):
        """
        Override create to provide better error handling and logging.
        """
        logger.info("=" * 80)
        logger.info(f"POST request received for document upload")
        logger.info(f"Request scheme: {request.scheme}")
        logger.info(f"Request host: {request.get_host()}")
        logger.info(f"Request path: {request.path}")
        logger.info(f"Remote address: {request.META.get('REMOTE_ADDR', 'unknown')}")
        logger.info(f"Files in request: {list(request.FILES.keys())}")
        
        try:
            serializer = self.get_serializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            logger.info(f"Serializer validation passed for document: {request.data.get('title', 'Unknown')}")
            self.perform_create(serializer)
            headers = self.get_success_headers(serializer.data)
            logger.info(f"Document created successfully with ID: {serializer.data.get('id')}")
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
            logger.info(f"[UPLOAD] Document {document.id} created successfully")
            logger.info(f"[UPLOAD] Title: {document.title}")
            logger.info(f"[UPLOAD] File: {document.file.name if document.file else 'No file'}")
            logger.info(f"[UPLOAD] File size: {document.file.size if document.file else 0} bytes")
            logger.info(f"[UPLOAD] Uploaded at: {document.uploaded_at}")
            logger.info(f"[UPLOAD] Initial processed status: {document.processed}")
            
            # Trigger async Celery task to process the document
            try:
                task_result = process_document_task.delay(document.id)
                logger.info(f"[UPLOAD] Celery task queued for document {document.id}")
                logger.info(f"[UPLOAD] Task ID: {task_result.id}")
                logger.info(f"[UPLOAD] Task state: {task_result.state}")
            except Exception as e:
                # If Celery is not available, log the error but don't fail the request
                # The document is already saved, so we can process it later
                logger.error(f"[UPLOAD] Failed to queue Celery task for document {document.id}: {str(e)}", exc_info=True)
                logger.warning("[UPLOAD] Document saved but processing task could not be queued. "
                             "Make sure Celery worker is running.")
        except Exception as e:
            logger.error(f"[UPLOAD] Error creating document: {str(e)}", exc_info=True)
            raise


class DocumentDetailView(generics.RetrieveUpdateDestroyAPIView):
    """
    Retrieve, update or delete a document instance.
    """
    queryset = Document.objects.all()
    serializer_class = DocumentSerializer
    permission_classes = [permissions.AllowAny]


class DocumentSearchView(generics.ListAPIView):
    """
    Search documents using Elasticsearch MultiMatch query.
    
    Query parameter:
    - q: Search query string
    """
    serializer_class = DocumentSerializer
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
            logger.info(f"[SEARCH] Query: '{query}', Total hits: {response.hits.total.value}")
            document_ids = [int(hit.meta.id) for hit in response]
            logger.info(f"[SEARCH] Found {len(document_ids)} document(s): {document_ids}")
            
            # Return documents in the order returned by Elasticsearch
            documents = Document.objects.filter(id__in=document_ids)
            # Preserve Elasticsearch order
            id_order = {doc_id: idx for idx, doc_id in enumerate(document_ids)}
            return sorted(documents, key=lambda doc: id_order.get(doc.id, float('inf')))
        except Exception as e:
            # If Elasticsearch fails, log the error and return empty queryset
            logger.error(f"[SEARCH] Elasticsearch search failed for query '{query}': {str(e)}", exc_info=True)
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
                        es_info['source_title'] = result['_source'].get('title', 'N/A')
                        es_info['has_content'] = bool(result['_source'].get('content'))
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
            logger.error(f"Error checking document status: {str(e)}", exc_info=True)
            return Response(
                {'error': f'Error checking document status: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )