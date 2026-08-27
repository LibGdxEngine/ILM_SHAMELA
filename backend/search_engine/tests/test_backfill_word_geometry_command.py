"""backfill_word_geometry management command."""
from io import StringIO
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import CommandError, call_command
from django.test import TestCase, override_settings

from search_engine.management.commands.backfill_word_geometry import parse_pages
from search_engine.models import Document, DocumentChunk


def _layout(with_geometry=False):
    block = {'id': '/page/0/Text/0', 'type': 'Text', 'bbox': [100, 100, 900, 160],
             'text': 'وإذا تطبعت النفس', 'char_start': 0, 'char_end': 16}
    if with_geometry:
        block['word_geometry'] = {'engine': 'tesseract', 'coverage': 1.0}
        block['words'] = [{'start': 0, 'end': 4, 'bbox': [800, 100, 900, 160], 'line': 0, 'matched': True}]
    return {'width': 1000, 'height': 1400, 'blocks': [block]}


@override_settings(
    DEFAULT_FILE_STORAGE='django.core.files.storage.FileSystemStorage',
    MEDIA_ROOT='/tmp/ilm_shamela_test_media',
)
class BackfillWordGeometryCommandTests(TestCase):
    def setUp(self):
        self.document = Document.objects.create(
            title='Layout doc', has_layout=True,
            file=SimpleUploadedFile('layout.pdf', b'%PDF-1.4', content_type='application/pdf'))
        DocumentChunk.objects.create(document=self.document, chunk_index=0, page_number=1,
                                     content='وإذا تطبعت النفس', layout=_layout(with_geometry=True))
        DocumentChunk.objects.create(document=self.document, chunk_index=1, page_number=2,
                                     content='وإذا تطبعت النفس', layout=_layout())
        self.plain = Document.objects.create(
            title='Plain doc', file=SimpleUploadedFile('plain.txt', b'x', content_type='text/plain'))

    def _call(self, *args):
        out = StringIO()
        call_command('backfill_word_geometry', *args, stdout=out)
        return out.getvalue()

    def test_parse_pages(self):
        self.assertEqual(parse_pages('1-3,5'), [1, 2, 3, 5])
        self.assertEqual(parse_pages(' 7 , 2-2 '), [2, 7])
        self.assertIsNone(parse_pages(''))
        self.assertIsNone(parse_pages(None))
        with self.assertRaises(CommandError):
            parse_pages('5-3')

    @patch('search_engine.tasks.extract_word_geometry_task.apply_async')
    def test_listing_mode_reports_status_without_enqueuing(self, enqueue):
        output = self._call()
        self.assertIn(f'doc {self.document.id}', output)
        self.assertIn('pages=2 pending_pages=1', output)
        self.assertIn('with_words=1', output)
        self.assertIn('pending_blocks=1', output)
        self.assertNotIn(f'doc {self.plain.id}', output)
        self.assertIn('Pass --document-id', output)
        enqueue.assert_not_called()

    @patch('search_engine.tasks.extract_word_geometry_task.apply_async')
    def test_dry_run(self, enqueue):
        output = self._call('--document-id', str(self.document.id), '--dry-run')
        self.assertIn('Dry run', output)
        enqueue.assert_not_called()

    @patch('search_engine.tasks.extract_word_geometry_task.apply_async')
    def test_async_enqueue_whole_document(self, enqueue):
        output = self._call('--document-id', str(self.document.id))
        enqueue.assert_called_once_with(args=[self.document.id],
                                        kwargs={'page_numbers': None, 'force': False}, countdown=0.0)
        self.assertIn('Enqueued 1', output)

    @patch('search_engine.tasks.extract_word_geometry_task.apply_async')
    def test_pages_and_force_are_forwarded(self, enqueue):
        self._call('--document-id', str(self.document.id), '--pages', '1-2', '--force')
        enqueue.assert_called_once_with(args=[self.document.id],
                                        kwargs={'page_numbers': [1, 2], 'force': True}, countdown=0.0)

    @patch('search_engine.tasks.extract_word_geometry_task.apply_async')
    def test_batch_pages_enqueues_one_task_per_batch(self, enqueue):
        self._call('--all', '--batch-pages', '1', '--stagger', '2')
        self.assertEqual(enqueue.call_count, 2)
        calls = [(c.kwargs['kwargs']['page_numbers'], c.kwargs['countdown']) for c in enqueue.call_args_list]
        self.assertEqual(calls, [([1], 0.0), ([2], 2.0)])

    @patch('search_engine.tasks.extract_word_geometry_task.run', return_value={'status': 'success', 'pages': 1})
    @patch('search_engine.tasks.extract_word_geometry_task.apply_async')
    def test_sync_runs_inline(self, enqueue, run):
        output = self._call('--document-id', str(self.document.id), '--sync', '--pages', '2')
        run.assert_called_once_with(self.document.id, page_numbers=[2], force=False)
        enqueue.assert_not_called()
        self.assertIn("'status': 'success'", output)

    def test_unknown_or_non_layout_document_errors(self):
        with self.assertRaises(CommandError):
            self._call('--document-id', '999999')
        with self.assertRaises(CommandError):
            self._call('--document-id', str(self.plain.id))
