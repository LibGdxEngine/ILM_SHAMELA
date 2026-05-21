from unittest.mock import patch, MagicMock

from django.test import SimpleTestCase

from search_engine import ocr as ocr_registry
from search_engine.ocr import OCREngineClient, OCRUnavailable


class OCREngineClientNormalizationTests(SimpleTestCase):
    """Verify that the OCR engine HTTP client preserves layout-aware extras when present."""

    def _client(self):
        return OCREngineClient(name='docling', label='Docling', url='http://docling-test:7860')

    def _mock_post(self, payload, status_code=200):
        response = MagicMock()
        response.status_code = status_code
        response.json.return_value = payload
        response.text = '<mocked>'
        return response

    @patch('search_engine.ocr.requests.post')
    def test_passes_through_markdown_and_tables_when_provided(self, mock_post):
        mock_post.return_value = self._mock_post({
            'pages': [
                {
                    'page_number': 1,
                    'content': 'Hello world',
                    'markdown': '# Hello world',
                    'tables': [{'markdown': '|a|b|\n|-|-|\n|1|2|', 'html': '<table>...</table>'}],
                },
                {
                    'page_number': 2,
                    'content': 'Plain page',
                },
            ],
        })

        pages = self._client().parse(b'%PDF-1.4 fake', 'sample.pdf')

        self.assertEqual(len(pages), 2)
        self.assertEqual(pages[0]['page_number'], 1)
        self.assertEqual(pages[0]['content'], 'Hello world')
        self.assertEqual(pages[0]['markdown'], '# Hello world')
        self.assertEqual(len(pages[0]['tables']), 1)
        self.assertEqual(pages[0]['tables'][0]['html'], '<table>...</table>')

        # Plain page omits markdown/tables — extras should not be fabricated.
        self.assertEqual(pages[1]['content'], 'Plain page')
        self.assertNotIn('markdown', pages[1])
        self.assertNotIn('tables', pages[1])

    @patch('search_engine.ocr.requests.post')
    def test_drops_empty_pages_and_blank_extras(self, mock_post):
        mock_post.return_value = self._mock_post({
            'pages': [
                {'page_number': 1, 'content': '   '},                # dropped: empty content
                {'page_number': 2, 'content': 'Real content', 'markdown': '   '},  # markdown stripped
                {'page_number': 3, 'content': 'More', 'tables': []},  # empty tables list dropped
            ],
        })

        pages = self._client().parse(b'%PDF', 'x.pdf')

        self.assertEqual([p['page_number'] for p in pages], [2, 3])
        self.assertNotIn('markdown', pages[0])
        self.assertNotIn('tables', pages[1])

    @patch('search_engine.ocr.requests.post')
    def test_empty_response_raises_unavailable(self, mock_post):
        mock_post.return_value = self._mock_post({'pages': []})
        with self.assertRaises(OCRUnavailable):
            self._client().parse(b'%PDF', 'x.pdf')


class RegistryTests(SimpleTestCase):
    def test_docling_is_registered(self):
        self.assertIn('docling', ocr_registry.REGISTRY)
        engine = ocr_registry.REGISTRY['docling']
        self.assertEqual(engine.name, 'docling')
        self.assertIn('layout', engine.label.lower())
