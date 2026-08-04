"""Exact-DSL tests for the multi-term query builders (``query_builder.py``).

Mirrors ``test_in_document_query_building.py``'s style: every assertion pins
the exact dict the builder emits, so any change to field routing, operators or
fuzziness is a conscious, reviewed decision. The legacy single-term builders
(``views.build_multi_match_query`` / ``views._build_lexical_query``) are NOT
touched by the terms model — their own tests remain the byte-compat guard.
"""
from django.test import SimpleTestCase

from search_engine.query_builder import (
    CORPUS_FIELDS_EXACT,
    CORPUS_FIELDS_EXACT_PHRASE,
    CORPUS_FIELDS_RAW,
    CORPUS_FIELDS_RAW_PHRASE,
    CORPUS_FIELDS_STEM,
    FacetDef,
    FACET_REGISTRY,
    TermSpec,
    build_corpus_bool_query,
    build_corpus_term_clause,
    build_facet_clauses,
    build_inbook_term_query,
    build_positive_gate_clauses,
    compose_query_text,
    inbook_match_kind,
    normalize_highlight,
    register_facet,
    term_hits_from_matched_queries,
    terms_from_legacy_params,
)


class CorpusTermClauseTests(SimpleTestCase):
    """The per-term kind × diacritics matrix, asserted on exact dicts."""

    def test_phrase_ignore_targets_exact_subfields(self):
        clause = build_corpus_term_clause(TermSpec('فضل العلم', match='phrase'))
        self.assertEqual(clause, {'multi_match': {
            'query': 'فضل العلم',
            'fields': CORPUS_FIELDS_EXACT_PHRASE,
            'type': 'phrase',
        }})

    def test_phrase_sensitive_targets_raw_fields(self):
        clause = build_corpus_term_clause(
            TermSpec('فَضْلُ الْعِلْمِ', match='phrase', diacritics='sensitive'))
        self.assertEqual(clause, {'multi_match': {
            'query': 'فَضْلُ الْعِلْمِ',
            'fields': CORPUS_FIELDS_RAW_PHRASE,
            'type': 'phrase',
        }})

    def test_word_ignore_is_zero_fuzziness_and_over_exact(self):
        clause = build_corpus_term_clause(TermSpec('زكاة', match='word'))
        self.assertEqual(clause, {'multi_match': {
            'query': 'زكاة',
            'fields': CORPUS_FIELDS_EXACT,
            'type': 'best_fields',
            'operator': 'and',
            'fuzziness': 0,
        }})

    def test_word_sensitive_targets_raw_fields(self):
        clause = build_corpus_term_clause(
            TermSpec('زكاة', match='word', diacritics='sensitive'))
        self.assertEqual(clause['multi_match']['fields'], CORPUS_FIELDS_RAW)
        self.assertEqual(clause['multi_match']['fuzziness'], 0)

    def test_fuzzy_carries_per_term_fuzziness(self):
        for fuzziness in (1, 2, 'AUTO'):
            clause = build_corpus_term_clause(
                TermSpec('التصوف', match='fuzzy', fuzziness=fuzziness))
            self.assertEqual(clause, {'multi_match': {
                'query': 'التصوف',
                'fields': CORPUS_FIELDS_EXACT,
                'type': 'best_fields',
                'operator': 'and',
                'fuzziness': fuzziness,
            }})

    def test_stem_targets_arabic_subfields_without_fuzziness(self):
        clause = build_corpus_term_clause(TermSpec('الإجماع', match='stem'))
        self.assertEqual(clause, {'multi_match': {
            'query': 'الإجماع',
            'fields': CORPUS_FIELDS_STEM,
            'type': 'best_fields',
            'operator': 'and',
        }})

    def test_name_lands_inside_multi_match(self):
        clause = build_corpus_term_clause(TermSpec('زكاة'), name='term_0')
        self.assertEqual(clause['multi_match']['_name'], 'term_0')


class CorpusBoolQueryTests(SimpleTestCase):
    def test_full_assembly_names_positive_clauses_by_request_index(self):
        terms = [
            TermSpec('فضل العلم', match='phrase', op='must'),
            TermSpec('زكاة', match='stem', op='must'),
            TermSpec('التصوف', match='fuzzy', fuzziness=1, op='should'),
            TermSpec('فلسفة', match='word', op='must_not'),
        ]
        filters = [{'terms': {'_id': ['12', '44']}}]
        query = build_corpus_bool_query(terms, filters)
        bool_body = query['bool']

        self.assertEqual(
            [c['multi_match']['_name'] for c in bool_body['must']],
            ['term_0', 'term_1'],
        )
        self.assertEqual(
            [c['multi_match']['_name'] for c in bool_body['should']],
            ['term_2'],
        )
        self.assertEqual(bool_body['minimum_should_match'], 1)
        # must_not clauses are unnamed: they can never appear on a hit.
        self.assertNotIn('_name', bool_body['must_not'][0]['multi_match'])
        self.assertEqual(bool_body['filter'], filters)

    def test_minimum_should_match_only_with_shoulds(self):
        query = build_corpus_bool_query([TermSpec('زكاة')])
        self.assertNotIn('minimum_should_match', query['bool'])
        self.assertNotIn('should', query['bool'])
        self.assertNotIn('filter', query['bool'])

    def test_gate_clauses_split_and_stay_unnamed(self):
        terms = [
            TermSpec('زكاة', op='must'),
            TermSpec('التصوف', op='should'),
            TermSpec('فلسفة', op='must_not'),
        ]
        musts, nots = build_positive_gate_clauses(terms)
        self.assertEqual(len(musts), 1)
        self.assertEqual(len(nots), 1)
        self.assertNotIn('_name', musts[0]['multi_match'])
        self.assertEqual(musts[0]['multi_match']['query'], 'زكاة')
        self.assertEqual(nots[0]['multi_match']['query'], 'فلسفة')


