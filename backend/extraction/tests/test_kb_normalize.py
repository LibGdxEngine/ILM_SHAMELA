"""Stage 0 tests: markdown stripping (port of the notebook's self-test) plus
the DB-document specifics — page offsets/labels from the canonical splitter,
DB-title-wins, seed offsets indexing the normalized text verbatim, ocr_source.
"""
from django.test import SimpleTestCase, TestCase

from extraction.kb.normalize import (
    meta_title,
    normalize_document,
    normalize_pages,
    page_for_offset,
)
from extraction.kb.schema import SegmentType
from search_engine.models import Document
from search_engine.utils import split_document_content_into_pages

_SAMPLE_MD = "\n".join([
    "كتاب التجربة",
    "===",
    "",
    "## الباب الأول في العلم",
    "قال **المؤلف**: العلم نور يقذفه الله في القلب.",
    "> ومن سار على الدرب وصل",
    "---",
    "### فصل في آداب الطلب",
    "- الإخلاص في الطلب",
    "روى [البخاري](https://example.com) عن أبي هريرة حديثا.",
])


def _pages(content):
    return split_document_content_into_pages(content)


class MarkdownStrippingTests(SimpleTestCase):
    """The notebook's cell-level self-test, over the pages interface."""

    def test_sample_document(self):
        nd = normalize_pages(_pages(_SAMPLE_MD), 'test-book')
        self.assertEqual(meta_title(nd.meta), 'كتاب التجربة')
        for banned in ('**', '#', '](', '>', '='):
            self.assertNotIn(banned, nd.text)
        self.assertIn('قال المؤلف: العلم نور', nd.text)      # bold stripped
        self.assertIn('روى البخاري عن أبي هريرة', nd.text)   # link -> text
        self.assertIn('ومن سار على الدرب وصل', nd.text)      # blockquote stripped
        self.assertIn('الإخلاص في الطلب', nd.text)           # bullet stripped
        self.assertEqual([s.segment_type for s in nd.seeds],
                         [SegmentType.BOOK_PART, SegmentType.CHAPTER,
                          SegmentType.SECTION])
        for s in nd.seeds:
            if s.first_line:  # seed offset points at its own line, verbatim
                self.assertEqual(nd.text[s.offset:s.offset + 10],
                                 s.first_line[:10])


class PageMappingTests(SimpleTestCase):
    def test_page_offsets_and_labels(self):
        content = 'صفحة أولى\nسطر آخر\f\nصفحة ثانية\f\nصفحة ثالثة'
        nd = normalize_pages(_pages(content), 'doc_9')
        self.assertEqual(nd.page_labels, ['1', '2', '3'])
        self.assertEqual(len(nd.page_offsets), 3)
        self.assertEqual(page_for_offset(nd, 0), (None, '1'))
        # First char of page 2's text.
        self.assertEqual(page_for_offset(nd, nd.page_offsets[1]), (None, '2'))
        self.assertEqual(page_for_offset(nd, len(nd.text) - 1), (None, '3'))
        # Page slice sanity: page 2's text starts where its offset says.
        self.assertTrue(nd.text[nd.page_offsets[1]:].startswith('صفحة ثانية'))

    def test_db_title_wins_over_heading(self):
        nd = normalize_pages(_pages(_SAMPLE_MD), 'doc_9',
                             meta={'title': 'عنوان قاعدة البيانات'})
        self.assertEqual(meta_title(nd.meta), 'عنوان قاعدة البيانات')

    def test_arabic_orthography_untouched(self):
        content = 'قال أَبُو عَبْدِ اللهِ: الإسلامُ دينٌ.'
        nd = normalize_pages(_pages(content), 'doc_9')
        # Diacritics and hamza forms survive verbatim — only markdown and
        # whitespace are ever touched.
        self.assertIn('أَبُو عَبْدِ اللهِ', nd.text)
        self.assertIn('الإسلامُ', nd.text)


class NormalizeDocumentTests(TestCase):
    def test_document_fields_flow_through(self):
        doc = Document.objects.create(
            title='كتاب الطبقات', file='documents/t.txt',
            content='نص الصفحة الأولى\f\nنص الصفحة الثانية',
            ocr_engine_used='tesseract', processed=True)
        nd = normalize_document(doc)
        self.assertEqual(nd.book_id, f'doc_{doc.pk}')
        self.assertTrue(nd.ocr_source)
        self.assertEqual(meta_title(nd.meta), 'كتاب الطبقات')
        self.assertEqual(nd.page_labels, ['1', '2'])

    def test_tika_document_is_not_ocr_source(self):
        doc = Document.objects.create(
            title='ت', file='documents/t2.txt', content='نص',
            ocr_engine_used='', processed=True)
        self.assertFalse(normalize_document(doc).ocr_source)
