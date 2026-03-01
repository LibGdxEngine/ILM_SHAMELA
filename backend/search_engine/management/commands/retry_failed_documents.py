from django.core.management.base import BaseCommand

from search_engine.models import Document
from search_engine.tasks import process_document_task


class Command(BaseCommand):
    help = 'Re-queue failed documents for processing.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--limit',
            type=int,
            default=100,
            help='Maximum number of failed documents to queue.',
        )

    def handle(self, *args, **options):
        limit = options['limit']
        failed_docs = Document.objects.filter(
            processing_status=Document.ProcessingStatus.FAILED
        ).order_by('uploaded_at')[:limit]

        queued = 0
        for document in failed_docs:
            process_document_task.delay(document.id)
            queued += 1

        self.stdout.write(
            self.style.SUCCESS(f'Queued {queued} failed documents for retry.')
        )