class HelpersTests(SimpleTestCase):
    def test_compose_query_text_excludes_must_not(self):
        terms = [
            TermSpec('الإجماع', op='must'),
            TermSpec('القياس', op='should'),
            TermSpec('ضعيف', op='must_not'),
        ]
        self.assertEqual(compose_query_text(terms), 'الإجماع القياس')

    def test_legacy_translation_is_one_fuzzy_auto_must(self):
        terms = terms_from_legacy_params('  كتاب  ')
        self.assertEqual(terms, [TermSpec('كتاب', match='fuzzy', fuzziness='AUTO')])
        self.assertEqual(terms[0].op, 'must')

    def test_normalize_highlight_folds_subfields_and_dedupes(self):
        hl = {
            'title.exact': ['<mark>a</mark>'],
            'title': ['<mark>a</mark>', '<mark>b</mark>'],
            'content.arabic': ['<mark>c</mark>'],
        }
        self.assertEqual(normalize_highlight(hl), {
            'title': ['<mark>a</mark>', '<mark>b</mark>'],
            'content': ['<mark>c</mark>'],
        })

    def test_term_hits_parsing_ignores_foreign_names(self):
        self.assertEqual(
            term_hits_from_matched_queries(['term_2', 'term_0', 'other', 'term_x']),
            [0, 2],
        )
        self.assertEqual(term_hits_from_matched_queries([]), [])


class InBookTermQueryTests(SimpleTestCase):
    def test_phrase_ignore(self):
        q, fields = build_inbook_term_query(TermSpec('فضل العلم', match='phrase'))
        self.assertEqual(q, {'match_phrase': {'content.exact': {'query': 'فضل العلم'}}})
        self.assertEqual(fields, ['content.exact'])

    def test_phrase_sensitive(self):
        q, fields = build_inbook_term_query(
            TermSpec('فَضْل', match='phrase', diacritics='sensitive'))
        self.assertEqual(q, {'match_phrase': {'content': {'query': 'فَضْل'}}})
        self.assertEqual(fields, ['content'])

    def test_word_is_zero_fuzziness(self):
        q, fields = build_inbook_term_query(TermSpec('زكاة', match='word'))
        self.assertEqual(q, {'match': {'content.exact': {
            'query': 'زكاة', 'operator': 'and', 'fuzziness': 0}}})
        self.assertEqual(fields, ['content.exact'])

    def test_fuzzy_sensitive_targets_raw_content(self):
        q, fields = build_inbook_term_query(
            TermSpec('التصوف', match='fuzzy', fuzziness=2, diacritics='sensitive'))
        self.assertEqual(q, {'match': {'content': {
            'query': 'التصوف', 'operator': 'and', 'fuzziness': 2}}})
        self.assertEqual(fields, ['content'])

    def test_stem_targets_arabic(self):
        q, fields = build_inbook_term_query(TermSpec('الإجماع', match='stem'))
        self.assertEqual(q, {'match': {'content.arabic': {
            'query': 'الإجماع', 'operator': 'and'}}})
        self.assertEqual(fields, ['content.arabic'])

    def test_match_kind_buckets(self):
        self.assertEqual(inbook_match_kind(TermSpec('x', match='phrase')), 'exact')
        for kind in ('word', 'fuzzy', 'stem'):
            self.assertEqual(inbook_match_kind(TermSpec('x', match=kind)), 'lexical')


class FacetRegistryTests(SimpleTestCase):
    def tearDown(self):
        FACET_REGISTRY.pop('test.genre', None)

    def test_registered_facet_builds_terms_clause_and_unknown_reported(self):
        register_facet('test.genre', FacetDef(es_field='genre'))
        clauses, unknown = build_facet_clauses({
            'test.genre': ['fiqh', ''],
            'nope': ['x'],
        })
        self.assertEqual(clauses, [{'terms': {'genre': ['fiqh']}}])
        self.assertEqual(unknown, ['nope'])
