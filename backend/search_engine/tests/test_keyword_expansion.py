"""Tests for corpus-grounded keyword expansion and the shared corpus-search helper.

Elasticsearch (`connections.get_connection`) and the embedding call
(`build_embedding`) are patched so the aggregation parsing, field fallback, and
the RRF/BM25 metadata shape are exercised deterministically without a live
cluster.
"""
from types import SimpleNamespace
from unittest import mock

from django.test import TestCase

from search_engine.keyword_expansion import suggest_alternative_keywords
from search_engine.models import Document
from search_engine.views import execute_corpus_search

KW = 'search_engine.keyword_expansion'
VIEWS = 'search_engine.views'


def _fake_conn(search_return=None, search_side_effect=None):
    conn = mock.Mock()
    if search_side_effect is not None:
        conn.search.side_effect = search_side_effect
    else:
        conn.search.return_value = search_return
    return conn


def _sig_text_response(buckets):
    return {'aggregations': {'sample': {'related_terms': {'buckets': buckets}}}}


class SuggestAlternativeKeywordsTests(TestCase):
    @mock.patch(f'{KW}.build_embedding', return_value=[])
    @mock.patch(f'{KW}.connections.get_connection')
    def test_parses_buckets_and_excludes_query_term(self, get_conn, _embed):
        get_conn.return_value = _fake_conn(_sig_text_response([
            {'key': 'التعلم', 'score': 0.9, 'doc_count': 12},
            {'key': 'المعرفة', 'score': 0.7, 'doc_count': 8},
            {'key': 'العلم', 'score': 0.5, 'doc_count': 40},   # == query → dropped
            {'key': '   ', 'score': 0.4, 'doc_count': 3},       # blank → dropped
        ]))
        result = suggest_alternative_keywords('العلم')
        terms = [t['term'] for t in result['terms']]
        self.assertEqual(terms, ['التعلم', 'المعرفة'])
        self.assertEqual(result['field_used'], 'content.arabic')
        self.assertEqual(result['terms'][0]['score'], 0.9)
        self.assertEqual(result['terms'][0]['doc_count'], 12)

    @mock.patch(f'{KW}.build_embedding', return_value=[])
    @mock.patch(f'{KW}.connections.get_connection')
    def test_falls_back_to_content_when_arabic_field_errors(self, get_conn, _embed):
        # First call (content.arabic) raises; second (content) succeeds.
        get_conn.return_value = _fake_conn(search_side_effect=[
            Exception('fielddata rejected'),
            _sig_text_response([{'key': 'الفقه', 'score': 0.6, 'doc_count': 5}]),
        ])
        result = suggest_alternative_keywords('العلم')
        self.assertEqual(result['field_used'], 'content')
        self.assertEqual([t['term'] for t in result['terms']], ['الفقه'])

    @mock.patch(f'{KW}.build_embedding', return_value=[])
    @mock.patch(f'{KW}.connections.get_connection')
    def test_returns_empty_when_no_buckets(self, get_conn, _embed):
        get_conn.return_value = _fake_conn(_sig_text_response([]))
        result = suggest_alternative_keywords('لاشيء')
        self.assertEqual(result['terms'], [])
        self.assertIsNone(result['field_used'])

    @mock.patch(f'{KW}.connections.get_connection')
    def test_blank_query_short_circuits_without_es(self, get_conn):
        result = suggest_alternative_keywords('   ')
        self.assertEqual(result, {'query': '', 'terms': [], 'field_used': None})
        get_conn.assert_not_called()


