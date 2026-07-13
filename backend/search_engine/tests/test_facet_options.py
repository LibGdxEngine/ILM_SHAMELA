"""Tests for the combined facet-options endpoint (``/documents/facet-options/``)."""

from django.contrib.auth import get_user_model
from django.core.cache import cache
from rest_framework import status
from rest_framework.test import APITestCase

from search_engine.models import Author, Category, CountryDocumentCount, Document


User = get_user_model()

URL = '/api/search_engine/documents/facet-options/'


class FacetOptionsTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            username='researcher',
            email='researcher@example.com',
            password='ResearchPass123!',
        )

        # Two 8th-century authors sharing a book + one 10th-century author.
        self.ibn_taymiyya = Author.objects.create(
            name='ابن تيمية', date_of_death='728 هـ', nationality='الشام')
        self.ibn_qayyim = Author.objects.create(
            name='ابن القيم', date_of_death='751 هـ', nationality='الشام')
        self.suyuti = Author.objects.create(
            name='السيوطي', date_of_death='911 هـ', nationality='مصر')
        self.unknown = Author.objects.create(name='مجهول', date_of_death='د.ت')

        self.cat = Category.objects.create(name='فقه')

        # doc_shared has BOTH 8th-century authors → must count once for century 8.
        self.doc_shared = Document.objects.create(title='كتاب مشترك', content='x', language='ar')
        self.doc_shared.authors.add(self.ibn_taymiyya, self.ibn_qayyim)

        self.doc_solo = Document.objects.create(title='كتاب منفرد', content='y', language='ar')
        self.doc_solo.authors.add(self.suyuti)

        self.doc_en = Document.objects.create(title='English book', content='z', language='en')
        self.doc_en.authors.add(self.unknown)

        # CountryDocumentCount rows are maintained by signals when authors
        # with nationalities are attached above; refresh_all() makes the
        # counts deterministic regardless of signal ordering.
        CountryDocumentCount.refresh_all()

        self.client.force_authenticate(user=self.user)

    def tearDown(self):
        cache.clear()

    def test_requires_authentication(self):
        self.client.force_authenticate(user=None)
        resp = self.client.get(URL)
        self.assertIn(
            resp.status_code,
            {status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN},
        )

    def test_response_shape_and_ordering(self):
        resp = self.client.get(URL)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

        # Languages: count-descending.
        self.assertEqual(
            resp.data['languages'],
            [{'value': 'ar', 'count': 2}, {'value': 'en', 'count': 1}],
        )

        # Death centuries: ascending by century; the shared 8th-century book
        # counts ONCE even with two same-century authors; the unparseable
        # author contributes no century bucket.
        self.assertEqual(
            resp.data['death_centuries'],
            [{'value': 8, 'count': 1}, {'value': 10, 'count': 1}],
        )

        # Countries come from the denormalized table.
        self.assertEqual(
            sorted(resp.data['countries'], key=lambda r: r['value']),
            [{'value': 'الشام', 'count': 1}, {'value': 'مصر', 'count': 1}],
        )

    def test_second_request_is_cache_served(self):
        first = self.client.get(URL)
        self.assertEqual(first.status_code, status.HTTP_200_OK)

        # Mutate the DB after the first request: a cached second response must
        # NOT reflect it (300s TTL payload).
        Document.objects.create(title='آخر', content='w', language='fa')

        second = self.client.get(URL)
        self.assertEqual(second.data, first.data)

        cache.clear()
        third = self.client.get(URL)
        self.assertIn({'value': 'fa', 'count': 1}, third.data['languages'])
