from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework import status
from rest_framework.test import APITestCase

from search_engine.models import Bookmark, Document, Note, ReadingProgress


User = get_user_model()


@override_settings(
    DEFAULT_FILE_STORAGE='django.core.files.storage.FileSystemStorage',
    MEDIA_ROOT='/tmp/ilm_shamela_test_media',
)
class ReaderApiTests(APITestCase):
    def setUp(self):
        self.user_a = User.objects.create_user(
            username='reader_a',
            email='reader_a@example.com',
            password='ReaderPass123!',
        )
        self.user_b = User.objects.create_user(
            username='reader_b',
            email='reader_b@example.com',
            password='ReaderPass123!',
        )
        self.document = Document.objects.create(
            title='Sample Document',
            file='documents/sample.txt',
            content='Page one content.\n\n\nPage two content.\n\n\nPage three content.',
        )
        self.other_document = Document.objects.create(
            title='Other Document',
            file='documents/other.txt',
            content='Other content here.',
        )

    # --- Auth ---------------------------------------------------------

    def test_unauthenticated_bookmark_list_returns_401(self):
        response = self.client.get('/api/search_engine/reader/bookmarks/')
        self.assertIn(
            response.status_code,
            {status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN},
        )

    # --- Owner isolation ---------------------------------------------

    def test_user_b_cannot_see_user_a_bookmarks(self):
        Bookmark.objects.create(user=self.user_a, document=self.document, page_number=2)
        self.client.force_authenticate(user=self.user_b)
        response = self.client.get(
            f'/api/search_engine/reader/bookmarks/?document={self.document.id}'
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 0)

    # --- Bookmark unique constraint ----------------------------------

    def test_bookmark_unique_constraint_returns_400(self):
        self.client.force_authenticate(user=self.user_a)
        payload = {'document': self.document.id, 'page_number': 5}
        first = self.client.post(
            '/api/search_engine/reader/bookmarks/', payload, format='json'
        )
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        second = self.client.post(
            '/api/search_engine/reader/bookmarks/', payload, format='json'
        )
        self.assertEqual(second.status_code, status.HTTP_400_BAD_REQUEST)

    # --- ReadingProgress upsert --------------------------------------

    def test_reading_progress_upsert_keeps_one_row(self):
        self.client.force_authenticate(user=self.user_a)
        url = f'/api/search_engine/reader/progress/{self.document.id}/'
        first = self.client.patch(url, {'last_page': 4}, format='json')
        self.assertEqual(first.status_code, status.HTTP_200_OK)
        second = self.client.patch(
            url, {'last_page': 12, 'percent_complete': 0.5}, format='json'
        )
        self.assertEqual(second.status_code, status.HTTP_200_OK)
        rows = ReadingProgress.objects.filter(
            user=self.user_a, document=self.document
        )
        self.assertEqual(rows.count(), 1)
        row = rows.first()
        self.assertEqual(row.last_page, 12)
        self.assertAlmostEqual(row.percent_complete, 0.5)

    # --- Note export -------------------------------------------------

    def test_note_export_markdown(self):
        Note.objects.create(
            user=self.user_a,
            document=self.document,
            page_number=1,
            body='First note body',
            tags=['tag1', 'tag2'],
        )
        Note.objects.create(
            user=self.user_a,
            document=self.document,
            page_number=2,
            body='Second note body',
        )
        self.client.force_authenticate(user=self.user_a)
        response = self.client.get(
            f'/api/search_engine/reader/notes/export/?document={self.document.id}&format=md'
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response['Content-Type'].startswith('text/markdown'))
        body = response.content.decode('utf-8')
        self.assertIn('## Page 1', body)
        self.assertIn('## Page 2', body)
        self.assertIn('First note body', body)
        self.assertIn('Second note body', body)
        self.assertIn('Tags: tag1, tag2', body)

    def test_note_export_pdf_returns_400(self):
        self.client.force_authenticate(user=self.user_a)
        response = self.client.get(
            f'/api/search_engine/reader/notes/export/?document={self.document.id}&format=pdf'
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            response.data,
            {
                'error': 'PDF export not yet available',
                'supported_formats': ['md'],
            },
        )

    # --- Continue reading --------------------------------------------

    def test_continue_reading_orders_by_recent_and_includes_total_pages(self):
        ReadingProgress.objects.create(
            user=self.user_a, document=self.other_document, last_page=1
        )
        ReadingProgress.objects.create(
            user=self.user_a, document=self.document, last_page=2
        )
        self.client.force_authenticate(user=self.user_a)
        response = self.client.get('/api/search_engine/reader/continue/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        items = response.data
        self.assertGreaterEqual(len(items), 2)
        self.assertEqual(items[0]['document'], self.document.id)
        self.assertIn('total_pages', items[0])
        self.assertGreaterEqual(items[0]['total_pages'], 1)

    # --- Highlight char range validation ------------------------------

    def test_highlight_rejects_equal_or_inverted_range(self):
        self.client.force_authenticate(user=self.user_a)
        url = '/api/search_engine/reader/highlights/'
        equal = self.client.post(
            url,
            {
                'document': self.document.id,
                'page_number': 1,
                'paragraph_id': 'p1-0',
                'char_start': 5,
                'char_end': 5,
            },
            format='json',
        )
        self.assertEqual(equal.status_code, status.HTTP_400_BAD_REQUEST)
        inverted = self.client.post(
            url,
            {
                'document': self.document.id,
                'page_number': 1,
                'paragraph_id': 'p1-0',
                'char_start': 10,
                'char_end': 5,
            },
            format='json',
        )
        self.assertEqual(inverted.status_code, status.HTTP_400_BAD_REQUEST)

    # --- Tag list validation -----------------------------------------

    def test_tag_list_rejects_too_many_entries(self):
        self.client.force_authenticate(user=self.user_a)
        too_many = [f't{i}' for i in range(17)]
        response = self.client.post(
            '/api/search_engine/reader/bookmarks/',
            {
                'document': self.document.id,
                'page_number': 1,
                'tags': too_many,
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('tags', response.data)

    def test_tag_list_rejects_overlong_entry(self):
        self.client.force_authenticate(user=self.user_a)
        too_long = ['x' * 33]
        response = self.client.post(
            '/api/search_engine/reader/bookmarks/',
            {
                'document': self.document.id,
                'page_number': 1,
                'tags': too_long,
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('tags', response.data)
