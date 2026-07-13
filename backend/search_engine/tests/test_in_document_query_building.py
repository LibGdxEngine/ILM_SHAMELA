"""Pure unit tests for the in-document lexical search building blocks.

No DB, no Elasticsearch, no network: ``_build_lexical_query`` is asserted on
its ``to_dict()`` DSL output, page attribution and fragment scoring are pure
functions, and ``cosine_similarity`` is plain math.
"""
from django.test import SimpleTestCase

from search_engine.semantic import cosine_similarity
from search_engine.views import (
    _build_lexical_query,
    _locate_fragment_page,
    _normalize_ws,
    _score_lexical_matches,
)


class BuildLexicalQueryTests(SimpleTestCase):
    def test_exact_insensitive_is_match_phrase_on_content_exact(self):
        q, fields = _build_lexical_query('فضل العلم', phrase=True, ignore_diacritics=True)
        self.assertEqual(
            q.to_dict(),
            {'match_phrase': {'content.exact': {'query': 'فضل العلم'}}},
        )
        self.assertEqual(fields, ['content.exact'])

    def test_similar_insensitive_is_stemmed_plus_fuzzy(self):
        # Regression guard for the تقارب لفظي fix: the fuzzy stage must include
        # a stemmed content.arabic clause (root & derivatives), not only the
        # non-stemming fuzzy match.
        q, fields = _build_lexical_query('العلم', phrase=False, ignore_diacritics=True)
        self.assertEqual(
            q.to_dict(),
            {
                'bool': {
                    'minimum_should_match': 1,
                    'should': [
                        {'match': {'content.arabic': {'query': 'العلم', 'operator': 'and'}}},
                        {'match': {'content.exact': {
                            'query': 'العلم', 'fuzziness': 'AUTO', 'operator': 'and',
                        }}},
                    ],
                }
            },
        )
        self.assertEqual(fields, ['content.arabic', 'content.exact'])

    def test_exact_sensitive_uses_raw_content_field(self):
        q, fields = _build_lexical_query('فَضْلُ العِلْم', phrase=True, ignore_diacritics=False)
        self.assertEqual(
            q.to_dict(),
            {'match_phrase': {'content': {'query': 'فَضْلُ العِلْم'}}},
        )
        self.assertEqual(fields, ['content'])

    def test_similar_sensitive_has_no_stemmed_clause(self):
        q, fields = _build_lexical_query('العِلْم', phrase=False, ignore_diacritics=False)
        as_dict = q.to_dict()
        self.assertEqual(
            as_dict,
            {'match': {'content': {'query': 'العِلْم', 'fuzziness': 'AUTO', 'operator': 'and'}}},
        )
        self.assertNotIn('content.arabic', str(as_dict))
        self.assertEqual(fields, ['content'])


class LocateFragmentPageTests(SimpleTestCase):
    PAGES = [
        (1, _normalize_ws('فضل العلم على الأول وما جاء فيه.')),
        (2, _normalize_ws('فضل التعلم على الثاني وثوابه.')),
        (3, _normalize_ws('رياضة النفس على الثالث وتزكيتها.')),
    ]

    def test_exact_substring_containment(self):
        page = _locate_fragment_page('فضل <mark>التعلم</mark> على الثاني', self.PAGES)
        self.assertEqual(page, 2)

    def test_whitespace_differences_still_match(self):
        # ES fragments are verbatim _source slices and can carry newline runs
        # that the .strip()ped page contents no longer have.
        page = _locate_fragment_page('فضل  <mark>التعلم</mark>\nعلى   الثاني', self.PAGES)
        self.assertEqual(page, 2)

    def test_fragment_spanning_page_break_attributes_to_marked_piece(self):
        # Tail of page 2 + page break + head of page 3; the mark sits in the
        # page-3 piece so the fragment belongs to page 3, not page 1.
        snippet = 'على الثاني وثوابه.\n\n\nرياضة <mark>النفس</mark> على الثالث'
        self.assertEqual(_locate_fragment_page(snippet, self.PAGES), 3)

    def test_unmatchable_fragment_returns_none(self):
        self.assertIsNone(_locate_fragment_page('نص <mark>غريب</mark> لا وجود له', self.PAGES))

    def test_empty_fragment_returns_none(self):
        self.assertIsNone(_locate_fragment_page('', self.PAGES))

    def test_truncated_page_break_falls_back_to_marked_line(self):
        # A fragment can slice into a break's newline run so only "\n\n"
        # survives — the hard-break pattern (\n{3,}) no longer fires, but the
        # line holding the mark still pins the page.
        snippet = 'وثوابه.\n\nرياضة <mark>النفس</mark> على الثالث'
        self.assertEqual(_locate_fragment_page(snippet, self.PAGES), 3)


class ScoreLexicalMatchesTests(SimpleTestCase):
    def test_mark_density_and_page_frequency(self):
        matches = [
            {'page_number': 1, 'snippet': '<mark>العلم</mark> و<mark>المعرفة</mark>', 'es_score': 7.0},
            {'page_number': 1, 'snippet': 'فضل <mark>العلم</mark>', 'es_score': 7.0},
            {'page_number': 2, 'snippet': 'طلب <mark>العلم</mark>', 'es_score': 7.0},
        ]
        _score_lexical_matches(matches)
        # Page 1 carries 3 marks total, page 2 one mark.
        self.assertEqual(matches[0]['lex_raw'], 2 + 0.25 * 3)
        self.assertEqual(matches[1]['lex_raw'], 1 + 0.25 * 3)
        self.assertEqual(matches[2]['lex_raw'], 1 + 0.25 * 1)
        # The old behavior scored every fragment identically; guard against it.
        self.assertEqual(len({m['lex_raw'] for m in matches}), 3)
        # Two-mark fragment outranks single-mark ones; same-page single-mark
        # fragment outranks the lone-page one via the page-frequency boost.
        ranked = sorted(matches, key=lambda m: -m['lex_raw'])
        self.assertEqual([m['snippet'] for m in ranked],
                         [matches[0]['snippet'], matches[1]['snippet'], matches[2]['snippet']])


class TrueCosineTests(SimpleTestCase):
    def test_non_unit_vectors(self):
        # Raw dot product would return 2.0 (clamped to 1.0) and 0.25 here.
        self.assertAlmostEqual(cosine_similarity([2.0, 0.0, 0.0], [1.0, 0.0, 0.0]), 1.0)
        self.assertAlmostEqual(cosine_similarity([0.5, 0.0, 0.0], [0.5, 0.0, 0.0]), 1.0)

    def test_scale_invariance(self):
        v = [0.3, 0.4, 0.5]
        scaled = [3 * x for x in v]
        self.assertAlmostEqual(cosine_similarity(v, scaled), 1.0)

    def test_orthogonal_and_zero_vectors(self):
        self.assertAlmostEqual(cosine_similarity([1.0, 0.0], [0.0, 1.0]), 0.0)
        self.assertEqual(cosine_similarity([0.0, 0.0], [1.0, 0.0]), 0.0)
        self.assertEqual(cosine_similarity([], [1.0]), 0.0)

    def test_unit_vectors_unchanged_from_dot_product(self):
        # The existing API tests hand-craft unit vectors; true cosine must not
        # shift their expectations.
        self.assertAlmostEqual(cosine_similarity([1.0, 0.0, 0.0], [0.6, 0.8, 0.0]), 0.6)
