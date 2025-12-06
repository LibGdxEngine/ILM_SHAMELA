from celery import shared_task
from tika import parser
from langdetect import detect, LangDetectException
import logging

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
        
        # 3. Extract text using Apache Tika
        logger.info(f"[STEP 3] Extracting text using Apache Tika...")
        try:
            parsed = parser.from_buffer(file_content)
            extracted_text = parsed.get('content', '')
            text_length = len(extracted_text) if extracted_text else 0
            logger.info(f"[STEP 3] Text extraction completed, extracted {text_length} characters")
            
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
        
        # 4. Detect language using langdetect
        logger.info(f"[STEP 4] Detecting language...")
        try:
            detected_language = detect(extracted_text)
            logger.info(f"[STEP 4] Language detected: {detected_language}")
        except LangDetectException as e:
            logger.warning(f"[STEP 4] Could not detect language for document {doc_id}: {str(e)}")
            detected_language = None
        
        # 5. Update Document model
        logger.info(f"[STEP 5] Updating document model with extracted content...")
        document.content = extracted_text
        document.language = detected_language
        document.processed = True
        document.save()
        logger.info(f"[STEP 5] Document model updated successfully")
        logger.info(f"[STEP 5] Content length saved: {len(extracted_text)} characters")
        logger.info(f"[STEP 5] Language saved: {detected_language}")
        logger.info(f"[STEP 5] Processed flag set to: {document.processed}")
        
        # 6. Index document in Elasticsearch
        logger.info(f"[STEP 6] Indexing document in Elasticsearch...")
        try:
            # Create DocumentIndex instance and prepare it with the document
            doc_index = DocumentIndex(meta={'id': document.id})
            logger.info(f"[STEP 6] Created DocumentIndex instance with ID: {document.id}")
            
            doc_index.prepare(document)
            logger.info(f"[STEP 6] DocumentIndex prepared with data")
            logger.info(f"[STEP 6] Index name: {doc_index._index._name}")
            
            doc_index.save()
            logger.info(f"[STEP 6] Document {doc_id} successfully indexed in Elasticsearch")
            logger.info(f"[STEP 6] Elasticsearch index: {doc_index._index._name}")
            logger.info(f"[STEP 6] Elasticsearch document ID: {doc_index.meta.id}")
            
            # Verify the document was indexed
            try:
                from elasticsearch_dsl import connections
                es = connections.get_connection()
                result = es.get(index=doc_index._index._name, id=document.id)
                logger.info(f"[STEP 6] Verification: Document found in Elasticsearch")
                logger.info(f"[STEP 6] Verification: Source contains title: {result.get('_source', {}).get('title', 'N/A')}")
            except Exception as verify_error:
                logger.warning(f"[STEP 6] Could not verify Elasticsearch indexing: {str(verify_error)}")
                
        except Exception as e:
            logger.error(f"[STEP 6] Error indexing document {doc_id} in Elasticsearch: {str(e)}", exc_info=True)
            # Don't fail the task if indexing fails, document is already saved
            logger.warning(f"[STEP 6] Document processing completed but Elasticsearch indexing failed")
        
        logger.info(f"[CELERY TASK] Successfully processed document {doc_id}")
        logger.info(f"[CELERY TASK] Final status - Processed: {document.processed}, Language: {detected_language}")
        logger.info("=" * 80)
        
        return {
            "status": "success",
            "doc_id": doc_id,
            "content_length": len(extracted_text),
            "language": detected_language,
            "indexed": True
        }
        
    except Document.DoesNotExist:
        logger.error(f"[CELERY TASK] Document {doc_id} not found in database")
        logger.info("=" * 80)
        return {"status": "error", "reason": "document_not_found", "doc_id": doc_id}
    except Exception as e:
        logger.error(f"[CELERY TASK] Error processing document {doc_id}: {str(e)}", exc_info=True)
        # Mark as processed even on error to prevent infinite retries
        try:
            document = Document.objects.get(id=doc_id)
            document.processed = True
            document.save()
            logger.info(f"[CELERY TASK] Document {doc_id} marked as processed=True due to error")
        except Exception as save_error:
            logger.error(f"[CELERY TASK] Could not mark document as processed: {str(save_error)}")
        logger.info("=" * 80)
        return {"status": "error", "reason": "processing_failed", "error": str(e), "doc_id": doc_id}
