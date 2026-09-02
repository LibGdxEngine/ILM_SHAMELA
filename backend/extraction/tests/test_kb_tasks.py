"""kb_extract_document_task end-to-end with mocked LLM transports: files land
under KB_DATA_DIR, the ExtractionRun row mirrors state, re-runs are no-ops,
auto-run guards fire, and the upload path enqueues the KB task instead of the
legacy NER pass.
"""
import json
import os
import tempfile
from contextlib import contextmanager
from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings

from extraction.kb import config as kb_config
from extraction.kb import extract as kb_extract
from extraction.models import ExtractionRun
from extraction.tasks import kb_extract_document_task
from search_engine.models import Document

PAGE_1 = 'ترجمة الشافعي رحمه الله.\nتوفي الشافعي بمصر سنة أربع ومائتين.'
PAGE_2 = 'وقال البخاري في التاريخ كلاما آخر عن هذا الباب.'

SPLIT_RESPONSE = json.dumps({'markers': [
    {'verbatim_line': 'ترجمة الشافعي رحمه الله.',
     'segment_type': 'biography', 'title': 'الشافعي', 'stream': 'main',
     'confidence': 0.9},
]}, ensure_ascii=False)

MENTIONS_RESPONSE = json.dumps({'mentions': [
    {'local_id': 'm1', 'label': 'person', 'text': 'الشافعي', 'occurrence': 1},
    {'local_id': 'm2', 'label': 'place', 'text': 'مصر'},
    {'local_id': 'm3', 'label': 'time', 'text': 'سنة أربع ومائتين',
     'hijri_year': 204},
]}, ensure_ascii=False)

LINKS_RESPONSE = json.dumps({
    'relations': [{'relation_type': 'died_in', 'subject_local_id': 'm1',
                   'object_local_id': 'm2', 'time_local_id': 'm3',
                   'trigger': 'توفي'}],
    'claims': [{'predicate': 'death_date', 'subject_local_id': 'm1',
                'time_local_id': 'm3'}],
    'appraisals': [], 'quote_attributions': [],
}, ensure_ascii=False)


def _fake_gemini(prompt, schema):
    if schema is kb_extract.MENTIONS_SCHEMA_JSON:
        return MENTIONS_RESPONSE
    return LINKS_RESPONSE


@contextmanager
def _kb_tmpdir():
    with tempfile.TemporaryDirectory() as tmp:
        with override_settings(KB_DATA_DIR=tmp):
            yield tmp


class KbTaskTests(TestCase):
    def setUp(self):
        self.document = Document.objects.create(
            title='كتاب الاختبار', file='documents/test.txt',
            content=f'{PAGE_1}\f{PAGE_2}', processed=True,
            ocr_engine_used='tesseract')

    def _run(self, **kwargs):
        with mock.patch('extraction.kb.split._split_completion',
                        return_value=SPLIT_RESPONSE) as m_split, \
                mock.patch('extraction.kb.extract._gemini_call',
                           side_effect=_fake_gemini) as m_gem:
            kb_extract_document_task.run(self.document.id, **kwargs)
        return m_split, m_gem

    def test_end_to_end_files_and_run_row(self):
        with _kb_tmpdir():
            m_split, m_gem = self._run()
            book_id = kb_config.book_id_for(self.document)
            out = kb_config.output_dir(book_id)
            for name in ('segments.json', 'extraction.json',
                         'extraction_meta.json', 'drops.jsonl'):
                self.assertTrue((out / name).exists(), name)
            meta = json.loads((out / 'extraction_meta.json').read_text(
                encoding='utf-8'))
            self.assertTrue(meta['complete'])
            self.assertTrue(meta['ocr_source'])
            self.assertEqual(meta['document_id'], self.document.id)
            ext = json.loads((out / 'extraction.json').read_text(encoding='utf-8'))
            self.assertEqual(len(ext['mentions']), 3)
            self.assertEqual(len(ext['relations']), 1)
            self.assertEqual(len(ext['claims']), 1)

            run = ExtractionRun.objects.get(
                document=self.document,
                extractor_name=kb_config.KB_EXTRACTOR_NAME)
            self.assertEqual(run.status, ExtractionRun.Status.SUCCEEDED)
            self.assertEqual(run.mention_count, 3)
            self.assertTrue(run.corpus_hash)
            self.assertTrue(m_split.called)
            self.assertTrue(m_gem.called)

    def test_second_run_is_a_no_op(self):
        with _kb_tmpdir():
            self._run()
            m_split, m_gem = self._run()
            self.assertFalse(m_split.called)
            self.assertFalse(m_gem.called)
            run = ExtractionRun.objects.get(
                document=self.document,
                extractor_name=kb_config.KB_EXTRACTOR_NAME)
            self.assertEqual(run.status, ExtractionRun.Status.SUCCEEDED)

    def test_auto_guard_max_doc_chars(self):
        with _kb_tmpdir():
            with mock.patch.dict(os.environ, {'KB_MAX_DOC_CHARS': '10'}):
                m_split, m_gem = self._run(auto=True)
            self.assertFalse(m_split.called)
            self.assertFalse(m_gem.called)
            run = ExtractionRun.objects.get(
                document=self.document,
                extractor_name=kb_config.KB_EXTRACTOR_NAME)
            self.assertEqual(run.status, ExtractionRun.Status.FAILED)
            self.assertIn('auto-run guard', run.error)

    def test_manual_run_bypasses_guards(self):
        with _kb_tmpdir():
            with mock.patch.dict(os.environ, {'KB_MAX_DOC_CHARS': '10'}):
                self._run(auto=False)
            run = ExtractionRun.objects.get(
                document=self.document,
                extractor_name=kb_config.KB_EXTRACTOR_NAME)
            self.assertEqual(run.status, ExtractionRun.Status.SUCCEEDED)

    def test_extractor_version_fits_run_row(self):
        self.assertLessEqual(len(kb_config.KB_PIPELINE_VERSION), 20)


@override_settings(
    DEFAULT_FILE_STORAGE='django.core.files.storage.FileSystemStorage',
    MEDIA_ROOT='/tmp/ilm_shamela_test_media',
)
class UploadWiringTests(TestCase):
    """The upload success path enqueues the KB task, not the legacy NER pass."""

    def test_process_document_enqueues_kb_not_ner(self):
        from search_engine.tasks import process_document_task

        upload = SimpleUploadedFile('task.txt', b'wiring test body',
                                    content_type='text/plain')
        doc = Document.objects.create(title='Wiring Test', file=upload)

        with mock.patch('search_engine.tasks.parser.from_buffer',
                        return_value={'content': 'Body text.', 'metadata': {}}), \
                mock.patch('search_engine.tasks.DocumentIndex'), \
                mock.patch('search_engine.tasks.build_embedding',
                           return_value=[0.1] * 3072), \
                mock.patch('extraction.tasks.extract_document_task.delay'), \
                mock.patch('extraction.tasks.classify_document_task.delay'), \
                mock.patch('extraction.tasks.kb_extract_document_task'
                           '.apply_async') as m_kb, \
                mock.patch('extraction.tasks.ner_document_task'
                           '.apply_async') as m_ner:
            result = process_document_task.apply(args=[doc.id]).get()

        self.assertEqual(result['status'], 'success')
        self.assertTrue(m_kb.called)
        _, kwargs = m_kb.call_args
        self.assertEqual(kwargs['args'], [doc.id])
        self.assertTrue(kwargs['kwargs']['auto'])
        self.assertFalse(m_ner.called)
