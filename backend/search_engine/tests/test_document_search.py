"""Tests for the corpus-wide DocumentSearchView (``/documents/search/``).

The Elasticsearch connection (``connections.get_connection``) and the embedding
call (``build_embedding``) are patched so the three search modes
(``exact``/``semantic``/``hybrid``), the ES-side filter pushdown, snippet
extraction and the degraded-reason signal are exercised deterministically
without a live ES / embedding API. Raw ES response dicts are hand-built keyed by
the real seeded ``Document`` fixture ids.
"""
import json
from unittest import mock

from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from search_engine.models import Author, Category, Document
from search_engine.semantic import VECTOR_DIMENSIONS


User = get_user_model()

VIEWS = 'search_engine.views'

# A well-formed query vector (len == VECTOR_DIMENSIONS) enables the kNN gate;
# an empty list stands in for "embedding unavailable".
KNN_VECTOR = [0.01] * VECTOR_DIMENSIONS
NO_VECTOR = []


class CorpusSearchTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='searcher',
            email='searcher@example.com',
            password='SearchPass123!',
        )

        self.author_one = Author.objects.create(name='المؤلف الأول')
        self.author_two = Author.objects.create(name='المؤلف الثاني')
        self.cat_fiqh = Category.objects.create(name='فقه')
        self.cat_history = Category.objects.create(name='تاريخ')

        # doc_a / doc_c: Arabic + فقه + author_one; doc_b: English + تاريخ + author_two.
        self.doc_a = Document.objects.create(title='كتاب الألف', content='alpha', language='ar')
        self.doc_a.authors.add(self.author_one)
        self.doc_a.categories.add(self.cat_fiqh)

        self.doc_b = Document.objects.create(title='كتاب الباء', content='beta', language='en')
        self.doc_b.authors.add(self.author_two)
        self.doc_b.categories.add(self.cat_history)

        self.doc_c = Document.objects.create(title='كتاب الجيم', content='gamma', language='ar')
        self.doc_c.authors.add(self.author_one)
        self.doc_c.categories.add(self.cat_fiqh)

        self.client.force_authenticate(user=self.user)

    # --- helpers ----------------------------------------------------------

    def _url(self, **params):
        from urllib.parse import urlencode
        return f'/api/search_engine/documents/search/?{urlencode(params)}'

    def _raw_hits(self, *entries):
        """Build a raw ES response. Each entry is ``(doc, score, highlight)``;
        pass ``highlight=None`` to omit the highlight key entirely."""
        hits = []
        for doc, score, highlight in entries:
            hit = {'_id': str(doc.id), '_score': score}
            if highlight is not None:
                hit['highlight'] = highlight
            hits.append(hit)
        return {'hits': {'hits': hits}}

    def _all_hits(self):
        return self._raw_hits(
            (self.doc_a, 8.0, {'content': ['<mark>alpha</mark> text']}),
            (self.doc_b, 4.0, {'title': ['<mark>الباء</mark>']}),
            (self.doc_c, 2.0, {'content': ['<mark>gamma</mark> text']}),
        )

    def _conn(self, search_return=None, side_effect=None):
        conn = mock.MagicMock()
        if side_effect is not None:
            conn.search.side_effect = side_effect
        else:
            conn.search.return_value = search_return
        return conn

    def _body_of(self, get_conn):
        return get_conn.return_value.search.call_args.kwargs['body']

    # --- auth / param validation -----------------------------------------

    def test_unauthenticated_returns_401_or_403(self):
        self.client.force_authenticate(user=None)
        resp = self.client.get(self._url(q='كتاب'))
        self.assertIn(
            resp.status_code,
            {status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN},
        )

    def test_missing_query_returns_400(self):
        resp = self.client.get(self._url(mode='hybrid'))
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_invalid_mode_returns_400(self):
        resp = self.client.get(self._url(q='كتاب', mode='bogus'))
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('Invalid mode', resp.data['error'])

    @mock.patch(f'{VIEWS}.build_embedding', return_value=KNN_VECTOR)
    @mock.patch(f'{VIEWS}.connections.get_connection')
    def test_missing_mode_defaults_to_hybrid(self, get_conn, _embed):
        get_conn.return_value = self._conn(self._all_hits())
        resp = self.client.get(self._url(q='كتاب'))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        # A valid vector + no explicit mode → hybrid path (BM25 + kNN merged in
        # Python by execute_corpus_search; never the licensed rank.rrf).
        self.assertEqual(resp.data['results'][0]['explanations']['method'], 'hybrid')

    # --- hybrid mode ------------------------------------------------------

    @mock.patch(f'{VIEWS}.build_embedding', return_value=KNN_VECTOR)
    @mock.patch(f'{VIEWS}.connections.get_connection')
    def test_hybrid_with_knn_reproduces_existing_shape(self, get_conn, _embed):
        conn = self._conn(self._all_hits())
        get_conn.return_value = conn
        resp = self.client.get(self._url(q='كتاب', mode='hybrid'))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        top = resp.data['results'][0]  # doc_a, _score 8.0 → normalized 1.0
        # Both signals fire and blend (0.60*lex + 0.40*sem); with identical mocked
        # BM25 and kNN scores the normalized lexical/semantic/final all agree.
        self.assertEqual(top['score_lexical'], top['score_semantic'])
        self.assertEqual(top['score_lexical'], top['score_final'])
        # Hybrid now runs BM25 + kNN as two separate, license-free ES requests
        # merged in Python — no licensed rank.rrf fusion.
        self.assertEqual(top['explanations']['method'], 'hybrid')
        self.assertEqual(conn.search.call_count, 2)
        lex_body, knn_body = [c.kwargs['body'] for c in conn.search.call_args_list]
        self.assertIn('query', lex_body)   # first request: lexical (BM25)
        self.assertNotIn('knn', lex_body)
        self.assertIn('knn', knn_body)     # second request: semantic (kNN)
        self.assertNotIn('query', knn_body)
        # rank.rrf is a licensed feature and must never be requested by either.
        self.assertNotIn('rank', lex_body)
        self.assertNotIn('rank', knn_body)

    @mock.patch(f'{VIEWS}.build_embedding', return_value=NO_VECTOR)
    @mock.patch(f'{VIEWS}.connections.get_connection')
    def test_hybrid_degrades_to_bm25_when_embedding_unavailable(self, get_conn, _embed):
        get_conn.return_value = self._conn(self._all_hits())
        resp = self.client.get(self._url(q='كتاب', mode='hybrid'))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        top = resp.data['results'][0]
        self.assertEqual(top['explanations']['method'], 'bm25')
        # CRITICAL backward-compat: hybrid's non-kNN path emits float 0.0, NOT None.
        self.assertEqual(top['score_semantic'], 0.0)
        self.assertIsInstance(top['score_semantic'], float)
        self.assertIsNotNone(top['score_semantic'])
        body = self._body_of(get_conn)
        self.assertNotIn('knn', body)
        self.assertNotIn('rank', body)

    # --- exact mode -------------------------------------------------------

    @mock.patch(f'{VIEWS}.build_embedding')
    @mock.patch(f'{VIEWS}.connections.get_connection')
    def test_exact_mode_skips_embedding_and_nulls_semantic(self, get_conn, embed):
        get_conn.return_value = self._conn(self._all_hits())
        resp = self.client.get(self._url(q='كتاب', mode='exact'))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        embed.assert_not_called()  # no embedding API round-trip in exact mode
        top = resp.data['results'][0]
        self.assertIsNone(top['score_semantic'])
        self.assertEqual(top['explanations']['method'], 'bm25')

    @mock.patch(f'{VIEWS}.build_embedding')
    @mock.patch(f'{VIEWS}.connections.get_connection')
    def test_exact_mode_body_has_no_knn_or_rank(self, get_conn, _embed):
        get_conn.return_value = self._conn(self._all_hits())
        self.client.get(self._url(q='كتاب', mode='exact'))
        body = self._body_of(get_conn)
        self.assertIn('query', body)
        self.assertNotIn('knn', body)
        self.assertNotIn('rank', body)

    # --- semantic mode ----------------------------------------------------

    @mock.patch(f'{VIEWS}.build_embedding', return_value=KNN_VECTOR)
    @mock.patch(f'{VIEWS}.connections.get_connection')
    def test_semantic_mode_body_has_knn_only_and_nulls_lexical(self, get_conn, _embed):
        get_conn.return_value = self._conn(self._all_hits())
        resp = self.client.get(self._url(q='كتاب', mode='semantic'))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        body = self._body_of(get_conn)
        self.assertIn('knn', body)
        self.assertNotIn('query', body)
        self.assertNotIn('rank', body)
        top = resp.data['results'][0]
        self.assertIsNone(top['score_lexical'])
        self.assertEqual(top['explanations']['method'], 'knn')

    @mock.patch(f'{VIEWS}.build_embedding', return_value=NO_VECTOR)
    @mock.patch(f'{VIEWS}.connections.get_connection')
    def test_semantic_mode_without_embedding_returns_degraded_empty(self, get_conn, _embed):
        conn = self._conn(self._all_hits())
        get_conn.return_value = conn
        resp = self.client.get(self._url(q='كتاب', mode='semantic'))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['count'], 0)
        self.assertEqual(resp.data['results'], [])
        self.assertEqual(resp.data['degraded_reason'], 'embedding_unavailable')
        # No lexical fallback → ES is never queried.
        conn.search.assert_not_called()

    # --- documents scope filter ------------------------------------------

    @mock.patch(f'{VIEWS}.build_embedding', return_value=NO_VECTOR)
    @mock.patch(f'{VIEWS}.connections.get_connection')
    def test_documents_filter_pushed_into_es_and_narrows(self, get_conn, _embed):
        get_conn.return_value = self._conn(self._all_hits())
        resp = self.client.get(self._url(q='كتاب', mode='exact', documents=str(self.doc_a.id)))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        # Pushed into the ES bool.filter (ids kept as strings).
        filters = self._body_of(get_conn)['query']['bool']['filter']
        self.assertIn({'terms': {'_id': [str(self.doc_a.id)]}}, filters)
        # And Django-side apply_document_filters narrows the mocked hits.
        self.assertEqual([r['id'] for r in resp.data['results']], [self.doc_a.id])

    @mock.patch(f'{VIEWS}.build_embedding', return_value=KNN_VECTOR)
    @mock.patch(f'{VIEWS}.connections.get_connection')
    def test_documents_filter_pushed_into_knn_clause(self, get_conn, _embed):
        get_conn.return_value = self._conn(self._all_hits())
        resp = self.client.get(self._url(q='كتاب', mode='semantic', documents=str(self.doc_a.id)))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        knn = self._body_of(get_conn)['knn']
        self.assertEqual(knn['filter'], {'bool': {'filter': [{'terms': {'_id': [str(self.doc_a.id)]}}]}})

    @mock.patch(f'{VIEWS}.build_embedding', return_value=NO_VECTOR)
    @mock.patch(f'{VIEWS}.connections.get_connection')
    def test_documents_filter_ignores_invalid_ids(self, get_conn, _embed):
        get_conn.return_value = self._conn(self._all_hits())
        resp = self.client.get(self._url(
            q='كتاب', mode='exact',
            documents=f'{self.doc_a.id},abc,{self.doc_c.id}',
        ))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        filters = self._body_of(get_conn)['query']['bool']['filter']
        # Non-digit 'abc' dropped; the two valid ids survive as strings.
        self.assertIn(
            {'terms': {'_id': [str(self.doc_a.id), str(self.doc_c.id)]}},
            filters,
        )
        self.assertEqual(
            sorted(r['id'] for r in resp.data['results']),
            sorted([self.doc_a.id, self.doc_c.id]),
        )

    # --- other filters (category / language / date) ----------------------

    @mock.patch(f'{VIEWS}.build_embedding', return_value=NO_VECTOR)
    @mock.patch(f'{VIEWS}.connections.get_connection')
    def test_category_language_date_filters_pushed_into_es(self, get_conn, _embed):
        get_conn.return_value = self._conn(self._all_hits())
        resp = self.client.get(self._url(
            q='كتاب', mode='exact',
            categories='فقه', language='ar', date_from='2000-01-01',
        ))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        filters = self._body_of(get_conn)['query']['bool']['filter']
        self.assertIn({'terms': {'categories': ['فقه']}}, filters)
        self.assertIn({'term': {'language': 'ar'}}, filters)
        self.assertIn({'range': {'uploaded_at': {'gte': '2000-01-01'}}}, filters)

    @mock.patch(f'{VIEWS}.build_embedding', return_value=NO_VECTOR)
    @mock.patch(f'{VIEWS}.connections.get_connection')
    def test_invalid_date_is_silently_dropped(self, get_conn, _embed):
        get_conn.return_value = self._conn(self._all_hits())
        self.client.get(self._url(q='كتاب', mode='exact', date_from='not-a-date'))
        # Bad date → no filter clause → query stays a bare bm25 dict (no bool wrap).
        self.assertNotIn('bool', self._body_of(get_conn)['query'])

    @mock.patch(f'{VIEWS}.build_embedding', return_value=NO_VECTOR)
    @mock.patch(f'{VIEWS}.connections.get_connection')
    def test_authors_filter_is_django_side_only(self, get_conn, _embed):
        get_conn.return_value = self._conn(self._all_hits())
        # Combine authors with language so the body gets a filter list; then
        # assert no clause references authors, but results are still narrowed.
        resp = self.client.get(self._url(
            q='كتاب', mode='exact',
            authors=self.author_two.name, language='en',
        ))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        filters = self._body_of(get_conn)['query']['bool']['filter']
        self.assertIn({'term': {'language': 'en'}}, filters)
        self.assertFalse(
            any('authors' in json.dumps(clause) for clause in filters),
            'authors must never be pushed into the ES filter clauses',
        )
        # author_two → only doc_b (also the only English doc).
        self.assertEqual([r['id'] for r in resp.data['results']], [self.doc_b.id])

    @mock.patch(f'{VIEWS}.build_embedding', return_value=NO_VECTOR)
    @mock.patch(f'{VIEWS}.connections.get_connection')
    def test_combined_filters_narrow_results(self, get_conn, _embed):
        get_conn.return_value = self._conn(self._all_hits())
        resp = self.client.get(self._url(
            q='كتاب', mode='exact',
            categories='فقه', language='ar',
        ))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        filters = self._body_of(get_conn)['query']['bool']['filter']
        self.assertIn({'terms': {'categories': ['فقه']}}, filters)
        self.assertIn({'term': {'language': 'ar'}}, filters)
        # Arabic + فقه → doc_a and doc_c (doc_b is English/تاريخ).
        self.assertEqual(
            sorted(r['id'] for r in resp.data['results']),
            sorted([self.doc_a.id, self.doc_c.id]),
        )

    # --- snippets ---------------------------------------------------------

    @mock.patch(f'{VIEWS}.build_embedding', return_value=NO_VECTOR)
    @mock.patch(f'{VIEWS}.connections.get_connection')
    def test_snippet_extraction_respects_field_priority(self, get_conn, _embed):
        raw = self._raw_hits(
            # title outranks content when both are highlighted.
            (self.doc_a, 8.0, {
                'content': ['<mark>alpha</mark> body'],
                'title': ['<mark>كتاب</mark> الألف'],
            }),
            # content-only → content fragment used.
            (self.doc_b, 4.0, {'content': ['<mark>only</mark> content']}),
            # description outranks content.
            (self.doc_c, 2.0, {
                'content': ['<mark>gamma</mark> body'],
                'description': ['<mark>وصف</mark> الكتاب'],
            }),
        )
        get_conn.return_value = self._conn(raw)
        resp = self.client.get(self._url(q='كتاب', mode='exact'))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        by_id = {r['id']: r for r in resp.data['results']}
        self.assertEqual(by_id[self.doc_a.id]['snippet'], '<mark>كتاب</mark> الألف')
        self.assertEqual(by_id[self.doc_b.id]['snippet'], '<mark>only</mark> content')
        self.assertEqual(by_id[self.doc_c.id]['snippet'], '<mark>وصف</mark> الكتاب')

    @mock.patch(f'{VIEWS}.build_embedding', return_value=KNN_VECTOR)
    @mock.patch(f'{VIEWS}.connections.get_connection')
    def test_snippet_is_null_in_semantic_mode(self, get_conn, _embed):
        # kNN-only hits carry no highlight → nothing to extract.
        raw = self._raw_hits(
            (self.doc_a, 0.9, None),
            (self.doc_b, 0.5, None),
        )
        get_conn.return_value = self._conn(raw)
        resp = self.client.get(self._url(q='كتاب', mode='semantic'))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        for r in resp.data['results']:
            self.assertIsNone(r['snippet'])

    # --- resilience / pagination -----------------------------------------

    @mock.patch(f'{VIEWS}.build_embedding', return_value=KNN_VECTOR)
    @mock.patch(f'{VIEWS}.connections.get_connection')
    def test_es_failure_returns_empty_200_across_all_modes(self, get_conn, _embed):
        for mode in ('exact', 'semantic', 'hybrid'):
            get_conn.return_value = self._conn(side_effect=Exception('es down'))
            resp = self.client.get(self._url(q='كتاب', mode=mode))
            self.assertEqual(resp.status_code, status.HTTP_200_OK, mode)
            self.assertEqual(resp.data['count'], 0, mode)
            self.assertEqual(resp.data['results'], [], mode)

    @mock.patch(f'{VIEWS}.build_embedding', return_value=NO_VECTOR)
    @mock.patch(f'{VIEWS}.connections.get_connection')
    def test_response_stays_paginated(self, get_conn, _embed):
        get_conn.return_value = self._conn(self._all_hits())
        resp = self.client.get(self._url(q='كتاب', mode='hybrid'))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        for key in ('count', 'next', 'previous', 'results'):
            self.assertIn(key, resp.data)
        self.assertEqual(resp.data['count'], 3)
        # No degraded_reason key on a healthy response.
        self.assertNotIn('degraded_reason', resp.data)
