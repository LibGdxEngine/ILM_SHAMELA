"""extract_word_geometry_task: rendering/OCR patched, real DB rows, plus the process-task chaining."""
import json
import os
from unittest.mock import MagicMock, patch

from celery.exceptions import Retry
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings

from search_engine.models import Document, DocumentChunk
from search_engine.ocr import OCRUnavailable
from search_engine.tasks import (
    _word_geometry_lang, extract_word_geometry_task, process_document_task,
)

PARAGRAPH = 'وإذا تطبعت النفس على الكبر'
SMALL = 'وهذا الاستخدام'
HEADER = '٩'


def _layout():
    texts = [HEADER, PARAGRAPH, SMALL]
    blocks, offset = [], 0
    for index, (text, bbox) in enumerate(zip(texts, ([100, 10, 140, 40], [100, 100, 900, 160], [100, 200, 500, 250]))):
        blocks.append({'id': f'/page/0/Text/{index}', 'type': 'Text', 'bbox': bbox, 'text': text,
                       'char_start': offset, 'char_end': offset + len(text)})
        offset += len(text) + 1
    return {'width': 1000, 'height': 1400, 'blocks': blocks}, '\n'.join(texts)


def _line(texts, y0, y1, x_right=900, width=80, gap=20):
    words, x1 = [], x_right
    for text in texts:
        words.append({'text': text, 'bbox': [x1 - width, y0, x1, y1], 'conf': 90})
        x1 -= width + gap
    return {'bbox': [words[-1]['bbox'][0], y0, x_right, y1], 'order': [1, 1, 1], 'words': words}


def _sidecar_result():
    return {'width': 1000, 'height': 1400, 'regions': [
        {'id': '1', 'lines': [_line(PARAGRAPH.split(), 110, 150)]},
        {'id': '2', 'lines': [_line(SMALL.split(), 205, 245)]},
    ]}


def _fake_render(pdf, first_page, last_page, dpi=300):
    return [(page, b'png', 1000, 1400) for page in range(first_page, last_page + 1)]


def _engine(available=True, configured=True):
    engine = MagicMock()
    engine.configured = configured
    engine.supports_words.return_value = available
    engine.words.return_value = _sidecar_result()
    return engine


