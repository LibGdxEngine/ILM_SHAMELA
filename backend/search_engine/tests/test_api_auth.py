from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import override_settings
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework import status
from rest_framework.test import APITestCase


User = get_user_model()


@override_settings(
    DEFAULT_FILE_STORAGE='django.core.files.storage.FileSystemStorage',
    MEDIA_ROOT='/tmp/ilm_shamela_test_media',
)
class DocumentApiAuthTests(APITestCase):
    def setUp(self):
        self.reader = User.objects.create_user(
            username='reader',
            email='reader@example.com',
            password='ReaderPass123!',
        )
        self.editor = User.objects.create_user(
            username='editor',
            email='editor@example.com',
            password='EditorPass123!',
        )
        editor_group, _ = Group.objects.get_or_create(name='editor')
        self.editor.groups.add(editor_group)

    def _sample_upload(self):
        return SimpleUploadedFile(
            'sample.txt',
            b'Example content for testing uploads',
            content_type='text/plain',
        )

    def test_documents_list_requires_authentication(self):
        response = self.client.get('/api/search_engine/documents/')
        self.assertIn(
            response.status_code,
            {status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN},
        )

    def test_authenticated_reader_can_list_documents(self):
        self.client.force_authenticate(user=self.reader)
        response = self.client.get('/api/search_engine/documents/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_reader_cannot_upload_documents(self):
        self.client.force_authenticate(user=self.reader)
        response = self.client.post(
            '/api/search_engine/documents/',
            {
                'title': 'Reader Upload',
                'file': self._sample_upload(),
            },
            format='multipart',
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_editor_can_upload_documents(self):
        self.client.force_authenticate(user=self.editor)
        response = self.client.post(
            '/api/search_engine/documents/',
            {
                'title': 'Editor Upload',
                'file': self._sample_upload(),
            },
            format='multipart',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertIn('processing_status', response.data)
