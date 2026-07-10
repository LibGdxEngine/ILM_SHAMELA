"""Tests for the rights/provenance audit fields and the Edition print-page mapping
(موافقة المطبوع): model math + validation, upload capture, list filtering, the pages
endpoint's printed_ref payload, chat-citation enrichment, and reprocess survival.
"""
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.test import APITestCase

from search_engine.models import (
    ChatSession,
    Document,
    DocumentChunk,
    Edition,
)
from search_engine.tasks import process_document_task


User = get_user_model()

TWO_VOLUME_MAP = [
    # Digital pages 1-10 = volume 1 starting at printed page 5 (front matter offset).
    {'volume': 1, 'from_page': 1, 'to_page': 10, 'printed_start': 5},
    # Digital pages 11-20 = volume 2 restarting at printed page 1.
    {'volume': 2, 'from_page': 11, 'to_page': 20, 'printed_start': 1},
]


def _make_document(**kwargs):
    kwargs.setdefault('title', 'Edition Test Doc')
    kwargs.setdefault('file', SimpleUploadedFile(
        'edition.txt', b'test content', content_type='text/plain'))
    return Document.objects.create(**kwargs)


class EditionPrintedRefTests(TestCase):
    def setUp(self):
        self.document = _make_document()
        self.edition = Edition.objects.create(
            document=self.document, page_map=TWO_VOLUME_MAP)

    def test_offset_within_first_volume(self):
        self.assertEqual(
            self.edition.printed_ref(3), {'volume': 1, 'printed_page': 7})

    def test_volume_boundary(self):
        self.assertEqual(
            self.edition.printed_ref(10), {'volume': 1, 'printed_page': 14})
        self.assertEqual(
            self.edition.printed_ref(11), {'volume': 2, 'printed_page': 1})

    def test_last_mapped_page(self):
        self.assertEqual(
            self.edition.printed_ref(20), {'volume': 2, 'printed_page': 10})

    def test_gap_returns_none(self):
        self.assertIsNone(self.edition.printed_ref(21))

    def test_zero_and_none_return_none(self):
        self.assertIsNone(self.edition.printed_ref(0))
        self.assertIsNone(self.edition.printed_ref(None))

    def test_empty_map_returns_none(self):
        edition = Edition.objects.create(document=self.document, page_map=[])
        self.assertIsNone(edition.printed_ref(1))

    def test_malformed_entries_are_skipped(self):
        edition = Edition.objects.create(
            document=self.document,
            page_map=['garbage', {'volume': 1, 'from_page': 'x'},
                      {'volume': 1, 'from_page': 1, 'to_page': 5, 'printed_start': 1}],
        )
        self.assertEqual(
            edition.printed_ref(2), {'volume': 1, 'printed_page': 2})


class EditionCleanValidationTests(TestCase):
    def setUp(self):
        self.document = _make_document()

    def _edition(self, page_map):
        return Edition(document=self.document, page_map=page_map)

    def test_valid_map_passes(self):
        self._edition(TWO_VOLUME_MAP).clean()

    def test_empty_map_passes(self):
        self._edition([]).clean()

    def test_non_list_rejected(self):
        with self.assertRaises(ValidationError):
            self._edition({'volume': 1}).clean()

    def test_non_dict_entry_rejected(self):
        with self.assertRaises(ValidationError):
            self._edition(['not-a-dict']).clean()

    def test_missing_key_rejected(self):
        with self.assertRaises(ValidationError):
            self._edition([{'volume': 1, 'from_page': 1, 'to_page': 5}]).clean()

    def test_non_int_value_rejected(self):
        with self.assertRaises(ValidationError):
            self._edition([{
                'volume': 1, 'from_page': '1', 'to_page': 5, 'printed_start': 1,
            }]).clean()

    def test_bool_value_rejected(self):
        with self.assertRaises(ValidationError):
            self._edition([{
                'volume': True, 'from_page': 1, 'to_page': 5, 'printed_start': 1,
            }]).clean()

    def test_below_one_rejected(self):
        with self.assertRaises(ValidationError):
            self._edition([{
                'volume': 0, 'from_page': 1, 'to_page': 5, 'printed_start': 1,
            }]).clean()

    def test_inverted_range_rejected(self):
        with self.assertRaises(ValidationError):
            self._edition([{
                'volume': 1, 'from_page': 10, 'to_page': 5, 'printed_start': 1,
            }]).clean()

    def test_overlapping_ranges_rejected(self):
        with self.assertRaises(ValidationError):
            self._edition([
                {'volume': 1, 'from_page': 1, 'to_page': 10, 'printed_start': 1},
                {'volume': 2, 'from_page': 10, 'to_page': 20, 'printed_start': 1},
            ]).clean()


