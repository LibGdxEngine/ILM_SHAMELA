"""Golden-fixture tests for the deterministic extractors.

Every assertion checks (a) the normalized key, (b) that the span's offsets
index the ORIGINAL page string (the surface slice must reproduce the match) —
the invariant the reader overlay depends on.
"""
from django.test import SimpleTestCase

from extraction.extractors import EXTRACTOR_REGISTRY, DocContext
from extraction.extractors.dates import DatesExtractor
from extraction.extractors.quran import QuranExtractor
from extraction.extractors.takhrij import TakhrijExtractor
from extraction.extractors.textnorm import (
    normalize,
    normalize_with_map,
    shadow_span_to_original,
)

CTX = DocContext(title='كتاب الاختبار', language='ar')


def spans_of(extractor, text):
    mentions = extractor.extract(text, 1, CTX)
    for m in mentions:
        # Offset invariant: surface_text is exactly the original slice.
        assert text[m.char_start:m.char_end] == m.surface_text, m
    return mentions


class TextnormTests(SimpleTestCase):
    def test_folding_matches_arabic_exact_analyzer(self):
        self.assertEqual(normalize('الإِسْلامُ'), 'الاسلام')
        self.assertEqual(normalize('مِشْكاةٌ'), 'مشكاه')
        self.assertEqual(normalize('مُوسَى'), 'موسي')
        self.assertEqual(normalize('العـــلم'), 'العلم')  # tatweel stripped

    def test_digit_translation(self):
        self.assertEqual(normalize('سنة ٧٢٨ هـ'), 'سنه 728 ه')
        self.assertEqual(normalize('۱۲۳'), '123')

    def test_offset_map_round_trip(self):
        original = 'قَالَ العُلَمَاءُ'
        shadow, index_map = normalize_with_map(original)
        # Find 'العلماء' in the shadow, translate back, slice the original.
        start = shadow.index('العلماء')
        o_start, o_end = shadow_span_to_original(
            index_map, start, start + len('العلماء'))
        self.assertEqual(normalize(original[o_start:o_end]), 'العلماء')


class QuranExtractorTests(SimpleTestCase):
    def setUp(self):
        self.extractor = QuranExtractor()

    def test_bracketed_citation_with_arabic_digits(self):
        text = 'قال تعالى: ﴿اللَّهُ لا إِلَهَ إِلَّا هُوَ﴾ [البقرة: ٢٥٥] وهي آية الكرسي.'
        mentions = spans_of(self.extractor, text)
        keys = {m.normalized_text for m in mentions}
        self.assertIn('quran:2:255', keys)
        citation = next(m for m in mentions if m.normalized.get('kind') == 'citation')
        self.assertEqual(citation.normalized['sura'], 2)
        self.assertEqual(citation.normalized['aya_start'], 255)
        verse = next(m for m in mentions if m.normalized.get('kind') == 'verse')
        self.assertEqual(verse.normalized_text, 'quran:2:255')
        self.assertFalse(verse.needs_review)

    def test_aya_range_and_sura_prefix(self):
        text = 'كما في (سورة آل عمران: ١٠٢-١٠٤) من الآيات.'
        mentions = spans_of(self.extractor, text)
        self.assertEqual(mentions[0].normalized_text, 'quran:3:102-104')
        self.assertEqual(mentions[0].normalized['aya_end'], 104)

    def test_uncited_verse_needs_review(self):
        text = 'ثم قرأ ﴿قُلْ هُوَ اللَّهُ أَحَدٌ﴾ في الركعة الثانية.'
        mentions = spans_of(self.extractor, text)
        self.assertEqual(len(mentions), 1)
        self.assertEqual(mentions[0].normalized_text, 'quran:unknown')
        self.assertTrue(mentions[0].needs_review)

    def test_sura_names_never_match_in_free_prose(self):
        text = 'ذكر البقرة والنمل في كلامه عن الحيوان.'
        self.assertEqual(spans_of(self.extractor, text), [])


class TakhrijExtractorTests(SimpleTestCase):
    def setUp(self):
        self.extractor = TakhrijExtractor()

    def test_single_collection_with_number(self):
        text = 'الحديث رواه البخاري (رقم ٥٢) في كتاب الإيمان.'
        mentions = spans_of(self.extractor, text)
        self.assertEqual(len(mentions), 1)
        self.assertEqual(mentions[0].normalized_text, 'bukhari:52')
        self.assertEqual(mentions[0].normalized['number'], 52)

    def test_chained_collections_two_mentions(self):
        text = 'أخرجه البخاري ومسلم في صحيحيهما.'
        mentions = spans_of(self.extractor, text)
        keys = sorted(m.normalized_text for m in mentions)
        self.assertEqual(keys, ['bukhari', 'muslim'])

    def test_muttafaq_alayh(self):
        text = 'وهو حديث متفق عليه بين الشيخين.'
        mentions = spans_of(self.extractor, text)
        self.assertIn('muttafaq', [m.normalized_text for m in mentions])

    def test_ta_marbuta_variant(self):
        text = 'أخرجه ابن ماجة في سننه.'
        mentions = spans_of(self.extractor, text)
        self.assertEqual(mentions[0].normalized_text, 'ibnmajah')


class DatesExtractorTests(SimpleTestCase):
    def setUp(self):
        self.extractor = DatesExtractor()

    def test_numeric_hijri_year(self):
        text = 'وكان ذلك سنة ٧٢٨ هـ في دمشق.'
        mentions = spans_of(self.extractor, text)
        self.assertEqual(mentions[0].normalized_text, 'hijri:728')
        self.assertEqual(mentions[0].normalized['calendar'], 'hijri')
        self.assertGreaterEqual(mentions[0].confidence, 0.9)

    def test_death_marker_parenthetical(self):
        text = 'قال ابن تيمية (ت ٧٢٨هـ) رحمه الله.'
        mentions = spans_of(self.extractor, text)
        self.assertEqual(mentions[0].normalized_text, 'hijri:728')
        self.assertTrue(mentions[0].normalized.get('death'))

    def test_bare_year_gets_hijri_guess_low_confidence(self):
        text = 'ولد سنة ٤٥٠ ونشأ في بغداد.'
        mentions = spans_of(self.extractor, text)
        self.assertEqual(mentions[0].normalized_text, 'hijri:450')
        self.assertLess(mentions[0].confidence, 0.7)
        self.assertTrue(mentions[0].needs_review)

    def test_gregorian_marker(self):
        text = 'صدرت الطبعة عام ١٩٢٥ م في القاهرة.'
        mentions = spans_of(self.extractor, text)
        self.assertEqual(mentions[0].normalized_text, 'greg:1925')

    def test_spelled_out_classical_year(self):
        text = 'توفي رحمه الله سنة ثمان وعشرين وسبعمائة بدمشق.'
        mentions = spans_of(self.extractor, text)
        self.assertEqual(mentions[0].normalized_text, 'hijri:728')
        self.assertEqual(mentions[0].confidence, 0.7)

    def test_era_marked_range(self):
        text = 'في الفترة ٧١٢-٧٢٨ هـ تنقل بين الشام ومصر.'
        mentions = spans_of(self.extractor, text)
        self.assertEqual(mentions[0].normalized_text, 'hijri:712-728')
        self.assertEqual(mentions[0].normalized['year_end'], 728)


class RegistryTests(SimpleTestCase):
    def test_deterministic_extractors_registered(self):
        for name in ('quran', 'takhrij', 'dates'):
            self.assertIn(name, EXTRACTOR_REGISTRY)
