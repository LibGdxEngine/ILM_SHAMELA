import re
from datetime import datetime, timezone

from django.db import IntegrityError
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import generics, permissions, renderers, serializers, status, views, viewsets
from rest_framework.response import Response

from .models import Bookmark, Chapter, Document, Highlight, Note, ReaderPreference, ReadingProgress
from .serializers_reader import (
    BookmarkSerializer,
    ChapterSerializer,
    ContinueReadingSerializer,
    HighlightSerializer,
    NoteSerializer,
    ReaderPreferenceSerializer,
    ReadingProgressSerializer,
)


class MarkdownRenderer(renderers.BaseRenderer):
    """Trivial renderer so DRF format negotiation accepts ?format=md."""
    media_type = 'text/markdown'
    format = 'md'
    charset = 'utf-8'

    def render(self, data, accepted_media_type=None, renderer_context=None):
        if isinstance(data, (bytes, bytearray)):
            return bytes(data)
        if isinstance(data, str):
            return data.encode(self.charset)
        return str(data).encode(self.charset)


class PdfPlaceholderRenderer(renderers.BaseRenderer):
    """Placeholder so DRF accepts ?format=pdf and our view can return 400."""
    media_type = 'application/pdf'
    format = 'pdf'
    charset = None

    def render(self, data, accepted_media_type=None, renderer_context=None):
        if isinstance(data, (bytes, bytearray)):
            return bytes(data)
        return str(data).encode('utf-8')


def _slugify(value: str) -> str:
    """Stdlib-only slug helper for the export filename."""
    value = (value or 'document').strip().lower()
    value = re.sub(r'[^a-z0-9\u0600-\u06ff]+', '-', value)
    value = value.strip('-')
    return value or 'document'


def _filter_by_document(queryset, request):
    document_id = request.query_params.get('document')
    if document_id:
        try:
            queryset = queryset.filter(document_id=int(document_id))
        except (TypeError, ValueError):
            queryset = queryset.none()
    return queryset


class DocumentChapterListView(generics.ListAPIView):
    """List top-level chapters (with nested children) for a document.

    Read-only for any authenticated user; chapters are public to the document
    audience and managed via admin / management commands.
    """
    serializer_class = ChapterSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        document = get_object_or_404(Document, pk=self.kwargs['pk'])
        return (
            Chapter.objects
            .filter(document=document, parent__isnull=True)
            .order_by('order')
        )


class ReaderPreferenceView(generics.RetrieveUpdateAPIView):
    """GET/PATCH the per-user reader preferences singleton."""
    serializer_class = ReaderPreferenceSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_object(self):
        obj, _ = ReaderPreference.objects.get_or_create(user=self.request.user)
        return obj


class BookmarkViewSet(viewsets.ModelViewSet):
    serializer_class = BookmarkSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        qs = Bookmark.objects.filter(user=self.request.user)
        return _filter_by_document(qs, self.request)

    def perform_create(self, serializer):
        try:
            serializer.save(user=self.request.user)
        except IntegrityError:
            raise serializers.ValidationError(
                {'page_number': 'A bookmark already exists for this page.'}
            )


class NoteViewSet(viewsets.ModelViewSet):
    serializer_class = NoteSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        qs = Note.objects.filter(user=self.request.user)
        return _filter_by_document(qs, self.request)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class HighlightViewSet(viewsets.ModelViewSet):
    serializer_class = HighlightSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        qs = Highlight.objects.filter(user=self.request.user)
        return _filter_by_document(qs, self.request)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class ReadingProgressUpsertView(views.APIView):
    """PATCH-only upsert for reading progress on a document."""
    permission_classes = [permissions.IsAuthenticated]
    throttle_scope = 'reader_progress'

    def patch(self, request, document_id):
        get_object_or_404(Document, pk=document_id)

        defaults = {}
        if 'last_page' in request.data:
            defaults['last_page'] = request.data['last_page']
        if 'last_paragraph_id' in request.data:
            defaults['last_paragraph_id'] = request.data['last_paragraph_id']
        if 'scroll_ratio' in request.data:
            defaults['scroll_ratio'] = request.data['scroll_ratio']
        if 'percent_complete' in request.data:
            defaults['percent_complete'] = request.data['percent_complete']

        if 'last_page' not in defaults:
            return Response(
                {'error': 'last_page is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        progress, _ = ReadingProgress.objects.update_or_create(
            user=request.user,
            document_id=document_id,
            defaults=defaults,
        )
        serializer = ReadingProgressSerializer(progress)
        return Response(serializer.data, status=status.HTTP_200_OK)


class ContinueReadingView(generics.ListAPIView):
    """GET most-recently-updated reading progress entries for the user."""
    serializer_class = ContinueReadingSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        try:
            limit = int(self.request.query_params.get('limit', 8))
        except (TypeError, ValueError):
            limit = 8
        limit = max(1, min(limit, 50))
        return (
            ReadingProgress.objects
            .filter(user=self.request.user)
            .select_related('document')
            .order_by('-updated_at')[:limit]
        )

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['request'] = self.request
        return context


class NoteExportView(views.APIView):
    """Export notes for a document as Markdown (PDF deferred)."""
    permission_classes = [permissions.IsAuthenticated]
    renderer_classes = [MarkdownRenderer, PdfPlaceholderRenderer, renderers.JSONRenderer]

    def get(self, request):
        export_format = request.query_params.get('format', 'md').lower()
        if export_format == 'pdf':
            return Response(
                {
                    'error': 'PDF export not yet available',
                    'supported_formats': ['md'],
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        if export_format != 'md':
            return Response(
                {
                    'error': f'Unsupported format "{export_format}".',
                    'supported_formats': ['md'],
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        document_id = request.query_params.get('document')
        if not document_id:
            return Response(
                {'error': 'Query parameter "document" is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            document_id_int = int(document_id)
        except (TypeError, ValueError):
            return Response(
                {'error': 'Query parameter "document" must be an integer.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        document = get_object_or_404(Document, pk=document_id_int)
        notes = (
            Note.objects
            .filter(user=request.user, document=document)
            .order_by('page_number', 'created_at')
        )

        exported_at = datetime.now(timezone.utc).isoformat()
        lines = [
            '---',
            f'title: {document.title}',
            f'exported_at: {exported_at}',
            '---',
            '',
        ]
        for note in notes:
            lines.append(f'## Page {note.page_number}')
            tags = [str(t) for t in (note.tags or [])]
            if tags:
                lines.append(f'*Tags: {", ".join(tags)}*')
            lines.append('')
            lines.append(note.body or '')
            lines.append('')
            lines.append('---')
            lines.append('')

        body = '\n'.join(lines)
        filename = f'{_slugify(document.title)}-notes.md'
        response = HttpResponse(body, content_type='text/markdown; charset=utf-8')
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        return response