@override_settings(
    DEFAULT_FILE_STORAGE='django.core.files.storage.FileSystemStorage',
    MEDIA_ROOT='/tmp/ilm_shamela_test_media',
)
class RightsUploadApiTests(APITestCase):
    def setUp(self):
        self.reader = User.objects.create_user(
            username='reader', email='reader@example.com', password='ReaderPass123!')
        self.editor = User.objects.create_user(
            username='editor', email='editor@example.com', password='EditorPass123!')
        editor_group, _ = Group.objects.get_or_create(name='editor')
        self.editor.groups.add(editor_group)

    def _sample_upload(self):
        return SimpleUploadedFile(
            'sample.txt', b'Example content', content_type='text/plain')

    def test_editor_upload_with_rights_and_edition(self):
        self.client.force_authenticate(user=self.editor)
        response = self.client.post(
            '/api/search_engine/documents/',
            {
                'title': 'Muhaqqaq Upload',
                'file': self._sample_upload(),
                'rights_status': 'gray',
                'provenance_source': 'scan of Dar X 1407H edition',
                'rights_notes': 'tahqiq rights unclear',
                'edition_editor': 'محمد فؤاد عبد الباقي',
                'edition_publisher': 'دار إحياء الكتب العربية',
                'edition_year_hijri': '1374',
                'edition_year_gregorian': '1955',
                'edition_volume_count': 2,
            },
            format='multipart',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        document = Document.objects.get(id=response.data['id'])
        self.assertEqual(document.rights_status, Document.RightsStatus.GRAY)
        self.assertEqual(document.provenance_source, 'scan of Dar X 1407H edition')
        self.assertEqual(document.rights_notes, 'tahqiq rights unclear')
        self.assertEqual(document.editions.count(), 1)
        edition = document.editions.get()
        self.assertEqual(edition.editor, 'محمد فؤاد عبد الباقي')
        self.assertEqual(edition.publisher, 'دار إحياء الكتب العربية')
        self.assertEqual(edition.publication_year_hijri, '1374')
        self.assertEqual(edition.publication_year_gregorian, '1955')
        self.assertEqual(edition.volume_count, 2)

    def test_upload_without_edition_fields_creates_no_edition(self):
        self.client.force_authenticate(user=self.editor)
        response = self.client.post(
            '/api/search_engine/documents/',
            {'title': 'Plain Upload', 'file': self._sample_upload()},
            format='multipart',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        document = Document.objects.get(id=response.data['id'])
        self.assertEqual(document.rights_status, Document.RightsStatus.UNREVIEWED)
        self.assertEqual(document.editions.count(), 0)

    def test_reader_cannot_upload_with_rights_fields(self):
        self.client.force_authenticate(user=self.reader)
        response = self.client.post(
            '/api/search_engine/documents/',
            {
                'title': 'Reader Upload',
                'file': self._sample_upload(),
                'rights_status': 'clear',
            },
            format='multipart',
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_editor_can_patch_rights_status(self):
        document = _make_document()
        self.client.force_authenticate(user=self.editor)
        response = self.client.patch(
            f'/api/search_engine/documents/{document.id}/',
            {'rights_status': 'clear', 'provenance_source': 'public domain print'},
            format='multipart',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        document.refresh_from_db()
        self.assertEqual(document.rights_status, Document.RightsStatus.CLEAR)
        self.assertEqual(document.provenance_source, 'public domain print')

    def test_detail_includes_editions_and_rights(self):
        document = _make_document(rights_status=Document.RightsStatus.CLEAR)
        Edition.objects.create(
            document=document, editor='محقق', page_map=TWO_VOLUME_MAP)
        self.client.force_authenticate(user=self.reader)
        response = self.client.get(f'/api/search_engine/documents/{document.id}/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['rights_status'], 'clear')
        self.assertEqual(len(response.data['editions']), 1)
        self.assertEqual(response.data['editions'][0]['editor'], 'محقق')
        self.assertEqual(response.data['editions'][0]['page_map'], TWO_VOLUME_MAP)


class RightsFilterTests(APITestCase):
    def setUp(self):
        self.reader = User.objects.create_user(
            username='reader', email='reader@example.com', password='ReaderPass123!')
        self.clear_doc = _make_document(
            title='Clear Doc', rights_status=Document.RightsStatus.CLEAR)
        self.gray_doc = _make_document(
            title='Gray Doc', rights_status=Document.RightsStatus.GRAY)
        self.unreviewed_doc = _make_document(title='Unreviewed Doc')
        self.client.force_authenticate(user=self.reader)

    def _result_titles(self, response):
        data = response.data
        results = data.get('results', data) if isinstance(data, dict) else data
        return {doc['title'] for doc in results}

    def test_single_status(self):
        response = self.client.get('/api/search_engine/documents/?rights_status=clear')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(self._result_titles(response), {'Clear Doc'})

    def test_multiple_statuses(self):
        response = self.client.get(
            '/api/search_engine/documents/?rights_status=clear,gray')
        self.assertEqual(
            self._result_titles(response), {'Clear Doc', 'Gray Doc'})

    def test_invalid_token_is_dropped(self):
        response = self.client.get('/api/search_engine/documents/?rights_status=bogus')
        self.assertEqual(
            self._result_titles(response),
            {'Clear Doc', 'Gray Doc', 'Unreviewed Doc'},
        )


@override_settings(
    DEFAULT_FILE_STORAGE='django.core.files.storage.FileSystemStorage',
    MEDIA_ROOT='/tmp/ilm_shamela_test_media',
)
class PagesPrintedRefTests(APITestCase):
    def setUp(self):
        self.reader = User.objects.create_user(
            username='reader', email='reader@example.com', password='ReaderPass123!')
        self.client.force_authenticate(user=self.reader)

    def test_content_split_pages_carry_printed_ref(self):
        document = _make_document(content='page one\ftext two\fpage three')
        Edition.objects.create(document=document, page_map=[
            {'volume': 1, 'from_page': 1, 'to_page': 2, 'printed_start': 9},
        ])
        response = self.client.get(
            f'/api/search_engine/documents/{document.id}/pages/?page=1&page_size=3')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        pages = response.data['pages']
        self.assertEqual(
            pages[0]['printed_ref'], {'volume': 1, 'printed_page': 9})
        self.assertEqual(
            pages[1]['printed_ref'], {'volume': 1, 'printed_page': 10})
        self.assertIsNone(pages[2]['printed_ref'])

    def test_layout_chunk_pages_carry_printed_ref(self):
        document = _make_document(has_layout=True)
        for page_number in (1, 2):
            DocumentChunk.objects.create(
                document=document,
                chunk_index=page_number - 1,
                page_number=page_number,
                content=f'chunk {page_number}',
            )
        Edition.objects.create(document=document, page_map=[
            {'volume': 2, 'from_page': 1, 'to_page': 2, 'printed_start': 120},
        ])
        response = self.client.get(
            f'/api/search_engine/documents/{document.id}/pages/?page=1&page_size=2')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        pages = response.data['pages']
        self.assertEqual(
            pages[0]['printed_ref'], {'volume': 2, 'printed_page': 120})
        self.assertEqual(
            pages[1]['printed_ref'], {'volume': 2, 'printed_page': 121})

    def test_pages_without_edition_have_null_printed_ref(self):
        document = _make_document(content='page one\ftext two')
        response = self.client.get(
            f'/api/search_engine/documents/{document.id}/pages/?page=1&page_size=2')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        for page in response.data['pages']:
            self.assertIsNone(page['printed_ref'])


class CitationEnrichmentTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='reader', email='reader@example.com', password='ReaderPass123!')
        self.document = _make_document(content='some content')
        Edition.objects.create(document=self.document, page_map=[
            {'volume': 2, 'from_page': 40, 'to_page': 50, 'printed_start': 141},
        ])
        self.session = ChatSession.objects.create(
            document=self.document, user=self.user)
        self.client.force_authenticate(user=self.user)

    def _store_url(self):
        return (
            f'/api/search_engine/documents/{self.document.id}'
            f'/chat/sessions/{self.session.id}/messages/store/'
        )

    def test_extracted_citations_are_enriched(self):
        response = self.client.post(
            self._store_url(),
            {'role': 'assistant', 'content': 'انظر [ص ٤٢](#p-42) للتفصيل.'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        citations = response.data['citations']
        self.assertEqual(len(citations), 1)
        self.assertEqual(citations[0]['page'], 42)
        self.assertEqual(citations[0]['volume'], 2)
        self.assertEqual(citations[0]['printed_page'], 143)

    def test_client_sent_citations_are_enriched(self):
        response = self.client.post(
            self._store_url(),
            {
                'role': 'assistant',
                'content': 'answer',
                'citations': [{'page': 45, 'quote': 'quoted text'}],
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        citations = response.data['citations']
        self.assertEqual(citations[0]['volume'], 2)
        self.assertEqual(citations[0]['printed_page'], 146)
        self.assertEqual(citations[0]['quote'], 'quoted text')

    def test_unmapped_page_passes_through_unchanged(self):
        response = self.client.post(
            self._store_url(),
            {'role': 'assistant', 'content': 'see [page 5](#p-5)'},
            format='json',
        )
        citations = response.data['citations']
        self.assertEqual(citations[0]['page'], 5)
        self.assertNotIn('volume', citations[0])

    def test_document_without_edition_is_unchanged(self):
        document = _make_document(title='No Edition Doc')
        session = ChatSession.objects.create(document=document, user=self.user)
        response = self.client.post(
            f'/api/search_engine/documents/{document.id}'
            f'/chat/sessions/{session.id}/messages/store/',
            {'role': 'assistant', 'content': 'see [page 5](#p-5)'},
            format='json',
        )
        citations = response.data['citations']
        self.assertEqual(citations, [{'page': 5, 'quote': 'page 5'}])

    def test_user_turns_are_not_enriched(self):
        response = self.client.post(
            self._store_url(),
            {'role': 'user', 'content': 'ما معنى [ص ٤٢](#p-42)؟'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['citations'], [])


@override_settings(
    DEFAULT_FILE_STORAGE='django.core.files.storage.FileSystemStorage',
    MEDIA_ROOT='/tmp/ilm_shamela_test_media',
)
class ReprocessEditionSurvivalTests(APITestCase):
    """Reprocessing wipes and rebuilds DocumentChunk rows; the Edition (and its
    hand-authored page_map) must survive untouched."""

    @patch('search_engine.tasks.build_embedding', return_value=[0.1] * 3072)
    @patch('search_engine.tasks.DocumentIndex')
    @patch('search_engine.tasks.parser.from_buffer')
    def test_edition_survives_reprocessing(self, mock_parser, mock_index, mock_embed):
        document = Document.objects.create(
            title='Reprocess Doc',
            file=SimpleUploadedFile(
                'reprocess.txt', b'file body', content_type='text/plain'),
        )
        edition = Edition.objects.create(
            document=document, editor='محقق', page_map=TWO_VOLUME_MAP)
        DocumentChunk.objects.create(
            document=document, chunk_index=0, page_number=1, content='stale chunk')

        mock_parser.return_value = {
            'content': 'fresh page one\ffresh page two',
            'metadata': {},
        }
        result = process_document_task.apply(args=[document.id]).get()

        self.assertEqual(result['status'], 'success')
        document.refresh_from_db()
        chunks = list(document.chunks.order_by('chunk_index'))
        self.assertEqual([c.content for c in chunks],
                         ['fresh page one', 'fresh page two'])
        edition.refresh_from_db()
        self.assertEqual(edition.editor, 'محقق')
        self.assertEqual(edition.page_map, TWO_VOLUME_MAP)
