"""Rollup summaries, facet-registry wiring, and the page-mentions endpoint."""
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APITestCase

from extraction.models import DocumentMeta, EntityMention, Person, Place
from extraction.rollup import build_document_entity_summary
from extraction.tasks import extract_document_task
from search_engine.models import Document
from search_engine.query_builder import FACET_REGISTRY

User = get_user_model()

PAGE_1 = 'قال تعالى: ﴿الم﴾ [البقرة: ١-٣] وهو حديث رواه مسلم، وقد سكن بغداد.'


class RollupTests(TestCase):
    def setUp(self):
        self.document = Document.objects.create(
            title='كتاب', file='documents/x.txt', content=PAGE_1, processed=True)

    def test_summary_aggregates_active_mentions_and_meta(self):
        DocumentMeta.objects.create(
            document=self.document, genre='hadith', madhhab='na', era_century=3,
            physical_class='printed_book', status=DocumentMeta.Status.SUCCEEDED)
        person = Person.objects.create(
            display_name='فلان', blocking_key='فلان', source=Person.Source.MANUAL)
        place = Place.objects.create(
            name='بغداد', source=Place.Source.MANUAL, source_id='t-baghdad')
        EntityMention.objects.create(
            document=self.document, page_number=1, char_start=0, char_end=4,
            surface_text='قال', normalized_text='فلان', entity_type='person',
            person=person, extractor_name='persons', extractor_version='1',
            content_hash='h')
        EntityMention.objects.create(
            document=self.document, page_number=1, char_start=5, char_end=9,
            surface_text='بغداد', normalized_text='بغداد', entity_type='place',
            place=place, extractor_name='places', extractor_version='1',
            content_hash='h')
        EntityMention.objects.create(
            document=self.document, page_number=1, char_start=10, char_end=14,
            surface_text='آية', normalized_text='quran:2:1-3',
            normalized={'sura': 2, 'aya_start': 1, 'aya_end': 3},
            entity_type='quran', extractor_name='quran', extractor_version='1',
            content_hash='h')
        EntityMention.objects.create(
            document=self.document, page_number=1, char_start=15, char_end=19,
            surface_text='رواه مسلم', normalized_text='muslim',
            normalized={'collection': 'muslim'}, entity_type='hadith_source',
            extractor_name='takhrij', extractor_version='1', content_hash='h')
        # A rejected mention never reaches the rollup.
        EntityMention.objects.create(
            document=self.document, page_number=1, char_start=20, char_end=24,
            surface_text='خطأ', normalized_text='bukhari', entity_type='hadith_source',
            extractor_name='takhrij', extractor_version='1', content_hash='h',
            review_status=EntityMention.ReviewStatus.REJECTED)

        summary = build_document_entity_summary(self.document)
        self.assertEqual(summary['genre'], 'hadith')
        self.assertEqual(summary['era_century'], 3)
        self.assertEqual(summary['person_keys'], [f'p:{person.id}'])
        self.assertEqual(summary['place_keys'], [f'pl:{place.id}'])
        self.assertEqual(summary['quran_suras'], [2])
        self.assertEqual(summary['quran_ayas'], ['2:1', '2:2', '2:3'])
        self.assertEqual(summary['hadith_collections'], ['muslim'])

    def test_facet_registry_registered_by_app_ready(self):
        for key in ('genre', 'madhhab', 'person_keys', 'place_keys',
                    'quran_ayas', 'hadith_collections'):
            self.assertIn(key, FACET_REGISTRY)


class PageMentionsApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='reader', email='r@example.com', password='ReaderPass123!')
        self.client.force_authenticate(user=self.user)
        self.document = Document.objects.create(
            title='كتاب', file='documents/x.txt', content=PAGE_1, processed=True)
        extract_document_task.run(self.document.id, extractors=['quran', 'takhrij'])

    def test_page_mentions_with_content_hash(self):
        resp = self.client.get(
            f'/api/extraction/documents/{self.document.id}/pages/1/mentions/')
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.data['content_hash'])
        types = {m['entity_type'] for m in resp.data['mentions']}
        self.assertEqual(types, {'quran', 'hadith_source'})
        for m in resp.data['mentions']:
            self.assertEqual(
                PAGE_1[m['char_start']:m['char_end']], m['surface_text'])
            self.assertEqual(m['content_hash'], resp.data['content_hash'])

    def test_missing_document_404(self):
        resp = self.client.get('/api/extraction/documents/999999/pages/1/mentions/')
        self.assertEqual(resp.status_code, 404)
