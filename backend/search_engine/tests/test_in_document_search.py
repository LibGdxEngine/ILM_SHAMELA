"""Tests for the 5-mode in-document search (exact/similar/semantic/mix/all).

The Elasticsearch lexical stage (``_es_lexical_stage``) and the embedding call
(``build_embedding``) are patched so the mode branching, threshold filtering and
score-shape are exercised deterministically without a live ES / embedding API.
``all`` mode calls the lexical seam twice (phrase then fuzzy), so its tests use
a ``side_effect`` keyed on the ``phrase`` kwarg.
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
    def test_exact_mode_ranks_by_mark_density_not_doc_score(self, es):
        # ES assigns ONE doc-level score to every highlight fragment (the index
        # holds one document per book), so ranking must come from mark density,
        # not es_score — otherwise every match ties at score_final 1.0.
        es.return_value = [
            {'page_number': 2, 'snippet': 'فضل <mark>العلم</mark>', 'es_score': 7.0},
            {'page_number': 1, 'snippet': '<mark>العلم</mark> ثم <mark>العلم</mark> الأول', 'es_score': 7.0},
        ]
        resp = self.client.get(self._url(q='العلم', mode='exact'))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        matches = resp.data['matches']
        self.assertEqual(len(matches), 2)
        # Two-mark fragment on page 1 outranks the single-mark one on page 2.
        self.assertEqual(matches[0]['page_number'], 1)
        self.assertGreater(matches[0]['score_final'], matches[1]['score_final'])
        for m in matches:
            self.assertIsNone(m['score_semantic'])
            self.assertEqual(m['score_final'], m['score_lexical'])
            self.assertEqual(m['match_kind'], 'exact')

    @mock.patch(f'{VIEWS}._es_lexical_stage')
    def test_similar_mode_stamps_lexical_kind(self, es):
        es.return_value = [
            {'page_number': 2, 'snippet': 'فضل <mark>التعلم</mark>', 'es_score': 3.0},
        ]
        resp = self.client.get(self._url(q='العلم', mode='similar'))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['mode'], 'similar')
        match = resp.data['matches'][0]
        self.assertEqual(match['match_kind'], 'lexical')
        self.assertIsNone(match['score_semantic'])
        self.assertFalse(resp.data['has_semantic'])

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

    @mock.patch(f'{VIEWS}.build_embedding', return_value=[1.0, 0.0, 0.0])
    @mock.patch(f'{VIEWS}._es_lexical_stage')
    def test_mix_mode_single_es_call_blend_and_kinds(self, es, _embed):
        # mix stays a single (fuzzy) ES call — the agent tools and RAG default
        # to it, so 'all' must not silently multiply their ES load.
        es.return_value = [
            {'page_number': 3, 'snippet': 'رياضة <mark>النفس</mark>', 'es_score': 5.0},
        ]
        resp = self.client.get(self._url(q='العلم', mode='mix', threshold='0.5'))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        es.assert_called_once()
        self.assertFalse(es.call_args.kwargs['phrase'])
        by_page = {m['page_number']: m for m in resp.data['matches']}
        # Lexical hit on page 3: sole fragment → norm_lex 1.0; page-3 sim 0.0.
        self.assertEqual(by_page[3]['match_kind'], 'lexical')
        self.assertAlmostEqual(by_page[3]['score_final'], 0.6, places=4)
        # Pages 1 & 2 merged from the semantic side (sim 1.0 / 0.6 ≥ 0.5).
        self.assertEqual(by_page[1]['match_kind'], 'semantic')
        self.assertEqual(by_page[2]['match_kind'], 'semantic')
        self.assertAlmostEqual(by_page[1]['score_final'], 0.4, places=4)

    # --- All mode -----------------------------------------------------------

    @mock.patch(f'{VIEWS}.build_embedding', return_value=[0.0, 1.0, 0.0])
    @mock.patch(f'{VIEWS}._es_lexical_stage')
    def test_all_mode_classifies_match_kinds_and_dedupes(self, es, _embed):
        # Query vector [0,1,0] → page sims: p1 0.0, p2 0.8, p3 1.0.
        exact_frags = [
            {'page_number': 1, 'snippet': 'فضل <mark>العلم</mark> على الأول', 'es_score': 9.0},
        ]
        fuzzy_frags = [
            # Duplicates the exact fragment (same page + contained text) → dropped.
            {'page_number': 1, 'snippet': 'فضل <mark>العلم</mark> على الأول', 'es_score': 9.0},
            {'page_number': 2, 'snippet': 'فضل <mark>التعلم</mark> على الثاني', 'es_score': 9.0},
        ]

        def fake_stage(document, query, pages, *, phrase, ignore_diacritics=True):
            return exact_frags if phrase else fuzzy_frags

        es.side_effect = fake_stage
        resp = self.client.get(self._url(q='العلم', mode='all', threshold='0.5'))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['mode'], 'all')
        self.assertEqual(es.call_count, 2)
        self.assertEqual([c.kwargs['phrase'] for c in es.call_args_list], [True, False])
        matches = resp.data['matches']
        kinds = {m['page_number']: m['match_kind'] for m in matches}
        # p1 exact (fuzzy duplicate absorbed), p2 lexical, p3 merged semantic.
        self.assertEqual(kinds, {1: 'exact', 2: 'lexical', 3: 'semantic'})
        self.assertEqual(len(matches), 3)  # duplicate dropped, not double-counted

    @mock.patch(f'{VIEWS}.build_embedding', return_value=[1.0, 0.0, 0.0])
    @mock.patch(f'{VIEWS}._es_lexical_stage', return_value=[])
    def test_all_mode_falls_back_to_semantic_when_no_lexical(self, es, _embed):
        resp = self.client.get(self._url(q='العلم', mode='all'))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(es.call_count, 2)  # phrase + fuzzy both tried
        pages = sorted(m['page_number'] for m in resp.data['matches'])
        self.assertEqual(pages, [1, 2])  # lenient 0.3 bar: sims 1.0 and 0.6
        for m in resp.data['matches']:
            self.assertEqual(m['match_kind'], 'semantic')
        self.assertTrue(resp.data['has_semantic'])

    # --- Response envelope / params -----------------------------------------

    @mock.patch(f'{VIEWS}.build_embedding', return_value=[1.0, 0.0, 0.0])
    @mock.patch(f'{VIEWS}._es_lexical_stage', return_value=[])
    def test_mode_echoed_in_response_for_all_modes(self, _es, _embed):
        for mode in ('exact', 'similar', 'semantic', 'mix', 'all'):
            resp = self.client.get(self._url(q='العلم', mode=mode))
            self.assertEqual(resp.status_code, status.HTTP_200_OK, mode)
            self.assertEqual(resp.data['mode'], mode)

    @mock.patch(f'{VIEWS}._es_lexical_stage', return_value=[])
    def test_ignore_diacritics_param_plumbed_to_lexical_stage(self, es):
        self.client.get(self._url(q='العلم', mode='similar', ignore_diacritics='0'))
        self.assertFalse(es.call_args.kwargs['ignore_diacritics'])

        es.reset_mock()
        self.client.get(self._url(q='العلم', mode='similar'))
        self.assertTrue(es.call_args.kwargs['ignore_diacritics'])

        es.reset_mock()
        # Garbage values fall back to the default (insensitive).
        self.client.get(self._url(q='العلم', mode='similar', ignore_diacritics='banana'))
        self.assertTrue(es.call_args.kwargs['ignore_diacritics'])
