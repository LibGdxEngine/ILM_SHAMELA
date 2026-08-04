"""Layer-0 classifier tests (LLM mocked; loud-failure contract pinned)."""
from unittest import mock

from django.test import TestCase

from extraction import layer0
from extraction.models import DocumentMeta
from extraction.tasks import classify_document_task
from search_engine.models import Author, Document, DocumentChunk


class SamplingAndHintsTests(TestCase):
    def setUp(self):
        self.document = Document.objects.create(
            title='كتاب الفقه', file='documents/x.txt', processed=True,
            content='', language='ar')
        for n in range(1, 21):
            DocumentChunk.objects.create(
                document=self.document, chunk_index=n - 1, page_number=n,
                content=f'نص الصفحة {n} ' + 'كلمة ' * 10)

    def test_sample_is_title_weighted_and_bounded(self):
        pages = layer0.sample_pages(self.document)
        numbers = [p['page_number'] for p in pages]
        self.assertLessEqual(len(pages), layer0.MAX_SAMPLE_PAGES)
        for n in (1, 2, 3):
            self.assertIn(n, numbers)
        self.assertIn(20, numbers)  # last page
        self.assertTrue(all(len(p['content']) <= layer0.SAMPLE_CHAR_LIMIT for p in pages))

    def test_rule_hints(self):
        author = Author.objects.create(name='مؤلف', date_of_death='728 هـ')
        self.document.authors.add(author)
        self.document.title = 'مجلة المنار'
        hints = layer0.rule_hints(self.document)
        self.assertEqual(hints['physical_class'], 'newspaper')
        self.assertEqual(hints['era_century_max'], 8)

        self.document.language = 'en'
        self.assertEqual(layer0.rule_hints(self.document)['register'], 'non_arabic')


class ApplyClassificationTests(TestCase):
    def setUp(self):
        self.document = Document.objects.create(
            title='كتاب', file='documents/x.txt', processed=True)
        self.meta = DocumentMeta.objects.create(document=self.document)

    def test_valid_args_applied_with_clamped_confidence(self):
        layer0.apply_classification(self.meta, {
            'genre': 'fiqh', 'genre_confidence': 1.7,
            'genres_secondary': ['usul_fiqh', 'fiqh', 'bogus'],
            'madhhab': 'shafii', 'madhhab_confidence': 0.8,
            'era_century_hijri': 8, 'era_confidence': 0.75,
            'register': 'classical',
            'physical_class': 'printed_book', 'physical_confidence': 0.95,
            'evidence': {'genre': 'كتاب الطهارة'},
        }, model_id='test-model')
        self.assertEqual(self.meta.genre, 'fiqh')
        self.assertEqual(self.meta.genre_confidence, 1.0)  # clamped
        self.assertEqual(self.meta.genres_secondary, ['usul_fiqh'])  # dedup + enum
        self.assertEqual(self.meta.era_century, 8)
        self.assertEqual(self.meta.status, DocumentMeta.Status.SUCCEEDED)
        self.assertEqual(self.meta.model_id, 'test-model')

    def test_invalid_enums_ignored(self):
        layer0.apply_classification(self.meta, {
            'genre': 'not-a-genre', 'genre_confidence': 0.9,
            'madhhab': 'shafii', 'physical_class': 'printed_book',
            'era_century_hijri': 99,
        }, model_id='m')
        self.assertEqual(self.meta.genre, '')
        self.assertIsNone(self.meta.era_century)
        self.assertEqual(self.meta.madhhab, 'shafii')


class ClassifyTaskTests(TestCase):
    def setUp(self):
        self.document = Document.objects.create(
            title='كتاب', file='documents/x.txt', processed=True,
            content='نص الكتاب هنا')

    def test_success_path(self):
        with mock.patch.object(layer0, 'classify_document', return_value={
            'genre': 'hadith', 'genre_confidence': 0.9,
            'madhhab': 'na', 'physical_class': 'printed_book',
        }):
            classify_document_task.run(self.document.id)
        meta = DocumentMeta.objects.get(document=self.document)
        self.assertEqual(meta.status, DocumentMeta.Status.SUCCEEDED)
        self.assertEqual(meta.genre, 'hadith')
        self.assertEqual(meta.extractor_version, layer0.LAYER0_VERSION)

    def test_config_failure_is_loud_and_does_not_retry(self):
        with mock.patch.object(
            layer0, 'classify_document',
            side_effect=RuntimeError('OPENROUTER_API_KEY is not configured'),
        ):
            classify_document_task.run(self.document.id)
        meta = DocumentMeta.objects.get(document=self.document)
        self.assertEqual(meta.status, DocumentMeta.Status.FAILED)
        self.assertIn('OPENROUTER_API_KEY', meta.degraded_reason)
        self.assertEqual(meta.attempts, 1)

    def test_auth_401_is_non_transient_and_survives_sync_run(self):
        class FakeAuthError(RuntimeError):
            pass
        with mock.patch.object(
            layer0, 'classify_document',
            side_effect=FakeAuthError("Error code: 401 - {'error': {'message': 'User not found.'}}"),
        ):
            # Must not raise (sync callers like backfill --sync would abort).
            classify_document_task.run(self.document.id)
        meta = DocumentMeta.objects.get(document=self.document)
        self.assertEqual(meta.status, DocumentMeta.Status.FAILED)
        self.assertIn('401', meta.degraded_reason)

    def test_human_verified_never_overwritten(self):
        meta = DocumentMeta.objects.create(
            document=self.document, genre='tafsir', human_verified=True,
            status=DocumentMeta.Status.SUCCEEDED,
            extractor_version=layer0.LAYER0_VERSION)
        with mock.patch.object(layer0, 'classify_document') as classify:
            classify_document_task.run(self.document.id)
        classify.assert_not_called()
        meta.refresh_from_db()
        self.assertEqual(meta.genre, 'tafsir')

    def test_succeeded_current_version_is_noop(self):
        DocumentMeta.objects.create(
            document=self.document, status=DocumentMeta.Status.SUCCEEDED,
            extractor_version=layer0.LAYER0_VERSION)
        with mock.patch.object(layer0, 'classify_document') as classify:
            classify_document_task.run(self.document.id)
        classify.assert_not_called()
