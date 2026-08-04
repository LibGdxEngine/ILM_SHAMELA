"""API tests for ``POST /documents/search/query/`` (``views_search``).

Same deterministic setup as ``test_document_search.py``: the ES connection and
the embedding call are patched in the ``views_search`` namespace, raw ES
response dicts are hand-built keyed by seeded fixture ids.
"""
import json
from unittest import mock

from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from search_engine.models import Author, Category, Document
from search_engine.semantic import VECTOR_DIMENSIONS

User = get_user_model()

VIEWS_SEARCH = 'search_engine.views_search'
URL = '/api/search_engine/documents/search/query/'

KNN_VECTOR = [0.01] * VECTOR_DIMENSIONS
NO_VECTOR = []


class CorpusQueryApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='searcher', email='searcher@example.com', password='SearchPass123!')
        self.other = User.objects.create_user(
            username='other', email='other@example.com', password='OtherPass123!')

        self.author = Author.objects.create(name='المؤلف الأول')
        self.cat = Category.objects.create(name='فقه')

        self.doc_a = Document.objects.create(
            title='كتاب الألف', content='alpha', language='ar', uploaded_by=self.user)
        self.doc_a.authors.add(self.author)
        self.doc_a.categories.add(self.cat)
        self.doc_b = Document.objects.create(
            title='كتاب الباء', content='beta', language='en', uploaded_by=self.other)
        self.doc_c = Document.objects.create(
            title='كتاب الجيم', content='gamma', language='ar')

        self.client.force_authenticate(user=self.user)

    # --- helpers ----------------------------------------------------------

    def _raw_hits(self, *entries):
        hits = []
        for entry in entries:
            doc, score, highlight = entry[0], entry[1], entry[2]
            matched = entry[3] if len(entry) > 3 else None
            hit = {'_id': str(doc.id), '_score': score}
            if highlight is not None:
                hit['highlight'] = highlight
            if matched is not None:
                hit['matched_queries'] = matched
            hits.append(hit)
        return {'hits': {'hits': hits}}

    def _conn(self, search_return=None, side_effect=None):
        conn = mock.MagicMock()
        if side_effect is not None:
            conn.search.side_effect = side_effect
        else:
            conn.search.return_value = search_return
        return conn

    def _body_of(self, get_conn, call=0):
        return get_conn.return_value.search.call_args_list[call].kwargs['body']

    def _post(self, **body):
        body.setdefault('terms', [{'text': 'كتاب'}])
        return self.client.post(URL, body, format='json')

    # --- validation -------------------------------------------------------

    def test_unauthenticated_rejected(self):
        self.client.force_authenticate(user=None)
        resp = self._post()
        self.assertIn(resp.status_code,
                      {status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN})

    def test_empty_terms_rejected(self):
        resp = self._post(terms=[])
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(resp.data['error'], 'invalid_query')

    def test_all_must_not_rejected(self):
        resp = self._post(terms=[{'text': 'فلسفة', 'op': 'must_not'}])
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('at_least_one_positive_term', json.dumps(resp.data))

    def test_fuzziness_on_non_fuzzy_rejected(self):
        resp = self._post(terms=[{'text': 'زكاة', 'match': 'word', 'fuzziness': 1}])
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_invalid_fuzziness_rejected(self):
        resp = self._post(terms=[{'text': 'زكاة', 'match': 'fuzzy', 'fuzziness': 3}])
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_selected_scope_without_ids_rejected(self):
        resp = self._post(scope={'type': 'selected'})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('scope_ids_required', json.dumps(resp.data))

    def test_too_many_terms_rejected(self):
        resp = self._post(terms=[{'text': f'كلمة{i}'} for i in range(9)])
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_unknown_facet_rejected(self):
        resp = self._post(filters={'facets': {'no_such_facet': ['x']}})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(resp.data['error'], 'unknown_facet')
        self.assertEqual(resp.data['facets'], ['no_such_facet'])

    # --- execution --------------------------------------------------------

    @mock.patch(f'{VIEWS_SEARCH}.build_embedding', return_value=NO_VECTOR)
    @mock.patch(f'{VIEWS_SEARCH}.connections.get_connection')
    def test_exact_mode_emits_named_bool_query_and_term_hits(self, get_conn, _embed):
        get_conn.return_value = self._conn(self._raw_hits(
            (self.doc_a, 8.0, {'content.exact': ['<mark>alpha</mark>']}, ['term_0', 'term_1']),
            (self.doc_c, 2.0, {'content': ['<mark>gamma</mark>']}, ['term_0']),
        ))
        resp = self._post(
            terms=[
                {'text': 'فضل العلم', 'match': 'phrase', 'op': 'must'},
                {'text': 'زكاة', 'match': 'stem', 'op': 'should'},
                {'text': 'فلسفة', 'match': 'word', 'op': 'must_not'},
            ],
            mode='exact',
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

        body = self._body_of(get_conn)
        bool_body = body['query']['bool']
        self.assertEqual(bool_body['must'][0]['multi_match']['_name'], 'term_0')
        self.assertEqual(bool_body['should'][0]['multi_match']['_name'], 'term_1')
        self.assertEqual(bool_body['minimum_should_match'], 1)
        self.assertNotIn('_name', bool_body['must_not'][0]['multi_match'])

        results = resp.data['results']
        self.assertEqual([r['id'] for r in results], [self.doc_a.id, self.doc_c.id])
        self.assertEqual(results[0]['term_hits'], [0, 1])
        self.assertEqual(results[1]['term_hits'], [0])
        # Highlight subfield keys fold onto base fields.
        self.assertEqual(results[0]['explanations']['matched_fields'], ['content'])
        self.assertEqual(results[0]['explanations']['method'], 'bm25')
        self.assertIsNone(results[0]['score_semantic'])
        self.assertEqual(resp.data['count'], 2)
        self.assertIsNone(resp.data['next'])
        self.assertIsNone(resp.data['previous'])

    @mock.patch(f'{VIEWS_SEARCH}.build_embedding', return_value=NO_VECTOR)
    @mock.patch(f'{VIEWS_SEARCH}.connections.get_connection')
    def test_scope_mine_filters_es_and_django_side(self, get_conn, _embed):
        get_conn.return_value = self._conn(self._raw_hits(
            (self.doc_a, 8.0, {'content': ['<mark>alpha</mark>']}, ['term_0']),
            (self.doc_b, 4.0, {'content': ['<mark>beta</mark>']}, ['term_0']),
        ))
        resp = self._post(scope={'type': 'mine'}, mode='exact')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        filters = self._body_of(get_conn)['query']['bool']['filter']
        self.assertIn({'term': {'uploaded_by_id': str(self.user.id)}}, filters)
        # Django-side net drops the other user's doc even if ES returned it.
        self.assertEqual([r['id'] for r in resp.data['results']], [self.doc_a.id])

    @mock.patch(f'{VIEWS_SEARCH}.build_embedding', return_value=NO_VECTOR)
    @mock.patch(f'{VIEWS_SEARCH}.connections.get_connection')
    def test_selected_scope_pushes_ids_filter(self, get_conn, _embed):
        get_conn.return_value = self._conn(self._raw_hits(
            (self.doc_a, 8.0, {'content': ['<mark>alpha</mark>']}, ['term_0']),
        ))
        resp = self._post(
            scope={'type': 'selected', 'ids': [self.doc_a.id, self.doc_c.id]},
            mode='exact',
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        filters = self._body_of(get_conn)['query']['bool']['filter']
        self.assertIn(
            {'terms': {'_id': [str(self.doc_a.id), str(self.doc_c.id)]}}, filters)

    @mock.patch(f'{VIEWS_SEARCH}.build_embedding', return_value=KNN_VECTOR)
    @mock.patch(f'{VIEWS_SEARCH}.connections.get_connection')
    def test_hybrid_gates_knn_on_musts_and_nots(self, get_conn, _embed):
        get_conn.return_value = self._conn(self._raw_hits(
            (self.doc_a, 8.0, {'content': ['<mark>alpha</mark>']}, ['term_0']),
        ))
        resp = self._post(
            terms=[
                {'text': 'الإجماع', 'op': 'must'},
                {'text': 'ضعيف', 'op': 'must_not'},
            ],
            mode='hybrid',
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        knn_body = self._body_of(get_conn, call=1)
        knn_filter = knn_body['knn']['filter']['bool']
        self.assertEqual(len(knn_filter['filter']), 1)  # the must gate
        self.assertEqual(
            knn_filter['filter'][0]['multi_match']['query'], 'الإجماع')
        self.assertEqual(
            knn_filter['must_not'][0]['multi_match']['query'], 'ضعيف')
        self.assertEqual(resp.data['results'][0]['explanations']['method'], 'hybrid')

    @mock.patch(f'{VIEWS_SEARCH}.build_embedding', return_value=NO_VECTOR)
    @mock.patch(f'{VIEWS_SEARCH}.connections.get_connection')
    def test_semantic_mode_without_embedding_degrades(self, get_conn, _embed):
        get_conn.return_value = self._conn(self._raw_hits())
        resp = self._post(mode='semantic')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['count'], 0)
        self.assertEqual(resp.data['degraded_reason'], 'embedding_unavailable')

    @mock.patch(f'{VIEWS_SEARCH}.build_embedding', return_value=NO_VECTOR)
    @mock.patch(f'{VIEWS_SEARCH}.connections.get_connection')
    def test_pagination_pages_are_numbers(self, get_conn, _embed):
        docs = [
            Document.objects.create(title=f'كتاب {i}', content=f'c{i}', language='ar')
            for i in range(25)
        ]
        get_conn.return_value = self._conn(self._raw_hits(
            *[(d, 25.0 - i, {'content': ['<mark>x</mark>']}, ['term_0'])
              for i, d in enumerate(docs)],
        ))
        resp = self._post(mode='exact', page=1)
        self.assertEqual(resp.data['count'], 25)
        self.assertEqual(len(resp.data['results']), 20)
        self.assertEqual(resp.data['next'], 2)
        self.assertIsNone(resp.data['previous'])

        resp2 = self._post(mode='exact', page=2)
        self.assertEqual(len(resp2.data['results']), 5)
        self.assertIsNone(resp2.data['next'])
        self.assertEqual(resp2.data['previous'], 1)
