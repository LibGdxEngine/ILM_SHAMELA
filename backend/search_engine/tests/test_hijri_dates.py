"""Tests for the free-text death-date → hijri year/century parser."""

from django.test import SimpleTestCase, TestCase

from search_engine.hijri_dates import (
    GREGORIAN_CUTOFF,
    derive_death_fields,
    gregorian_to_hijri,
    hijri_century,
    parse_death_year_hijri,
)
from search_engine.models import Author


class HijriDateParsingTests(SimpleTestCase):
    """Pure parser behavior — no database involved."""

    def test_hijri_marked_year(self):
        self.assertEqual(parse_death_year_hijri('728 هـ'), 728)
        self.assertEqual(parse_death_year_hijri('728هـ'), 728)
        self.assertEqual(parse_death_year_hijri('728 ه'), 728)
        self.assertEqual(parse_death_year_hijri('728 هجرية'), 728)
        self.assertEqual(parse_death_year_hijri('728 AH'), 728)
        self.assertEqual(parse_death_year_hijri('728 A.H.'), 728)

    def test_bare_year_is_hijri_below_cutoff(self):
        self.assertEqual(parse_death_year_hijri('728'), 728)
        self.assertEqual(parse_death_year_hijri('1447'), 1447)

    def test_arabic_indic_digits(self):
        self.assertEqual(parse_death_year_hijri('٧٢٨هـ'), 728)
        self.assertEqual(parse_death_year_hijri('٧٢٨'), 728)
        self.assertEqual(parse_death_year_hijri('۷۲۸'), 728)  # Eastern Arabic-Indic

    def test_death_prefix_and_noise_tokens(self):
        self.assertEqual(parse_death_year_hijri('ت 728'), 728)
        self.assertEqual(parse_death_year_hijri('ت728 هـ'), 728)
        self.assertEqual(parse_death_year_hijri('نحو 730 هـ'), 730)
        self.assertEqual(parse_death_year_hijri('توفي سنة 728'), 728)
        self.assertEqual(parse_death_year_hijri('حوالي 600'), 600)

    def test_ranges_take_first_year(self):
        self.assertEqual(parse_death_year_hijri('728-730'), 728)
        self.assertEqual(parse_death_year_hijri('728/729 هـ'), 728)

    def test_dual_era_string_hijri_wins(self):
        self.assertEqual(parse_death_year_hijri('728 هـ / 1328 م'), 728)
        self.assertEqual(parse_death_year_hijri('1328 م - 728 هـ'), 728)

    def test_gregorian_marked_year_is_converted(self):
        # 1328 CE ≈ 728 AH.
        self.assertEqual(parse_death_year_hijri('1328 م'), 728)
        self.assertEqual(parse_death_year_hijri('1328 CE'), 728)
        self.assertEqual(parse_death_year_hijri('1328 AD'), 728)
        self.assertEqual(parse_death_year_hijri('1328 ميلادية'), 728)

    def test_bare_year_above_cutoff_treated_gregorian(self):
        # 1970 CE ≈ 1390 AH.
        self.assertEqual(parse_death_year_hijri('1970'), gregorian_to_hijri(1970))
        self.assertEqual(parse_death_year_hijri('1970'), 1390)
        # At the cutoff the value stays hijri.
        self.assertEqual(parse_death_year_hijri(str(GREGORIAN_CUTOFF)), GREGORIAN_CUTOFF)

    def test_unknown_markers(self):
        for raw in ('د.ت', 'د. ت', 'ت غ م', 'مجهول', 'غير معروف', '؟', '-', 'n.d.', 'unknown', '', '   ', None):
            self.assertIsNone(parse_death_year_hijri(raw), raw)

    def test_century_phrases_are_not_years(self):
        self.assertIsNone(parse_death_year_hijri('القرن الخامس'))
        self.assertIsNone(parse_death_year_hijri('5th century'))

    def test_no_digits(self):
        self.assertIsNone(parse_death_year_hijri('في خلافة عمر'))

    def test_clamp_rejects_implausible(self):
        self.assertIsNone(parse_death_year_hijri('0'))
        self.assertIsNone(parse_death_year_hijri('5000 هـ'))

    def test_century_boundaries(self):
        self.assertEqual(hijri_century(700), 7)
        self.assertEqual(hijri_century(701), 8)
        self.assertEqual(hijri_century(728), 8)
        self.assertEqual(hijri_century(100), 1)
        self.assertEqual(hijri_century(1), 1)
        self.assertIsNone(hijri_century(None))
        self.assertIsNone(hijri_century(0))

    def test_derive_death_fields(self):
        self.assertEqual(derive_death_fields('728 هـ'), (728, 8))
        self.assertEqual(derive_death_fields('د.ت'), (None, None))
        self.assertEqual(derive_death_fields(None), (None, None))


class AuthorDeathFieldDerivationTests(TestCase):
    """Author.save() keeps the derived fields in sync with date_of_death."""

    def test_derived_on_create(self):
        author = Author.objects.create(name='ابن تيمية', date_of_death='728 هـ')
        author.refresh_from_db()
        self.assertEqual(author.death_year_hijri, 728)
        self.assertEqual(author.death_century, 8)

    def test_derived_on_update(self):
        author = Author.objects.create(name='مؤلف', date_of_death=None)
        self.assertIsNone(author.death_century)
        author.date_of_death = '٧٩٥'
        author.save()
        author.refresh_from_db()
        self.assertEqual(author.death_year_hijri, 795)
        self.assertEqual(author.death_century, 8)

    def test_cleared_when_unparseable(self):
        author = Author.objects.create(name='مجهول الوفاة', date_of_death='911 هـ')
        author.date_of_death = 'د.ت'
        author.save()
        author.refresh_from_db()
        self.assertIsNone(author.death_year_hijri)
        self.assertIsNone(author.death_century)
