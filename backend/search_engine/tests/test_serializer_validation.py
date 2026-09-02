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

    def test_accepts_markdown_extension(self):
        file_obj = SimpleUploadedFile(
            'book.md', '# عنوان\n'.encode('utf-8'), content_type='text/markdown')
        serializer = DocumentSerializer(
            data={
                'title': 'Markdown Book',
                'file': file_obj,
            }
        )

        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_rejects_ocr_layout_attached_to_markdown(self):
        """An OCR layout JSON only pairs with a PDF page-image source."""
        file_obj = SimpleUploadedFile(
            'book.md', '# عنوان\n'.encode('utf-8'), content_type='text/markdown')
        layout = SimpleUploadedFile(
            'layout.json', b'{"children": []}', content_type='application/json')
        serializer = DocumentSerializer(
            data={
                'title': 'Markdown Book',
                'file': file_obj,
                'ocr_layout': layout,
            }
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn('ocr_layout', serializer.errors)
