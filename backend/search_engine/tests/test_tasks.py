from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from rest_framework.test import APITestCase

from search_engine.models import Document
from search_engine.tasks import process_document_task
from search_engine.utils import split_document_content_into_pages


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

    @patch('search_engine.tasks.build_embedding', return_value=[0.1] * 3072)
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

    @patch('search_engine.tasks.build_batch_embedding', return_value=[[0.1] * 3072] * 2)
    @patch('search_engine.tasks.build_embedding', return_value=[0.1] * 3072)
    @patch('search_engine.tasks.DocumentIndex')
    @patch('search_engine.tasks.parser.from_buffer')
    def test_process_markdown_skips_tika_and_pages_on_markers(
        self,
        mock_parser,
        mock_index_class,
        mock_embed,
        mock_batch_embed,
    ):
        separator = '{0}' + '-' * 48
        source = f'## باب الطهارة\n\n**قال** الشافعي\n\n{separator}\n\nوأخبرنا مالك\n'
        doc = self._create_document(
            name='book.md',
            content=source.encode('utf-8'),
            content_type='text/markdown',
        )
        index_instance = mock_index_class.return_value
        index_instance.prepare.return_value = None
        index_instance.save.return_value = None

        result = process_document_task.apply(args=[doc.id]).get()
        doc.refresh_from_db()

        self.assertEqual(result['status'], 'success')
        self.assertEqual(doc.processing_status, Document.ProcessingStatus.SUCCEEDED)
        # The whole point: Markdown never reaches Tika (and OCR is already gated
        # behind _is_pdf, so it is unreachable too).
        mock_parser.assert_not_called()
        self.assertEqual(doc.ocr_engine_used, 'markdown')
        self.assertFalse(doc.has_layout)

        # Separator lines are consumed as delimiters, Markdown syntax is not.
        self.assertNotIn(separator, doc.content)
        self.assertIn('## باب الطهارة', doc.content)
        self.assertIn('**قال**', doc.content)

        chunks = doc.chunks.order_by('page_number')
        self.assertEqual([c.page_number for c in chunks], [1, 2])
        self.assertEqual(chunks[1].content, 'وأخبرنا مالك')
        # content is the verbatim Markdown, so nothing structured to store.
        self.assertIsNone(chunks[0].structured_content)

    @patch('search_engine.tasks.build_batch_embedding', return_value=[[0.1] * 3072] * 3)
    @patch('search_engine.tasks.build_embedding', return_value=[0.1] * 3072)
    @patch('search_engine.tasks.DocumentIndex')
    @patch('search_engine.tasks.parser.from_buffer')
    def test_markdown_chunks_round_trip_through_the_page_splitter(
        self,
        mock_parser,
        mock_index_class,
        mock_embed,
        mock_batch_embed,
    ):
        """The invariant every downstream page consumer depends on.

        The reader, in-document hybrid search and the extraction/KB pipelines all
        re-derive pages from ``document.content`` with
        ``split_document_content_into_pages``. If that disagrees with the stored
        chunks, BM25 for page k blends with cosine for page k+1 and entity
        offsets anchor to the wrong page. Trusting marker's `{N}` would break it.
        """
        # Non-contiguous, 0-based markers plus a blank page — the shapes that
        # would desync if page numbers came from `{N}`.
        source = (
            'صفحة أولى\n'
            '{0}' + '-' * 48 + '\n'
            '   \n'
            '{7}' + '-' * 48 + '\n'
            'صفحة ثانية\n'
            '{41}' + '-' * 48 + '\n'
            'صفحة ثالثة\n'
        )
        doc = self._create_document(
            name='rt.md', content=source.encode('utf-8'), content_type='text/markdown')
        index_instance = mock_index_class.return_value
        index_instance.prepare.return_value = None
        index_instance.save.return_value = None

        process_document_task.apply(args=[doc.id]).get()
        doc.refresh_from_db()

        stored = list(
            doc.chunks.order_by('chunk_index').values_list('page_number', 'content'))
        rebuilt = [
            (p['page_number'], p['content'])
            for p in split_document_content_into_pages(doc.content)
        ]

        self.assertEqual(stored, rebuilt)
        self.assertEqual([n for n, _ in stored], [1, 2, 3])

    @patch('search_engine.tasks.parser.from_buffer')
    def test_process_markdown_with_invalid_utf8_fails_terminally(self, mock_parser):
        doc = self._create_document(
            name='broken.md',
            content=b'\xff\xfe not utf-8',
            content_type='text/markdown',
        )

        result = process_document_task.apply(args=[doc.id]).get()
        doc.refresh_from_db()

        self.assertEqual(result['status'], 'error')
        self.assertEqual(doc.processing_status, Document.ProcessingStatus.FAILED)
        self.assertIn('not valid UTF-8', doc.processing_error)
        mock_parser.assert_not_called()
