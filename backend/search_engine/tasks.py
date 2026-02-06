from celery import shared_task
from tika import parser
from langdetect import detect, LangDetectException
import logging
from django.db import transaction
from .models import Document
from .documents import DocumentIndex

logger = logging.getLogger(__name__)


@shared_task(bind=True)
def process_document_task(self, doc_id):
    """
    Async task to process a document:
    1. Fetch Document from Postgres
    2. Download file from S3
    3. Extract text using Apache Tika
    4. Detect language using langdetect
    5. Save text and language back to Document model
    6. Index document in Elasticsearch
    """
    logger.info("=" * 80)
    logger.info(f"[CELERY TASK] Starting processing for document ID: {doc_id}")
    logger.info(f"[CELERY TASK] Task ID: {self.request.id}")
    
    try:
        # 1. Fetch Document from Postgres
        logger.info(f"[STEP 1] Fetching document {doc_id} from database...")
        document = Document.objects.get(id=doc_id)
        logger.info(f"[STEP 1] Document found: ID={document.id}, Title={document.title}")
        logger.info(f"[STEP 1] Current processed status: {document.processed}")
        logger.info(f"[STEP 1] File path: {document.file.name if document.file else 'None'}")
        
        # Skip if already processed
        if document.processed:
            logger.info(f"[CELERY TASK] Document {doc_id} already processed, skipping")
            logger.info("=" * 80)
            return {"status": "skipped", "reason": "already_processed", "doc_id": doc_id}
        
        # 2. Download file from S3
        logger.info(f"[STEP 2] Checking file attachment...")
        if not document.file:
            logger.error(f"[STEP 2] Document {doc_id} has no file attached")
            logger.info("=" * 80)
            return {"status": "error", "reason": "no_file_attached", "doc_id": doc_id}
        
        logger.info(f"[STEP 2] Reading file from storage: {document.file.name}")
        logger.info(f"[STEP 2] File size: {document.file.size} bytes")
        
        # Read file from S3 storage
        try:
            file_content = document.file.read()
            logger.info(f"[STEP 2] File read successfully, content length: {len(file_content)} bytes")
        except Exception as e:
            logger.error(f"[STEP 2] Error reading file: {str(e)}", exc_info=True)
            logger.info("=" * 80)
            return {"status": "error", "reason": "file_read_failed", "error": str(e), "doc_id": doc_id}
        
        # 3. Extract text and metadata using Apache Tika
        logger.info(f"[STEP 3] Extracting text and metadata using Apache Tika...")
        try:
            parsed = parser.from_buffer(file_content)
            extracted_text = parsed.get('content', '')
            metadata = parsed.get('metadata', {})
            text_length = len(extracted_text) if extracted_text else 0
            logger.info(f"[STEP 3] Text extraction completed, extracted {text_length} characters")
            logger.info(f"[STEP 3] Metadata keys: {list(metadata.keys()) if metadata else 'None'}")
            
            if not extracted_text:
                logger.warning(f"[STEP 3] No text extracted from document {doc_id}")
                logger.info(f"[STEP 3] Marking document as processed (no content to index)")
                document.processed = True
                document.save()
                logger.info(f"[STEP 3] Document {doc_id} marked as processed=True")
                logger.info("=" * 80)
                return {"status": "completed", "reason": "no_content_extracted", "doc_id": doc_id}
        except Exception as e:
            logger.error(f"[STEP 3] Error extracting text from document {doc_id}: {str(e)}", exc_info=True)
            logger.info(f"[STEP 3] Marking document as processed (extraction failed)")
            document.processed = True
            document.save()
            logger.info(f"[STEP 3] Document {doc_id} marked as processed=True")
            logger.info("=" * 80)
            return {"status": "error", "reason": "text_extraction_failed", "error": str(e), "doc_id": doc_id}
        
        # 4. Extract authors and categories from metadata
        logger.info(f"[STEP 4] Extracting authors and categories from metadata...")
        authors = []
        categories = []
        
        if metadata:
            # Extract authors from various metadata fields
            author_fields = ['meta:author', 'Author', 'creator', 'dc:creator', 'meta:creator']
            for field in author_fields:
                if field in metadata:
                    author_value = metadata[field]
                    if isinstance(author_value, list):
                        authors.extend([str(a).strip() for a in author_value if a])
                    elif author_value:
                        # Split by comma or semicolon if multiple authors
                        authors.extend([a.strip() for a in str(author_value).replace(';', ',').split(',') if a.strip()])
            
            # Extract categories/tags from metadata
            category_fields = ['meta:keywords', 'Keywords', 'dc:subject', 'subject', 'category', 'categories']
            for field in category_fields:
                if field in metadata:
                    category_value = metadata[field]
                    if isinstance(category_value, list):
                        categories.extend([str(c).strip() for c in category_value if c])
                    elif category_value:
                        # Split by comma or semicolon if multiple categories
                        categories.extend([c.strip() for c in str(category_value).replace(';', ',').split(',') if c.strip()])
        
        # Remove duplicates while preserving order
        authors = list(dict.fromkeys(authors))
        categories = list(dict.fromkeys(categories))
        
        logger.info(f"[STEP 4] Extracted {len(authors)} author(s): {authors}")
        logger.info(f"[STEP 4] Extracted {len(categories)} categor(ies): {categories}")
        
        # 5. Detect language using langdetect
        logger.info(f"[STEP 5] Detecting language...")
        try:
            detected_language = detect(extracted_text)
            logger.info(f"[STEP 5] Language detected: {detected_language}")
        except LangDetectException as e:
            logger.warning(f"[STEP 5] Could not detect language for document {doc_id}: {str(e)}")
            detected_language = None
        
        # 6. Update Document model
        logger.info(f"[STEP 6] Updating document model with extracted content...")
        with transaction.atomic():
            document.content = extracted_text
            document.language = detected_language
            document.processed = True
            document.save()
            
            # Handle authors - create/get Author instances and link them
            from .models import Author
            for author_name in authors:
                if author_name and author_name.strip():
                    author, _ = Author.objects.get_or_create(
                        name=author_name.strip(),
                        defaults={'alternate_names': []}
                    )
                    document.authors.add(author)
            
            # Handle categories - create/get Category instances and link them
            from .models import Category
            for category_name in categories:
                if category_name and category_name.strip():
                    category, _ = Category.objects.get_or_create(
                        name=category_name.strip()
                    )
                    document.categories.add(category)
            
            logger.info(f"[STEP 6] Document model updated successfully")
            logger.info(f"[STEP 6] Content length saved: {len(extracted_text)} characters")
            logger.info(f"[STEP 6] Language saved: {detected_language}")
            logger.info(f"[STEP 6] Authors saved: {authors}")
            logger.info(f"[STEP 6] Categories saved: {categories}")
            logger.info(f"[STEP 6] Processed flag set to: {document.processed}")
            
        # 7. Index document in Elasticsearch
        logger.info(f"[STEP 7] Indexing document in Elasticsearch...")
        
        # Create DocumentIndex instance and prepare it with the document
        doc_index = DocumentIndex(meta={'id': document.id})
        logger.info(f"[STEP 7] Created DocumentIndex instance with ID: {document.id}")
        
        doc_index.prepare(document)
        logger.info(f"[STEP 7] DocumentIndex prepared with data")
        logger.info(f"[STEP 7] Index name: {doc_index._index._name}")
        
        doc_index.save()
        logger.info(f"[STEP 7] Document {doc_id} successfully indexed in Elasticsearch")
        logger.info(f"[STEP 7] Elasticsearch index: {doc_index._index._name}")
        logger.info(f"[STEP 7] Elasticsearch document ID: {doc_index.meta.id}")
        
        # Verify the document was indexed
        from elasticsearch_dsl import connections
        es = connections.get_connection()
        result = es.get(index=doc_index._index._name, id=document.id)
        logger.info(f"[STEP 7] Verification: Document found in Elasticsearch")
        logger.info(f"[STEP 7] Verification: Source contains title: {result.get('_source', {}).get('title', 'N/A')}")
        
        logger.info(f"[CELERY TASK] Successfully processed document {doc_id}")
        logger.info(f"[CELERY TASK] Final status - Processed: {document.processed}, Language: {detected_language}")
        logger.info("=" * 80)
        
        return {
            "status": "success",
            "doc_id": doc_id,
            "content_length": len(extracted_text),
            "language": detected_language,
            "authors": authors,
            "categories": categories,
            "indexed": True
        }
        
    except Document.DoesNotExist:
        logger.error(f"[CELERY TASK] Document {doc_id} not found in database")
        logger.info("=" * 80)
        return {"status": "error", "reason": "document_not_found", "doc_id": doc_id}
    except Exception as e:
        logger.error(f"[CELERY TASK] Error processing document {doc_id}: {str(e)}", exc_info=True)
        return {"status": "error", "reason": "processing_failed", "error": str(e), "doc_id": doc_id}