class ExecuteCorpusSearchTests(TestCase):
    def setUp(self):
        self.doc_a = Document.objects.create(title='كتاب الألف', content='alpha')
        self.doc_b = Document.objects.create(title='كتاب الباء', content='beta')

    def _hits_response(self):
        return {'hits': {'hits': [
            {'_id': str(self.doc_a.id), '_score': 2.0,
             'highlight': {'content': ['<mark>alpha</mark> body']}},
            {'_id': str(self.doc_b.id), '_score': 8.0,
             'highlight': {'title': ['<mark>الباء</mark>']}},
        ]}}

    @mock.patch(f'{VIEWS}.build_embedding', return_value=[])
    @mock.patch(f'{VIEWS}.connections.get_connection')
    def test_ranks_by_score_and_reports_bm25_without_vector(self, get_conn, _embed):
        get_conn.return_value = _fake_conn(self._hits_response())
        ordered, metadata = execute_corpus_search('كتاب', filters=None)
        # Higher _score (doc_b, 8.0) ranks first after normalization.
        self.assertEqual([d.id for d in ordered], [self.doc_b.id, self.doc_a.id])
        self.assertEqual(metadata[self.doc_b.id]['score_final'], 1.0)
        self.assertEqual(metadata[self.doc_a.id]['score_final'], 0.25)
        self.assertEqual(metadata[self.doc_a.id]['explanations']['method'], 'bm25')
        # No snippet key unless requested.
        self.assertNotIn('snippet', metadata[self.doc_a.id])

    @mock.patch(f'{VIEWS}.build_embedding', return_value=[])
    @mock.patch(f'{VIEWS}.connections.get_connection')
    def test_include_snippets_strips_mark_tags(self, get_conn, _embed):
        get_conn.return_value = _fake_conn(self._hits_response())
        _ordered, metadata = execute_corpus_search(
            'كتاب', filters=None, include_snippets=True
        )
        self.assertEqual(metadata[self.doc_a.id]['snippet'], 'alpha body')
        # doc_b has no content highlight → falls through to the title fragment.
        self.assertEqual(metadata[self.doc_b.id]['snippet'], 'الباء')

    @mock.patch(f'{VIEWS}.apply_document_filters')
    @mock.patch(f'{VIEWS}.build_embedding', return_value=[])
    @mock.patch(f'{VIEWS}.connections.get_connection')
    def test_filters_dict_is_wrapped_for_apply_document_filters(
        self, get_conn, _embed, apply_filters
    ):
        get_conn.return_value = _fake_conn(self._hits_response())
        apply_filters.side_effect = lambda qs, request: qs
        execute_corpus_search('كتاب', filters={'language': 'ar'})
        # apply_document_filters receives an object exposing query_params.get(...).
        _qs, passed_request = apply_filters.call_args.args
        self.assertIsInstance(passed_request, SimpleNamespace)
        self.assertEqual(passed_request.query_params.get('language'), 'ar')

    @mock.patch(f'{VIEWS}.build_embedding', return_value=[])
    @mock.patch(f'{VIEWS}.connections.get_connection')
    def test_empty_hits_returns_empty(self, get_conn, _embed):
        get_conn.return_value = _fake_conn({'hits': {'hits': []}})
        ordered, metadata = execute_corpus_search('لاشيء', filters=None)
        self.assertEqual(ordered, [])
        self.assertEqual(metadata, {})

    @mock.patch(f'{VIEWS}.build_embedding', return_value=[])
    @mock.patch(f'{VIEWS}.connections.get_connection')
    def test_unresolved_author_filter_returns_empty_not_unfiltered(self, get_conn, _embed):
        # ES returns hits, but the requested author resolves to no Author row →
        # apply_document_filters must yield empty, not the full unfiltered set.
        get_conn.return_value = _fake_conn(self._hits_response())
        ordered, metadata = execute_corpus_search(
            'كتاب', filters={'authors': 'No Such Author'}
        )
        self.assertEqual(ordered, [])
        self.assertEqual(metadata, {})

    @mock.patch(f'{VIEWS}.build_embedding', return_value=[0.1] * 3072)
    @mock.patch(f'{VIEWS}.connections.get_connection')
    def test_hybrid_merges_lexical_and_semantic_only_docs(self, get_conn, _embed):
        # Two ES requests: lexical (BM25) then semantic (kNN, no RRF). doc_a
        # matches lexically; doc_b appears ONLY via kNN (a semantic-only /
        # cross-lingual hit) and must still surface through the Python merge.
        conn = mock.Mock()
        conn.search.side_effect = [
            {'hits': {'hits': [
                {'_id': str(self.doc_a.id), '_score': 5.0,
                 'highlight': {'content': ['<mark>alpha</mark>']}},
            ]}},
            {'hits': {'hits': [
                {'_id': str(self.doc_b.id), '_score': 0.9},
                {'_id': str(self.doc_a.id), '_score': 0.5},
            ]}},
        ]
        get_conn.return_value = conn
        ordered, metadata = execute_corpus_search('كتاب', filters=None)
        self.assertEqual({d.id for d in ordered}, {self.doc_a.id, self.doc_b.id})
        self.assertEqual(metadata[self.doc_a.id]['explanations']['method'], 'hybrid')
        # doc_a: lex 1.0, sem 0.5/0.9 → 0.60*1 + 0.40*0.5556 = 0.8222
        self.assertEqual(metadata[self.doc_a.id]['score_final'], 0.8222)
        # doc_b: semantic-only → lex 0.0, sem 1.0 → 0.40
        self.assertEqual(metadata[self.doc_b.id]['score_lexical'], 0.0)
        self.assertEqual(metadata[self.doc_b.id]['score_semantic'], 1.0)
        self.assertEqual(metadata[self.doc_b.id]['score_final'], 0.4)
        # The lexical+semantic doc outranks the semantic-only one.
        self.assertEqual(ordered[0].id, self.doc_a.id)

    @mock.patch(f'{VIEWS}.build_embedding', return_value=[0.1] * 3072)
    @mock.patch(f'{VIEWS}.connections.get_connection')
    def test_semantic_stage_failure_degrades_to_lexical(self, get_conn, _embed):
        # kNN request fails → keep the lexical results and report method 'bm25'.
        conn = mock.Mock()
        conn.search.side_effect = [self._hits_response(), Exception('knn boom')]
        get_conn.return_value = conn
        ordered, metadata = execute_corpus_search('كتاب', filters=None)
        self.assertEqual(len(ordered), 2)
        self.assertEqual(metadata[self.doc_b.id]['explanations']['method'], 'bm25')
        self.assertEqual(metadata[self.doc_b.id]['score_semantic'], 0.0)
