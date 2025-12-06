"""
Management command to recreate Elasticsearch index and re-index all processed documents.

Usage:
    python manage.py recreate_index
    python manage.py recreate_index --delete-only  # Only delete, don't recreate
    python manage.py recreate_index --create-only  # Only create, don't delete
"""
from django.core.management.base import BaseCommand
from django_elasticsearch_dsl.registries import registry
from elasticsearch_dsl import connections
from search_engine.models import Document
from search_engine.documents import DocumentIndex
from search_engine.tasks import process_document_task
import logging
import time

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = 'Recreate Elasticsearch index and re-index all processed documents'

    def add_arguments(self, parser):
        parser.add_argument(
            '--delete-only',
            action='store_true',
            help='Only delete the index, do not recreate it',
        )
        parser.add_argument(
            '--create-only',
            action='store_true',
            help='Only create the index, do not delete it first',
        )
        parser.add_argument(
            '--reindex',
            action='store_true',
            help='Re-index all processed documents after recreating the index',
        )

    def handle(self, *args, **options):
        delete_only = options.get('delete_only', False)
        create_only = options.get('create_only', False)
        reindex = options.get('reindex', False)
        
        index_name = DocumentIndex._index._name
        
        # Delete index using direct Elasticsearch connection for force delete
        if not create_only:
            self.stdout.write(f'Deleting index "{index_name}"...')
            try:
                # Try using the DSL method first
                DocumentIndex._index.delete(ignore=[404])
                self.stdout.write(
                    self.style.SUCCESS(f'Index "{index_name}" deleted successfully')
                )
            except Exception as e:
                # If DSL method fails, try direct API call
                self.stdout.write(f'DSL delete failed, trying direct API delete...')
                try:
                    es = connections.get_connection()
                    es.indices.delete(index=index_name, ignore=[404, 400])
                    self.stdout.write(
                        self.style.SUCCESS(f'Index "{index_name}" deleted via direct API')
                    )
                except Exception as api_error:
                    self.stdout.write(
                        self.style.ERROR(f'Error deleting index: {str(api_error)}')
                    )
                    if not delete_only:
                        return
            
            # Wait a moment for Elasticsearch to process the deletion
            time.sleep(1)
        
        if delete_only:
            self.stdout.write(self.style.SUCCESS('Index deleted. Exiting.'))
            return
        
        # Create index
        self.stdout.write(f'Creating index "{index_name}"...')
        try:
            DocumentIndex._index.create()
            self.stdout.write(
                self.style.SUCCESS(f'Index "{index_name}" created successfully')
            )
        except Exception as e:
            # Check if it's just an "already exists" error
            error_str = str(e).lower()
            if 'resource_already_exists_exception' in error_str or 'already exists' in error_str:
                self.stdout.write(
                    self.style.WARNING(f'Index "{index_name}" already exists, skipping creation')
                )
            else:
                self.stdout.write(
                    self.style.ERROR(f'Error creating index: {str(e)}')
                )
                return
        
        # Re-index documents
        if reindex:
            self.stdout.write('Re-indexing all processed documents...')
            processed_docs = Document.objects.filter(processed=True)
            count = processed_docs.count()
            
            if count == 0:
                self.stdout.write(
                    self.style.WARNING('No processed documents found to re-index')
                )
            else:
                self.stdout.write(f'Found {count} processed document(s) to re-index')
                indexed = 0
                for doc in processed_docs:
                    try:
                        doc_index = DocumentIndex(meta={'id': doc.id})
                        doc_index.prepare(doc)
                        doc_index.save()
                        indexed += 1
                        if indexed % 10 == 0:
                            self.stdout.write(f'  Indexed {indexed}/{count} documents...')
                    except Exception as e:
                        self.stdout.write(
                            self.style.ERROR(
                                f'Error indexing document {doc.id}: {str(e)}'
                            )
                        )
                
                self.stdout.write(
                    self.style.SUCCESS(
                        f'Successfully re-indexed {indexed}/{count} documents'
                    )
                )
        else:
            self.stdout.write(
                self.style.WARNING(
                    'Index recreated. Use --reindex to re-index all documents, '
                    'or documents will be indexed automatically when processed.'
                )
            )