@override_settings(
    DEFAULT_FILE_STORAGE='django.core.files.storage.FileSystemStorage',
    MEDIA_ROOT='/tmp/ilm_shamela_test_media',
)
class ExtractWordGeometryTaskTests(TestCase):
    def setUp(self):
        self.document = Document.objects.create(
            title='Layout doc', has_layout=True, language='ar',
            file=SimpleUploadedFile('layout.pdf', b'%PDF-1.4 fake', content_type='application/pdf'),
        )
        for index in range(3):
            layout, content = _layout()
            DocumentChunk.objects.create(document=self.document, chunk_index=index,
                                         page_number=index + 1, content=content, layout=layout)

    def _run(self, engine, **kwargs):
        with patch('search_engine.word_geometry.render_page_images', side_effect=_fake_render), \
                patch('search_engine.tasks.ocr_registry.get_engine', return_value=engine):
            return extract_word_geometry_task.run(self.document.id, **kwargs)

    def _blocks(self, page_number):
        return DocumentChunk.objects.get(document=self.document, page_number=page_number).layout['blocks']

    def test_run_stores_geometry_and_keeps_block_fields(self):
        engine = _engine()
        result = self._run(engine)
        self.assertEqual(result['status'], 'success')
        self.assertEqual(result['pages'], 3)
        self.assertEqual(result['blocks'], 9)
        self.assertEqual(result['with_words'], 9)
        self.assertEqual(result['low_coverage'], 0)
        self.assertEqual(engine.words.call_count, 3)
        original, _ = _layout()
        for page in (1, 2, 3):
            blocks = self._blocks(page)
            for old, new in zip(original['blocks'], blocks):
                for key in ('text', 'char_start', 'char_end', 'bbox', 'id'):
                    self.assertEqual(old[key], new[key])
                self.assertIn('word_geometry', new)
            self.assertEqual(new and blocks[0]['word_geometry']['method'], 'block')
            self.assertEqual(len(blocks[1]['words']), 5)
            self.assertEqual(blocks[1]['word_geometry']['coverage'], 1.0)
            self.assertEqual(len(blocks[2]['words']), 2)
        # The engine was called with image-space regions for every block: the
        # single-token header only asks for its ink extent, the others are OCR'd.
        _png, regions = engine.words.call_args.args
        self.assertEqual([r['id'] for r in regions], ['0', '1', '2'])
        self.assertTrue(regions[0].get('ink_only'))
        self.assertEqual(engine.words.call_args.kwargs['lang'], 'ara')

    def test_second_run_is_idempotent_and_force_recomputes(self):
        engine = _engine()
        self._run(engine)
        self.assertEqual(engine.words.call_count, 3)
        result = self._run(engine)
        self.assertEqual(result, {'status': 'success', 'pages': 0})
        self.assertEqual(engine.words.call_count, 3)
        result = self._run(engine, force=True)
        self.assertEqual(result['pages'], 3)
        self.assertEqual(engine.words.call_count, 6)

    def test_page_numbers_restricts_pages(self):
        engine = _engine()
        result = self._run(engine, page_numbers=[2])
        self.assertEqual(result['pages'], 1)
        self.assertEqual(engine.words.call_count, 1)
        self.assertIn('word_geometry', self._blocks(2)[1])
        self.assertNotIn('word_geometry', self._blocks(1)[1])
        self.assertNotIn('word_geometry', self._blocks(3)[1])

    def test_engine_without_words_endpoint_is_skipped(self):
        self.assertEqual(self._run(_engine(available=False)),
                         {'status': 'skipped', 'reason': 'engine_unavailable'})
        self.assertEqual(self._run(_engine(configured=False)),
                         {'status': 'skipped', 'reason': 'engine_unavailable'})

    def test_inconclusive_probe_proceeds(self):
        # /health timed out because the sidecar was busy OCR'ing another page:
        # that is not "no /words endpoint" — the task must still run.
        engine = _engine(available=None)
        result = self._run(engine)
        self.assertEqual(result['status'], 'success')
        self.assertGreater(engine.words.call_count, 0)

    def test_non_layout_or_missing_document_is_skipped(self):
        self.document.has_layout = False
        self.document.save(update_fields=['has_layout'])
        self.assertEqual(self._run(_engine()), {'status': 'skipped', 'reason': 'no_layout'})
        with patch('search_engine.tasks.ocr_registry.get_engine', return_value=_engine()):
            self.assertEqual(extract_word_geometry_task.run(999999),
                             {'status': 'skipped', 'reason': 'missing'})

    def test_chunk_replaced_during_run_aborts(self):
        engine = _engine()

        def delete_then_answer(*args, **kwargs):
            DocumentChunk.objects.filter(document=self.document, page_number=1).delete()
            return _sidecar_result()

        engine.words.side_effect = delete_then_answer
        result = self._run(engine)
        self.assertEqual(result['status'], 'aborted')
        self.assertEqual(result['reason'], 'chunks_replaced')
        self.assertEqual(result['pages'], 0)

    def test_sidecar_outage_triggers_retry(self):
        engine = _engine()
        engine.words.side_effect = OCRUnavailable('sidecar down')
        with patch.object(extract_word_geometry_task, 'retry', side_effect=Retry('retry')) as retry:
            with self.assertRaises(Retry):
                self._run(engine)
        self.assertIsInstance(retry.call_args.kwargs['exc'], OCRUnavailable)

    def test_language_mapping(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop('OCR_WORDS_LANG', None)
            self.assertEqual(_word_geometry_lang(self.document), 'ara')
            self.document.language = 'fa'
            self.assertEqual(_word_geometry_lang(self.document), 'fas')
            self.document.language = None
            self.assertEqual(_word_geometry_lang(self.document), 'ara')
            os.environ['OCR_WORDS_LANG'] = 'eng'
            self.assertEqual(_word_geometry_lang(self.document), 'eng')


@override_settings(
    DEFAULT_FILE_STORAGE='django.core.files.storage.FileSystemStorage',
    MEDIA_ROOT='/tmp/ilm_shamela_test_media',
)
class ProcessDocumentChainsWordGeometryTests(TestCase):
    def _layout_document(self):
        layout_json = {'children': [{
            'id': '/page/0/Page/0', 'block_type': 'Page', 'bbox': [0, 0, 1000, 1400], 'page': 0,
            'children': [{'id': '/page/0/Text/0', 'block_type': 'Text', 'bbox': [100, 100, 900, 160],
                          'html': f'<p>{PARAGRAPH}</p>', 'page': 0}],
        }]}
        return Document.objects.create(
            title='Overlay doc',
            file=SimpleUploadedFile('book.pdf', b'%PDF-1.4 fake', content_type='application/pdf'),
            ocr_layout=SimpleUploadedFile('book.json', json.dumps(layout_json).encode('utf-8'),
                                          content_type='application/json'),
        )

    @patch('extraction.tasks.ner_document_task.apply_async')
    @patch('extraction.tasks.classify_document_task.delay')
    @patch('extraction.tasks.extract_document_task.delay')
    @patch('search_engine.tasks.extract_word_geometry_task.apply_async')
    @patch('search_engine.tasks._generate_pdf_thumbnail')
    @patch('search_engine.tasks._render_layout_page_images')
    @patch('search_engine.tasks.DocumentIndex')
    @patch('search_engine.tasks.build_batch_embedding', return_value=[[0.1] * 3])
    @patch('search_engine.tasks.build_embedding', return_value=[0.1] * 3)
    def test_layout_document_enqueues_word_geometry(self, _embed, _batch, _index, _render, _thumb,
                                                    geometry_enqueue, _extract, _classify, _ner):
        document = self._layout_document()
        result = process_document_task.apply(args=[document.id]).get()
        self.assertEqual(result['status'], 'success')
        document.refresh_from_db()
        self.assertTrue(document.has_layout)
        geometry_enqueue.assert_called_once_with(args=[document.id], countdown=5)

    @patch('extraction.tasks.ner_document_task.apply_async')
    @patch('extraction.tasks.classify_document_task.delay')
    @patch('extraction.tasks.extract_document_task.delay')
    @patch('search_engine.tasks.extract_word_geometry_task.apply_async')
    @patch('search_engine.tasks.DocumentIndex')
    @patch('search_engine.tasks.parser.from_buffer', return_value={'content': 'plain text body', 'metadata': {}})
    @patch('search_engine.tasks.build_batch_embedding', return_value=[[0.1] * 3])
    @patch('search_engine.tasks.build_embedding', return_value=[0.1] * 3)
    def test_plain_document_does_not_enqueue_word_geometry(self, _embed, _batch, _parser, _index,
                                                            geometry_enqueue, _extract, _classify, _ner):
        document = Document.objects.create(
            title='Plain', file=SimpleUploadedFile('plain.txt', b'plain text body', content_type='text/plain'))
        result = process_document_task.apply(args=[document.id]).get()
        self.assertEqual(result['status'], 'success')
        geometry_enqueue.assert_not_called()
