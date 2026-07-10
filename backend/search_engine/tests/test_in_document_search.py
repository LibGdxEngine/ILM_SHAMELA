"""Tests for the 4-mode in-document search.

The Elasticsearch lexical stage (``_es_lexical_stage``) and the embedding call
(``build_embedding``) are patched so the mode branching, threshold filtering and
score-shape are exercised deterministically without a live ES / embedding API.
"""
from unittest import mock

from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from search_engine.models import Document, DocumentChunk


User = get_user_model()

VIEWS = 'search_engine.views'


class InDocumentSearchModeTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='searcher',
            email='searcher@example.com',
            password='SearchPass123!',
        )
        # Three pages of content; pages split on blank-line boundaries.
        self.document = Document.objects.create(
            title='كتاب العلم',
            file='documents/ilm.txt',
            content='فضل العلم على الأول.\n\n\nفضل التعلم على الثاني.\n\n\nرياضة النفس على الثالث.',
        )
        # Per-page embeddings. Query vector below is [1,0,0]; dot product = cosine.
        DocumentChunk.objects.create(
            document=self.document, chunk_index=0, page_number=1,
            content='فضل العلم على الأول.', embedding=[1.0, 0.0, 0.0],
        )  # sim 1.0
        DocumentChunk.objects.create(
            document=self.document, chunk_index=1, page_number=2,
            content='فضل التعلم على الثاني.', embedding=[0.6, 0.8, 0.0],
        )  # sim 0.6
        DocumentChunk.objects.create(
            document=self.document, chunk_index=2, page_number=3,
            content='رياضة النفس على الثالث.', embedding=[0.0, 1.0, 0.0],
        )  # sim 0.0
        self.client.force_authenticate(user=self.user)

    def _url(self, **params):
        from urllib.parse import urlencode
        base = f'/api/search_engine/documents/{self.document.id}/search/'
        return f'{base}?{urlencode(params)}'

    # --- Param validation -------------------------------------------------

    def test_missing_query_returns_400(self):
        resp = self.client.get(self._url(mode='mix'))
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_invalid_mode_returns_400(self):
        resp = self.client.get(self._url(q='العلم', mode='bogus'))
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_unauthenticated_returns_401_or_403(self):
        self.client.force_authenticate(user=None)
        resp = self.client.get(self._url(q='العلم', mode='mix'))
        self.assertIn(
            resp.status_code,
            {status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN},
        )

    # --- Semantic mode ----------------------------------------------------

    @mock.patch(f'{VIEWS}.build_embedding', return_value=[1.0, 0.0, 0.0])
    def test_semantic_mode_filters_by_threshold(self, _embed):
        # threshold 0.5 → pages 1 (1.0) and 2 (0.6); page 3 (0.0) excluded.
        resp = self.client.get(self._url(q='العلم', mode='semantic', threshold='0.5'))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        pages = sorted(m['page_number'] for m in resp.data['matches'])
        self.assertEqual(pages, [1, 2])
        self.assertTrue(resp.data['has_semantic'])
        # Ranked by semantic score, page 1 first.
        self.assertEqual(resp.data['matches'][0]['page_number'], 1)
        self.assertIsNotNone(resp.data['matches'][0]['score_semantic'])

    @mock.patch(f'{VIEWS}.build_embedding', return_value=[1.0, 0.0, 0.0])
    def test_semantic_mode_high_threshold_narrows_results(self, _embed):
        resp = self.client.get(self._url(q='العلم', mode='semantic', threshold='0.9'))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        pages = [m['page_number'] for m in resp.data['matches']]
        self.assertEqual(pages, [1])  # only sim 1.0 clears 0.9

    # --- Lexical-only modes (no semantic fallback) ------------------------

    @mock.patch(f'{VIEWS}.build_embedding', return_value=[1.0, 0.0, 0.0])
    @mock.patch(f'{VIEWS}._es_lexical_stage', return_value=[])
    def test_similar_mode_no_lexical_hits_does_not_fall_back_to_semantic(self, _es, _embed):
        # Even though chunks would match semantically, similar mode must stay empty.
        resp = self.client.get(self._url(q='العلم', mode='similar'))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['total_matches'], 0)
        self.assertFalse(resp.data['has_semantic'])

    @mock.patch(f'{VIEWS}._es_lexical_stage')
    def test_exact_mode_returns_lexical_only_no_semantic_score(self, es):
        es.return_value = [
            {'page_number': 2, 'snippet': 'فضل <mark>العلم</mark>', 'es_score': 4.0},
            {'page_number': 1, 'snippet': '<mark>العلم</mark> الأول', 'es_score': 8.0},
        ]
        resp = self.client.get(self._url(q='العلم', mode='exact'))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        matches = resp.data['matches']
        self.assertEqual(len(matches), 2)
        # Ranked by normalized lexical score (page 1 has the higher es_score).
        self.assertEqual(matches[0]['page_number'], 1)
        for m in matches:
            self.assertIsNone(m['score_semantic'])
            self.assertEqual(m['score_final'], m['score_lexical'])

    # --- Mix mode ---------------------------------------------------------

    @mock.patch(f'{VIEWS}.build_embedding', return_value=[1.0, 0.0, 0.0])
    @mock.patch(f'{VIEWS}._es_lexical_stage')
    def test_mix_merges_semantic_only_pages_above_threshold(self, es, _embed):
        # Lexical hit only on page 3 (semantically weak). Pages 1 & 2 should be
        # merged in from the semantic side (sim 1.0 / 0.6 >= 0.5).
        es.return_value = [
            {'page_number': 3, 'snippet': 'رياضة <mark>النفس</mark>', 'es_score': 5.0},
        ]
        resp = self.client.get(self._url(q='العلم', mode='mix', threshold='0.5'))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        pages = {m['page_number'] for m in resp.data['matches']}
        self.assertEqual(pages, {1, 2, 3})
        self.assertTrue(resp.data['has_semantic'])

    @mock.patch(f'{VIEWS}.build_embedding', return_value=[1.0, 0.0, 0.0])
    @mock.patch(f'{VIEWS}._es_lexical_stage', return_value=[])
    def test_mix_falls_back_to_semantic_when_no_lexical_hits(self, _es, _embed):
        resp = self.client.get(self._url(q='العلم', mode='mix', threshold='0.5'))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        pages = sorted(m['page_number'] for m in resp.data['matches'])
        self.assertEqual(pages, [1, 2])

    def test_default_mode_is_mix(self):
        # No mode param, ES unavailable in tests → graceful empty (200), not 400/500.
        with mock.patch(f'{VIEWS}._es_lexical_stage', return_value=[]):
            resp = self.client.get(self._url(q='العلم'))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['query'], 'العلم')
