from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from rest_framework.test import APITestCase

from search_engine.models import Document
from search_engine.tasks import process_document_task


@override_settings(
    DEFAULT_FILE_STORAGE='django.core.files.storage.FileSystemStorage',
    MEDIA_ROOT='/tmp/ilm_shamela_test_media',
)
class ProcessDocumentTaskTests(APITestCase):
    def _create_document(
        self,
        name='task.txt',
        content=b'This file is used by celery task tests.',
        content_type='text/plain',
    ):
        upload = SimpleUploadedFile(
            name,
            content,
            content_type=content_type,
        )
        return Document.objects.create(title='Task Test Doc', file=upload)

    @patch('search_engine.tasks.build_embedding', return_value=[0.1] * 768)
    @patch('search_engine.tasks.DocumentIndex')
    @patch('search_engine.tasks.parser.from_buffer')
    def test_process_document_success_marks_document_succeeded(self, mock_parser, mock_index_class, mock_embed):
        doc = self._create_document()

        mock_parser.return_value = {
            'content': 'Knowledge and scholarship text body.',
            'metadata': {'Author': 'Ibn Example', 'category': 'History'},
        }
        index_instance = mock_index_class.return_value
        index_instance.prepare.return_value = None
        index_instance.save.return_value = None

        result = process_document_task.apply(args=[doc.id]).get()
        doc.refresh_from_db()

        self.assertEqual(result['status'], 'success')
        self.assertTrue(doc.processed)
        self.assertEqual(doc.processing_status, Document.ProcessingStatus.SUCCEEDED)
        self.assertGreaterEqual(doc.processing_attempts, 1)
        self.assertTrue(doc.semantic_vector)

    @patch('search_engine.tasks.parser.from_buffer')
    def test_process_document_terminal_failure_marks_document_failed(self, mock_parser):
        doc = self._create_document()
        mock_parser.side_effect = Exception('tika unavailable')

        result = process_document_task.apply(args=[doc.id]).get()
        doc.refresh_from_db()

        self.assertEqual(result['status'], 'error')
        self.assertFalse(doc.processed)
        self.assertEqual(doc.processing_status, Document.ProcessingStatus.FAILED)
        self.assertIn('Text extraction failed', doc.processing_error)

    @patch('search_engine.tasks.DocumentIndex')
    @patch('search_engine.tasks._generate_pdf_thumbnail')
    @patch('search_engine.tasks.parser.from_buffer')
    def test_process_document_pdf_attaches_thumbnail(
        self,
        mock_parser,
        mock_generate_thumbnail,
        mock_index_class,
    ):
        doc = self._create_document(
            name='task.pdf',
            content=b'%PDF-1.4 test pdf payload',
            content_type='application/pdf',
        )

        mock_parser.return_value = {
            'content': 'Knowledge and scholarship text body.',
            'metadata': {'Author': 'Ibn Example', 'category': 'History'},
        }
        index_instance = mock_index_class.return_value
        index_instance.prepare.return_value = None
        index_instance.save.return_value = None

        def _attach_thumbnail(document, _file_bytes):
            document.thumbnail.save(
                'generated-thumbnail.jpg',
                SimpleUploadedFile(
                    'generated-thumbnail.jpg',
                    b'jpeg-bytes',
                    content_type='image/jpeg',
                ),
                save=False,
            )
            return True

        mock_generate_thumbnail.side_effect = _attach_thumbnail

        result = process_document_task.apply(args=[doc.id]).get()
        doc.refresh_from_db()

        self.assertEqual(result['status'], 'success')
        self.assertTrue(doc.thumbnail)
        mock_generate_thumbnail.assert_called_once()

    @patch('search_engine.tasks.DocumentIndex')
    @patch('search_engine.tasks._generate_pdf_thumbnail')
    @patch('search_engine.tasks.parser.from_buffer')
    def test_process_document_continues_when_thumbnail_generation_raises(
        self,
        mock_parser,
        mock_generate_thumbnail,
        mock_index_class,
    ):
        doc = self._create_document(
            name='task.pdf',
            content=b'%PDF-1.4 test pdf payload',
            content_type='application/pdf',
        )

        mock_parser.return_value = {
            'content': 'Knowledge and scholarship text body.',
            'metadata': {'Author': 'Ibn Example', 'category': 'History'},
        }
        mock_generate_thumbnail.side_effect = RuntimeError('thumbnail conversion failed')
        index_instance = mock_index_class.return_value
        index_instance.prepare.return_value = None
        index_instance.save.return_value = None

        result = process_document_task.apply(args=[doc.id]).get()
        doc.refresh_from_db()

        self.assertEqual(result['status'], 'success')
        self.assertEqual(doc.processing_status, Document.ProcessingStatus.SUCCEEDED)
        self.assertFalse(doc.thumbnail)
