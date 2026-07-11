import os
import shutil

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings


User = get_user_model()

TEST_MEDIA_ROOT = '/tmp/ilm_shamela_test_media_protection'


@override_settings(MEDIA_ROOT=TEST_MEDIA_ROOT)
class MediaProtectionTests(TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        for rel in (
            'documents/pages/1/page-1.webp',
            'documents/original.pdf',
            'documents/ocr/1/layout.json',
            'documents/covers/cover.jpg',
            'documents/thumbnails/thumb.jpg',
            'authors/photos/author.jpg',
        ):
            path = os.path.join(TEST_MEDIA_ROOT, rel)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, 'wb') as fh:
                fh.write(b'test-bytes')

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(TEST_MEDIA_ROOT, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        self.user = User.objects.create_user(
            username='media_user', email='media@example.com', password='Pass123!')

    def test_anonymous_cannot_fetch_book_content(self):
        for rel in (
            'documents/pages/1/page-1.webp',
            'documents/original.pdf',
            'documents/ocr/1/layout.json',
        ):
            response = self.client.get(f'/media/{rel}')
            self.assertEqual(response.status_code, 401, rel)

    def test_anonymous_can_fetch_public_assets(self):
        for rel in (
            'documents/covers/cover.jpg',
            'documents/thumbnails/thumb.jpg',
            'authors/photos/author.jpg',
        ):
            response = self.client.get(f'/media/{rel}')
            self.assertEqual(response.status_code, 200, rel)

    def test_authenticated_session_can_fetch_book_content(self):
        self.client.force_login(self.user)
        response = self.client.get('/media/documents/pages/1/page-1.webp')
        self.assertEqual(response.status_code, 200)

    def test_public_prefix_cannot_be_abused_with_dot_segments(self):
        # 'documents/covers/../pages/...' normalizes to a protected path and
        # must not slip through the public-prefix check.
        response = self.client.get('/media/documents/covers/../pages/1/page-1.webp')
        self.assertEqual(response.status_code, 401)
