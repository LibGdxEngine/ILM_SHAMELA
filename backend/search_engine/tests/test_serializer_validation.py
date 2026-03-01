from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase

from search_engine.serializers import DocumentSerializer


class DocumentSerializerValidationTests(TestCase):
    def test_rejects_unsupported_extension(self):
        file_obj = SimpleUploadedFile('malware.exe', b'1234', content_type='application/octet-stream')
        serializer = DocumentSerializer(
            data={
                'title': 'Bad File',
                'file': file_obj,
            }
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn('file', serializer.errors)
