"""Tests for the multi-term in-document search
(``POST /documents/<pk>/search/query/`` → ``search_within_document_terms``).

The per-term lexical seam (``_es_lexical_stage_for_query``) and the embedding
call are patched; the side_effect keys off the term text inside the raw query
dict, so each term row gets its own deterministic fragment set.
"""
from unittest import mock

from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from search_engine.models import Document, DocumentChunk

User = get_user_model()

VIEWS = 'search_engine.views'


def _query_text(es_query: dict) -> str:
    """Pull the term text out of a build_inbook_term_query dict."""
    inner = es_query.get('match_phrase') or es_query.get('match') or {}
    for field_body in inner.values():
        return field_body['query']
    return ''


class InBookTermsApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='searcher', email='searcher@example.com', password='SearchPass123!')
        self.document = Document.objects.create(
            title='كتاب العلم',
            file='documents/ilm.txt',
            content='فضل العلم على الأول.\n\n\nفضل التعلم على الثاني.\n\n\nرياضة النفس على الثالث.',
        )
        DocumentChunk.objects.create(
            document=self.document, chunk_index=0, page_number=1,
            content='فضل العلم على الأول.', embedding=[1.0, 0.0, 0.0])
        DocumentChunk.objects.create(
            document=self.document, chunk_index=1, page_number=2,
            content='فضل التعلم على الثاني.', embedding=[0.6, 0.8, 0.0])
        DocumentChunk.objects.create(
            document=self.document, chunk_index=2, page_number=3,
            content='رياضة النفس على الثالث.', embedding=[0.0, 1.0, 0.0])
        self.client.force_authenticate(user=self.user)

    def _url(self, doc_id=None):
        return f'/api/search_engine/documents/{doc_id or self.document.id}/search/query/'

    def _post(self, **body):
        body.setdefault('terms', [{'text': 'العلم'}])
        return self.client.post(self._url(), body, format='json')

    @staticmethod
    def _fragments(mapping):
        """side_effect returning per-term fragments: {term_text: [(page, snippet), ...]}"""
        def stage(document, es_query, highlight_fields, pages):
            rows = mapping.get(_query_text(es_query), [])
            return [
                {'page_number': pn, 'snippet': snippet, 'es_score': 1.0}
                for pn, snippet in rows
            ]
        return stage

    # --- validation -------------------------------------------------------

    def test_empty_terms_rejected(self):
        resp = self._post(terms=[])
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_all_must_not_rejected(self):
        resp = self._post(terms=[{'text': 'ضعيف', 'op': 'must_not'}])
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_missing_document_404(self):
        resp = self.client.post(self._url(doc_id=999999),
                                {'terms': [{'text': 'العلم'}]}, format='json')
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    # --- boolean semantics ------------------------------------------------

    @mock.patch(f'{VIEWS}.build_embedding', return_value=[])
    @mock.patch(f'{VIEWS}._es_lexical_stage_for_query')
    def test_must_pages_intersect(self, stage, _embed):
        stage.side_effect = self._fragments({
            'العلم': [(1, '<mark>العلم</mark> أ'), (2, '<mark>العلم</mark> ب')],
            'التعلم': [(2, '<mark>التعلم</mark> ب')],
        })
        resp = self._post(terms=[
            {'text': 'العلم', 'op': 'must'},
            {'text': 'التعلم', 'op': 'must'},
        ], mode='all')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        pages = {m['page_number'] for m in resp.data['matches']}
        self.assertEqual(pages, {2})

    @mock.patch(f'{VIEWS}.build_embedding', return_value=[])
    @mock.patch(f'{VIEWS}._es_lexical_stage_for_query')
    def test_must_not_excludes_whole_pages(self, stage, _embed):
        stage.side_effect = self._fragments({
            'العلم': [(1, '<mark>العلم</mark> أ'), (2, '<mark>العلم</mark> ب')],
            'النفس': [(2, '<mark>النفس</mark> ب')],
        })
        resp = self._post(terms=[
            {'text': 'العلم', 'op': 'must'},
            {'text': 'النفس', 'op': 'must_not'},
        ], mode='all')
        pages = {m['page_number'] for m in resp.data['matches']}
        self.assertEqual(pages, {1})

    @mock.patch(f'{VIEWS}.build_embedding', return_value=[])
    @mock.patch(f'{VIEWS}._es_lexical_stage_for_query')
    def test_duplicate_fragments_union_matched_terms(self, stage, _embed):
        same = 'قال <mark>العلم</mark> نور'
        stage.side_effect = self._fragments({
            'العلم': [(1, same)],
            'نور': [(1, same)],
        })
        resp = self._post(terms=[
            {'text': 'العلم', 'op': 'must'},
            {'text': 'نور', 'op': 'must'},
        ], mode='all')
        matches = resp.data['matches']
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]['matched_terms'], [0, 1])

    @mock.patch(f'{VIEWS}.build_embedding', return_value=[])
    @mock.patch(f'{VIEWS}._es_lexical_stage_for_query')
    def test_should_terms_add_fragments_without_gating(self, stage, _embed):
        stage.side_effect = self._fragments({
            'العلم': [(1, '<mark>العلم</mark> أ')],
            'رياضة': [(3, '<mark>رياضة</mark> ج')],
        })
        resp = self._post(terms=[
            {'text': 'العلم', 'op': 'must'},
            {'text': 'رياضة', 'op': 'should'},
        ], mode='all')
        # Must gate: only pages where the must term matched survive; the
        # should fragment on page 3 falls outside the must pages.
        pages = {m['page_number'] for m in resp.data['matches']}
        self.assertEqual(pages, {1})

    @mock.patch(f'{VIEWS}.build_embedding', return_value=[1.0, 0.0, 0.0])
    @mock.patch(f'{VIEWS}._es_lexical_stage_for_query')
    def test_semantic_merge_respects_must_gate(self, stage, _embed):
        # Must term matches only page 2; page 1 has cosine 1.0 but must not
        # surface as a semantic-only match (must gate).
        stage.side_effect = self._fragments({
            'التعلم': [(2, '<mark>التعلم</mark> ب')],
        })
        resp = self._post(terms=[{'text': 'التعلم', 'op': 'must'}], mode='all')
        pages = {m['page_number'] for m in resp.data['matches']}
        self.assertEqual(pages, {2})
        by_page = {m['page_number']: m for m in resp.data['matches']}
        self.assertEqual(by_page[2]['matched_terms'], [0])

    @mock.patch(f'{VIEWS}.build_embedding', return_value=[])
    @mock.patch(f'{VIEWS}._es_lexical_stage_for_query')
    def test_match_kind_per_term(self, stage, _embed):
        stage.side_effect = self._fragments({
            'فضل العلم': [(1, '<mark>فضل العلم</mark>')],
            'رياضة': [(1, '<mark>رياضة</mark>')],
        })
        resp = self._post(terms=[
            {'text': 'فضل العلم', 'match': 'phrase', 'op': 'must'},
            {'text': 'رياضة', 'match': 'stem', 'op': 'should'},
        ], mode='all')
        kinds = {tuple(m['matched_terms']): m['match_kind'] for m in resp.data['matches']}
        self.assertEqual(kinds[(0,)], 'exact')
        self.assertEqual(kinds[(1,)], 'lexical')

    @mock.patch(f'{VIEWS}.build_embedding', return_value=[])
    @mock.patch(f'{VIEWS}._es_lexical_stage_for_query')
    def test_query_echo_is_composed_positive_text(self, stage, _embed):
        stage.side_effect = self._fragments({'العلم': [(1, '<mark>العلم</mark>')]})
        resp = self._post(terms=[
            {'text': 'العلم', 'op': 'must'},
            {'text': 'ضعيف', 'op': 'must_not'},
        ], mode='all')
        self.assertEqual(resp.data['query'], 'العلم')
        self.assertEqual(resp.data['mode'], 'all')
