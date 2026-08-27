"""OCREngineClient.words() / supports_words() — the sidecar word-geometry contract."""
import json
from unittest.mock import MagicMock, patch

import requests
from django.test import SimpleTestCase

from search_engine.ocr import OCREngineClient, OCRUnavailable


def _response(status=200, payload=None, json_error=False):
    response = MagicMock()
    response.status_code = status
    response.text = 'body'
    if json_error:
        response.json.side_effect = ValueError('bad json')
    else:
        response.json.return_value = payload if payload is not None else {}
    return response


class WordsClientTests(SimpleTestCase):
    def setUp(self):
        self.client = OCREngineClient(name='tesseract', label='t', url='http://ocr:7860')

    @patch('search_engine.ocr.requests.post')
    def test_words_posts_image_and_form_fields(self, post):
        post.return_value = _response(payload={'width': 10, 'height': 20, 'regions': []})
        regions = [{'id': '0', 'bbox': [1, 2, 3, 4], 'psm': 6}]
        payload = self.client.words(b'png-bytes', regions, lang='ara', psm=6, pad=6, dpi=300)
        self.assertEqual(payload['regions'], [])
        args, kwargs = post.call_args
        self.assertEqual(args[0], 'http://ocr:7860/words')
        self.assertEqual(kwargs['files']['file'], ('page.png', b'png-bytes', 'image/png'))
        self.assertEqual(json.loads(kwargs['data']['regions']), regions)
        self.assertEqual(kwargs['data']['lang'], 'ara')
        self.assertEqual(kwargs['data']['psm'], '6')
        self.assertEqual(kwargs['data']['pad'], '6')
        self.assertEqual(kwargs['data']['dpi'], '300')
        self.assertEqual(kwargs['timeout'], 180)

    @patch('search_engine.ocr.requests.post')
    def test_words_omits_dpi_when_not_given_and_honours_timeout(self, post):
        post.return_value = _response(payload={'regions': []})
        self.client.words(b'x', [], timeout=7)
        self.assertNotIn('dpi', post.call_args.kwargs['data'])
        self.assertEqual(post.call_args.kwargs['timeout'], 7)

    def test_words_requires_configured_url(self):
        with self.assertRaises(OCRUnavailable):
            OCREngineClient(name='tesseract', label='t', url='').words(b'x', [])

    @patch('search_engine.ocr.requests.post', side_effect=requests.ConnectionError('down'))
    def test_words_transport_error(self, _post):
        with self.assertRaises(OCRUnavailable):
            self.client.words(b'x', [])

    @patch('search_engine.ocr.requests.post')
    def test_words_non_200(self, post):
        post.return_value = _response(status=500)
        with self.assertRaises(OCRUnavailable):
            self.client.words(b'x', [])

    @patch('search_engine.ocr.requests.post')
    def test_words_non_json(self, post):
        post.return_value = _response(json_error=True)
        with self.assertRaises(OCRUnavailable):
            self.client.words(b'x', [])

    @patch('search_engine.ocr.requests.post')
    def test_words_missing_regions(self, post):
        post.return_value = _response(payload={'width': 1})
        with self.assertRaises(OCRUnavailable):
            self.client.words(b'x', [])


class SupportsWordsTests(SimpleTestCase):
    def setUp(self):
        self.client = OCREngineClient(name='tesseract', label='t', url='http://ocr:7860')

    @patch('search_engine.ocr.requests.get')
    def test_true_when_health_advertises_words(self, get):
        get.return_value = _response(payload={'status': 'ok', 'features': ['parse', 'words']})
        self.assertTrue(self.client.supports_words())
        self.assertEqual(get.call_args.args[0], 'http://ocr:7860/health')

    @patch('search_engine.ocr.requests.get')
    def test_false_without_feature(self, get):
        get.return_value = _response(payload={'status': 'ok', 'features': ['parse']})
        self.assertFalse(self.client.supports_words())
        get.return_value = _response(payload={'status': 'ok'})
        self.assertFalse(self.client.supports_words())

    @patch('search_engine.ocr.requests.get')
    def test_none_when_probe_is_inconclusive(self, get):
        # A busy/unreachable sidecar is "unknown", never "lacks the feature": the
        # backfill must proceed and let /words itself fail (→ retry) if it is down.
        get.return_value = _response(status=503, payload={'features': ['words']})
        self.assertIsNone(self.client.supports_words())
        get.side_effect = requests.Timeout('slow')
        self.assertIsNone(self.client.supports_words())
        get.side_effect = None
        get.return_value = _response(status=200, json_error=True)
        self.assertIsNone(self.client.supports_words())
        self.assertEqual(get.call_args.kwargs.get('timeout'), 15)

    @patch('search_engine.ocr.requests.get')
    def test_false_when_not_configured(self, get):
        self.assertFalse(OCREngineClient(name='tesseract', label='t', url='').supports_words())
        get.assert_not_called()
