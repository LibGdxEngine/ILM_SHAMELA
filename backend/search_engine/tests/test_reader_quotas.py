from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.cache import cache
from django.test import override_settings
from rest_framework import status
from rest_framework.test import APITestCase

from search_engine.models import Document


User = get_user_model()


def _pages_url(doc_id, **params):
    query = '&'.join(f'{k}={v}' for k, v in params.items())
    return f'/api/search_engine/documents/{doc_id}/pages/' + (f'?{query}' if query else '')


def _make_document(title, num_pages=6):
    content = '\n\n\n'.join(f'{title} page {i} content.' for i in range(1, num_pages + 1))
    return Document.objects.create(
        title=title, file=f'documents/{title}.txt', content=content)


@override_settings(
    DEFAULT_FILE_STORAGE='django.core.files.storage.FileSystemStorage',
    MEDIA_ROOT='/tmp/ilm_shamela_test_media',
)
class PagesEndpointClampTests(APITestCase):
    def setUp(self):
        # LocMemCache persists per process — clear so quota/throttle counters
        # never leak between tests.
        cache.clear()
        self.user = User.objects.create_user(
            username='clamp_user', email='clamp@example.com', password='Pass123!')
        self.document = _make_document('clamp-doc', num_pages=15)
        self.client.force_authenticate(user=self.user)

    def test_page_size_is_clamped(self):
        response = self.client.get(_pages_url(self.document.id, page=1, page_size=100000))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['page_size'], 10)
        self.assertLessEqual(len(response.data['pages']), 10)

    def test_invalid_pagination_returns_400(self):
        for params in ({'page': 0}, {'page': -1}, {'page': 'abc'}, {'page_size': 'abc'}, {'page_size': 0}):
            response = self.client.get(_pages_url(self.document.id, **params))
            self.assertEqual(
                response.status_code, status.HTTP_400_BAD_REQUEST, params)
            self.assertEqual(response.data['error'], 'invalid_pagination')

    def test_detail_endpoint_omits_content(self):
        response = self.client.get(f'/api/search_engine/documents/{self.document.id}/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertNotIn('content', response.data)


@override_settings(
    DEFAULT_FILE_STORAGE='django.core.files.storage.FileSystemStorage',
    MEDIA_ROOT='/tmp/ilm_shamela_test_media',
)
class ReaderQuotaTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            username='quota_user', email='quota@example.com', password='Pass123!')
        self.doc_a = _make_document('quota-a')
        self.doc_b = _make_document('quota-b')
        self.doc_c = _make_document('quota-c')
        self.client.force_authenticate(user=self.user)

    @override_settings(READER_MAX_PAGES_PER_DAY=12, READER_MAX_DOCS_PER_DAY=0)
    def test_pages_quota_enforced(self):
        for _ in range(2):
            response = self.client.get(_pages_url(self.doc_a.id, page=1, page_size=5))
            self.assertEqual(response.status_code, status.HTTP_200_OK)

        response = self.client.get(_pages_url(self.doc_a.id, page=1, page_size=5))
        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertEqual(response.data['error'], 'quota_exceeded')
        self.assertEqual(response.data['quota'], 'pages')
        self.assertEqual(response.data['limit'], 12)
        self.assertGreater(response.data['retry_after_seconds'], 0)
        self.assertIn('Retry-After', response.headers)

    @override_settings(READER_MAX_DOCS_PER_DAY=2, READER_MAX_PAGES_PER_DAY=0)
    def test_docs_quota_enforced_but_open_docs_stay_readable(self):
        for doc in (self.doc_a, self.doc_b):
            response = self.client.get(_pages_url(doc.id, page=1, page_size=5))
            self.assertEqual(response.status_code, status.HTTP_200_OK)

        response = self.client.get(_pages_url(self.doc_c.id, page=1, page_size=5))
        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertEqual(response.data['quota'], 'documents')

        # A book counted today stays readable after the limit is hit.
        response = self.client.get(_pages_url(self.doc_a.id, page=2, page_size=5))
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    @override_settings(READER_MAX_DOCS_PER_DAY=1, READER_MAX_PAGES_PER_DAY=5)
    def test_staff_and_editors_are_exempt(self):
        staff = User.objects.create_user(
            username='staff', email='staff@example.com', password='Pass123!',
            is_staff=True)
        editor = User.objects.create_user(
            username='quota_editor', email='qeditor@example.com', password='Pass123!')
        editor_group, _ = Group.objects.get_or_create(name='editor')
        editor.groups.add(editor_group)

        for user in (staff, editor):
            self.client.force_authenticate(user=user)
            for doc in (self.doc_a, self.doc_b, self.doc_c):
                response = self.client.get(_pages_url(doc.id, page=1, page_size=5))
                self.assertEqual(response.status_code, status.HTTP_200_OK, user.username)

    @override_settings(READER_MAX_DOCS_PER_DAY=0, READER_MAX_PAGES_PER_DAY=0)
    def test_zero_limits_disable_quotas(self):
        for doc in (self.doc_a, self.doc_b, self.doc_c):
            for page in (1, 2):
                response = self.client.get(_pages_url(doc.id, page=page, page_size=5))
                self.assertEqual(response.status_code, status.HTTP_200_OK)

    @override_settings(READER_MAX_DOCS_PER_DAY=2, READER_MAX_PAGES_PER_DAY=0)
    def test_quotas_are_per_user(self):
        for doc in (self.doc_a, self.doc_b):
            self.client.get(_pages_url(doc.id, page=1, page_size=5))
        response = self.client.get(_pages_url(self.doc_c.id, page=1, page_size=5))
        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

        other = User.objects.create_user(
            username='quota_other', email='qother@example.com', password='Pass123!')
        self.client.force_authenticate(user=other)
        response = self.client.get(_pages_url(self.doc_c.id, page=1, page_size=5))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
