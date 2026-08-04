"""Persons + places extractors, gazetteer loading, and typeahead endpoints."""
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APITestCase

from extraction.extractors import DocContext
from extraction.extractors.persons import (
    PersonsExtractor,
    blocking_key,
    decompose_name,
    reload_persons,
)
from extraction.extractors.places import PlacesExtractor, reload_gazetteer
from extraction.models import Person, Place, PlaceName
from search_engine.models import Author

User = get_user_model()
CTX = DocContext(title='كتاب', language='ar')


def spans_of(extractor, text):
    mentions = extractor.extract(text, 1, CTX)
    for m in mentions:
        assert text[m.char_start:m.char_end] == m.surface_text, m
    return mentions


class GazetteerLoadTests(TestCase):
    def test_seed_tsv_loads_idempotently(self):
        from django.core.management import call_command

        call_command('load_gazetteer', verbosity=0)
        first_places = Place.objects.count()
        first_names = PlaceName.objects.count()
        self.assertGreater(first_places, 100)
        self.assertGreater(first_names, first_places)  # variants exist
        # Re-run: no duplicates.
        call_command('load_gazetteer', verbosity=0)
        self.assertEqual(Place.objects.count(), first_places)
        self.assertEqual(PlaceName.objects.count(), first_names)


class PlacesExtractorTests(TestCase):
    def setUp(self):
        nishapur = Place.objects.create(
            name='نيسابور', source=Place.Source.MANUAL, source_id='nishapur')
        PlaceName.objects.create(
            place=nishapur, name='نيسابور', normalized='نيسابور',
            kind=PlaceName.Kind.PRIMARY)
        PlaceName.objects.create(
            place=nishapur, name='النيسابوري', normalized='النيسابوري',
            kind=PlaceName.Kind.NISBA)
        self.nishapur = nishapur
        reload_gazetteer()
        self.extractor = PlacesExtractor()

    def tearDown(self):
        reload_gazetteer()

    def test_primary_surface_matches_with_canonical_hint(self):
        mentions = spans_of(self.extractor, 'رحل إلى نيسابور في طلب الحديث.')
        self.assertEqual(len(mentions), 1)
        self.assertEqual(mentions[0].canonical_hint, {'place_id': self.nishapur.id})
        self.assertFalse(mentions[0].needs_review)

    def test_nisba_surface_is_low_confidence_pending(self):
        mentions = spans_of(self.extractor, 'قال الحاكم النيسابوري في المستدرك.')
        self.assertEqual(len(mentions), 1)
        self.assertTrue(mentions[0].needs_review)
        self.assertLess(mentions[0].confidence, 0.7)

    def test_stoplisted_nisbas_never_match(self):
        # الحنفي/القرشي are in the stoplist even if someone loads them as names.
        qurashi_place = Place.objects.create(
            name='قريش', source=Place.Source.MANUAL, source_id='x-qurash')
        PlaceName.objects.create(
            place=qurashi_place, name='القرشي', normalized='القرشي',
            kind=PlaceName.Kind.NISBA)
        reload_gazetteer()
        mentions = spans_of(self.extractor, 'روى عن محمد القرشي الحنفي.')
        self.assertEqual(mentions, [])

    def test_no_substring_matches_inside_words(self):
        mentions = spans_of(self.extractor, 'كلمة بنيسابورية ليست مطابقة.')
        self.assertEqual(mentions, [])


class PersonsExtractorTests(TestCase):
    def setUp(self):
        reload_persons()
        self.extractor = PersonsExtractor()

    def tearDown(self):
        reload_persons()

    def test_death_marker_anchor_with_name_parts(self):
        text = 'قال أحمد بن حنبل الشيباني (ت ٢٤١هـ) في مسنده.'
        mentions = spans_of(self.extractor, text)
        self.assertEqual(len(mentions), 1)
        m = mentions[0]
        self.assertEqual(m.normalized['anchor'], 'death_marker')
        self.assertEqual(m.normalized['death_year'], 241)
        self.assertFalse(m.needs_review)
        self.assertIn('احمد', m.normalized_text)

    def test_honorific_anchor_classifies_status(self):
        text = 'عن عمر بن الخطاب رضي الله عنه قال.'
        mentions = spans_of(self.extractor, text)
        self.assertEqual(len(mentions), 1)
        self.assertEqual(mentions[0].normalized['honorific_class'], 'sahabi')
        self.assertTrue(mentions[0].needs_review)

    def test_seeded_author_gazetteer_links_canonically(self):
        author = Author.objects.create(name='ابن تيمية', date_of_death='728 هـ')
        from django.core.management import call_command
        call_command('seed_persons', verbosity=0)
        person = Person.objects.get(author=author)

        mentions = spans_of(self.extractor, 'وسئل ابن تيمية عن ذلك فأجاب.')
        gaz = [m for m in mentions if m.normalized.get('anchor') == 'gazetteer']
        self.assertEqual(len(gaz), 1)
        self.assertEqual(gaz[0].canonical_hint, {'person_id': person.id})

    def test_decompose_and_blocking_key(self):
        parts = decompose_name('ابو حامد الغزالي')
        self.assertEqual(parts['kunya'], 'ابو حامد')
        self.assertEqual(parts['nisba'], 'الغزالي')
        self.assertEqual(blocking_key('ابو حامد الغزالي'), 'ابو حامد')
        parts2 = decompose_name('ابن حجر العسقلاني')
        self.assertEqual(parts2['shuhra'], 'ابن حجر')
        self.assertEqual(blocking_key('ابن حجر العسقلاني'), 'ابن حجر')


class TypeaheadApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='reader', email='reader@example.com', password='ReaderPass123!')
        self.client.force_authenticate(user=self.user)
        Person.objects.create(
            display_name='ابن حجر العسقلاني', blocking_key='ابن حجر',
            source=Person.Source.MANUAL, mention_doc_count=5)
        Person.objects.create(
            display_name='مرفوض', blocking_key='مرفوض',
            source=Person.Source.MANUAL, review_status='rejected')
        place = Place.objects.create(
            name='نيسابور', source=Place.Source.MANUAL, source_id='nishapur',
            mention_doc_count=3)
        PlaceName.objects.create(
            place=place, name='نيسابور', normalized='نيسابور',
            kind=PlaceName.Kind.PRIMARY)

    def test_person_typeahead_excludes_rejected(self):
        resp = self.client.get('/api/extraction/persons/', {'q': 'ابن'})
        self.assertEqual(resp.status_code, 200)
        names = [r['display_name'] for r in resp.data['results']]
        self.assertIn('ابن حجر العسقلاني', names)
        self.assertNotIn('مرفوض', names)

    def test_place_typeahead_matches_normalized_surface(self):
        resp = self.client.get('/api/extraction/places/', {'q': 'نيسا'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['results'][0]['name'], 'نيسابور')

    def test_unauthenticated_rejected(self):
        self.client.force_authenticate(user=None)
        resp = self.client.get('/api/extraction/persons/')
        self.assertIn(resp.status_code, {401, 403})
