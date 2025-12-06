"""
Management command to process unprocessed documents.

Usage:
    python manage.py process_documents
    python manage.py process_documents --document-id 6
"""
from django.core.management.base import BaseCommand
from search_engine.models import Document
from search_engine.tasks import process_document_task


class Command(BaseCommand):
    help = 'Process unprocessed documents by triggering Celery tasks'

    def add_arguments(self, parser):
        parser.add_argument(
            '--document-id',
            type=int,
            help='Process a specific document by ID',
        )
        parser.add_argument(
            '--all',
            action='store_true',
            help='Process all unprocessed documents',
        )

    def handle(self, *args, **options):
        document_id = options.get('document_id')
        process_all = options.get('all', False)

        if document_id:
            # Process specific document
            try:
                document = Document.objects.get(id=document_id)
                if document.processed:
                    self.stdout.write(
                        self.style.WARNING(
                            f'Document {document_id} is already processed.'
                        )
                    )
                else:
                    self.stdout.write(f'Processing document {document_id}...')
                    process_document_task.delay(document_id)
                    self.stdout.write(
                        self.style.SUCCESS(
                            f'Task queued for document {document_id}'
                        )
                    )
            except Document.DoesNotExist:
                self.stdout.write(
                    self.style.ERROR(f'Document {document_id} not found.')
                )
        elif process_all:
            # Process all unprocessed documents
            unprocessed = Document.objects.filter(processed=False)
            count = unprocessed.count()
            
            if count == 0:
                self.stdout.write(
                    self.style.SUCCESS('No unprocessed documents found.')
                )
                return
            
            self.stdout.write(f'Found {count} unprocessed document(s).')
            for doc in unprocessed:
                self.stdout.write(f'  - Document {doc.id}: {doc.title}')
                process_document_task.delay(doc.id)
            
            self.stdout.write(
                self.style.SUCCESS(
                    f'Queued {count} document(s) for processing.'
                )
            )
        else:
            # Show unprocessed documents
            unprocessed = Document.objects.filter(processed=False)
            count = unprocessed.count()
            
            if count == 0:
                self.stdout.write(
                    self.style.SUCCESS('No unprocessed documents found.')
                )
            else:
                self.stdout.write(
                    self.style.WARNING(
                        f'Found {count} unprocessed document(s):'
                    )
                )
                for doc in unprocessed:
                    self.stdout.write(f'  - ID {doc.id}: {doc.title}')
                self.stdout.write(
                    '\nTo process all, run: python manage.py process_documents --all'
                )
                self.stdout.write(
                    'To process one, run: python manage.py process_documents --document-id <id>'
                )
