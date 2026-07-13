"""Tests for the natural-language search assistant (``/documents/search/assist/``).

The OpenRouter chat model is patched so the endpoint's *deterministic* half — tool
selection, facet resolution against the DB, fold-back of unresolved guesses into
free text, value sanitisation, and graceful degradation — is exercised without a
live LLM.
"""
import os
from types import SimpleNamespace
from unittest import mock

from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from django.core.cache import cache

from search_engine.models import Author, Category, CountryDocumentCount, Document


User = get_user_model()

URL = '/api/search_engine/documents/search/assist/'
MAKE_CHAT = 'search_engine.llm.make_openrouter_chat'


def _fake_chat(tool_args):
    """A stand-in for ``make_openrouter_chat`` whose bound model returns a single
    ``set_library_filters`` tool call carrying ``tool_args``."""
    response = SimpleNamespace(
        tool_calls=[{'name': 'set_library_filters', 'args': tool_args, 'id': '1', 'type': 'tool_call'}]
    )
    bound = mock.Mock()
    bound.invoke.return_value = response
    chat = mock.Mock()
    chat.bind_tools.return_value = bound
    return chat


class SearchAssistTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            username='assist', email='assist@example.com', password='AssistPass123!'
        )
        self.author_one = Author.objects.create(name='المؤلف الأول', nationality='مصر')
        self.author_two = Author.objects.create(name='المؤلف الثاني')
        self.cat_fiqh = Category.objects.create(name='فقه')

        doc = Document.objects.create(title='كتاب', content='x', language='ar')
        doc.authors.add(self.author_one)
        doc.categories.add(self.cat_fiqh)
        CountryDocumentCount.refresh_all()

        self.client.force_authenticate(user=self.user)

    def tearDown(self):
        cache.clear()

    def test_empty_query_is_rejected(self):
        resp = self.client.post(URL, {'q': '  '}, format='json')
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    @mock.patch.dict(os.environ, {'OPENROUTER_API_KEY': 'test-key'})
    def test_resolves_facets_and_folds_unknown_guesses(self):
        args = {
            'search_terms': 'الطهارة',
            # 'المؤلف' icontains both seeded authors → canonical first by name;
            # 'ابن رشد' matches no Author → folded into the free-text query.
            'authors': ['المؤلف', 'ابن رشد'],
            'categories': ['فقه'],
            'languages': ['AR'],  # upper-cased → resolves to the stored 'ar'
            'mode': 'exact',
            'date_from': '2020-01-01',
            'date_to': None,
            'interpretation': 'بحث عن الطهارة',
        }
        with mock.patch(MAKE_CHAT, return_value=_fake_chat(args)):
            resp = self.client.post(URL, {'q': 'كتب المؤلف عن الطهارة', 'locale': 'ar'}, format='json')

        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        filters = resp.json()['filters']
        self.assertEqual(filters['authors'], ['المؤلف الأول'])
        self.assertEqual(filters['categories'], ['فقه'])
        self.assertEqual(filters['languages'], ['ar'])
        self.assertEqual(filters['mode'], 'exact')
        self.assertEqual(filters['dateFrom'], '2020-01-01')
        self.assertIsNone(filters['dateTo'])
        # Unresolved author guess is folded into the free-text query.
        self.assertIn('الطهارة', filters['q'])
        self.assertIn('ابن رشد', filters['q'])
        self.assertEqual(resp.json()['interpretation'], 'بحث عن الطهارة')

    @mock.patch.dict(os.environ, {'OPENROUTER_API_KEY': 'test-key'})
    def test_resolves_countries_and_death_centuries(self):
        args = {
            'search_terms': 'الفقه',
            # 'مصر' exists in CountryDocumentCount (case-insensitive canonical);
            # 'أطلانتس' doesn't → folded into the free-text query.
            'countries': ['مصر', 'أطلانتس'],
            # 30 and 'x' are implausible/invalid → dropped, not folded.
            'death_centuries': [8, 30, 'x', 8],
        }
        with mock.patch(MAKE_CHAT, return_value=_fake_chat(args)):
            resp = self.client.post(URL, {'q': 'علماء مصر في القرن الثامن'}, format='json')

        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        filters = resp.json()['filters']
        self.assertEqual(filters['countries'], ['مصر'])
        self.assertEqual(filters['deathCenturies'], [8])
        self.assertIn('أطلانتس', filters['q'])
        self.assertNotIn('30', filters['q'])

    def test_degraded_shape_includes_new_keys(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop('OPENROUTER_API_KEY', None)
            resp = self.client.post(URL, {'q': 'كتب'}, format='json')
        filters = resp.json()['filters']
        self.assertEqual(filters['countries'], [])
        self.assertEqual(filters['deathCenturies'], [])

    @mock.patch.dict(os.environ, {'OPENROUTER_API_KEY': 'test-key'})
    def test_invalid_mode_and_date_are_sanitised(self):
        args = {
            'search_terms': 'فقه',
            'mode': 'fuzzy',            # not a valid corpus mode → hybrid
            'date_from': 'not-a-date',  # invalid → None
        }
        with mock.patch(MAKE_CHAT, return_value=_fake_chat(args)):
            resp = self.client.post(URL, {'q': 'فقه'}, format='json')

        filters = resp.json()['filters']
        self.assertEqual(filters['mode'], 'hybrid')
        self.assertIsNone(filters['dateFrom'])

    def test_degrades_gracefully_without_api_key(self):
        # No OPENROUTER_API_KEY in the environment → plain hybrid search fallback.
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop('OPENROUTER_API_KEY', None)
            resp = self.client.post(URL, {'q': 'كتب الغزالي'}, format='json')

        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        body = resp.json()
        self.assertEqual(body['degraded_reason'], 'ai_unavailable')
        self.assertEqual(body['filters']['q'], 'كتب الغزالي')
        self.assertEqual(body['filters']['mode'], 'hybrid')
        self.assertIsNone(body['interpretation'])

    @mock.patch.dict(os.environ, {'OPENROUTER_API_KEY': 'test-key'})
    def test_degrades_when_llm_errors(self):
        chat = mock.Mock()
        chat.bind_tools.return_value.invoke.side_effect = RuntimeError('boom')
        with mock.patch(MAKE_CHAT, return_value=chat):
            resp = self.client.post(URL, {'q': 'كتب'}, format='json')

        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.json()['degraded_reason'], 'ai_unavailable')

    def test_requires_authentication(self):
        self.client.force_authenticate(user=None)
        resp = self.client.post(URL, {'q': 'كتب'}, format='json')
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)
