"""Typeahead endpoints over the canonical entity tables (consumed by the
search console's option-search panes, same page shape as the author/book
sources: ``{count, results: [...]}``) + the reader's page-mentions overlay
source."""
import hashlib

from django.db.models import Q
from rest_framework import permissions, serializers, status, views
from rest_framework.response import Response

from .extractors.textnorm import normalize
from .models import (DocumentStructuredExtraction, EntityMention,
                     EntityRelation, Person, Place, Work)

MAX_RESULTS = 20


class PersonOptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Person
        fields = ['id', 'display_name', 'death_year_hijri', 'death_century',
                  'mention_doc_count']


class PlaceOptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Place
        fields = ['id', 'name', 'modern_name', 'feature_type', 'mention_doc_count']


class WorkOptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Work
        fields = ['id', 'display_title', 'author_id', 'document_id',
                  'mention_doc_count']


class PersonTypeaheadView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        q = (request.query_params.get('q') or '').strip()
        queryset = Person.objects.exclude(review_status='rejected')
        if q:
            queryset = queryset.filter(
                Q(display_name__icontains=q)
                | Q(blocking_key__icontains=normalize(q))
                | Q(aliases__icontains=q)
            )
        queryset = queryset.order_by('-mention_doc_count', 'display_name')
        return Response({
            'count': queryset.count(),
            'results': PersonOptionSerializer(queryset[:MAX_RESULTS], many=True).data,
        })


class PageMentionsView(views.APIView):
    """``GET /api/extraction/documents/<doc_id>/pages/<page>/mentions/`` —
    active, non-rejected mentions of one page for the reader's entity-overlay
    layer. Offsets follow the repo's page-content char-offset contract (same
    as highlights); the response carries the page ``content_hash`` so the
    client drops spans when its rendered content no longer matches
    (reprocess drift)."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, doc_id: int, page: int):
        from search_engine.models import Document
        from search_engine.utils import split_document_content_into_pages

        try:
            document = Document.objects.get(id=doc_id)
        except Document.DoesNotExist:
            return Response({'error': 'document not found'},
                            status=status.HTTP_404_NOT_FOUND)

        page_content = next(
            (p['content'] for p in
             split_document_content_into_pages(document.content or '')
             if p['page_number'] == page),
            None,
        )
        content_hash = (
            hashlib.sha256(page_content.encode('utf-8')).hexdigest()
            if page_content is not None else ''
        )

        mentions = EntityMention.objects.filter(
            document=document, page_number=page, superseded_at__isnull=True,
        ).exclude(review_status=EntityMention.ReviewStatus.REJECTED).order_by(
            'char_start')
        return Response({
            'document_id': document.id,
            'page_number': page,
            'content_hash': content_hash,
            'mentions': [
                {
                    'id': m.id,
                    'entity_type': m.entity_type,
                    'char_start': m.char_start,
                    'char_end': m.char_end,
                    'surface_text': m.surface_text,
                    'normalized_text': m.normalized_text,
                    'normalized': m.normalized,
                    'person_id': m.person_id,
                    'place_id': m.place_id,
                    'work_id': m.work_id,
                    'confidence': m.confidence,
                    'content_hash': m.content_hash,
                }
                for m in mentions
            ],
        })


class PlaceTypeaheadView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        q = (request.query_params.get('q') or '').strip()
        queryset = Place.objects.all()
        if q:
            queryset = queryset.filter(
                Q(name__icontains=q)
                | Q(modern_name__icontains=q)
                | Q(names__normalized__istartswith=normalize(q))
            ).distinct()
        queryset = queryset.order_by('-mention_doc_count', 'name')
        return Response({
            'count': queryset.count(),
            'results': PlaceOptionSerializer(queryset[:MAX_RESULTS], many=True).data,
        })


class WorkTypeaheadView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        q = (request.query_params.get('q') or '').strip()
        queryset = Work.objects.exclude(review_status='rejected')
        if q:
            queryset = queryset.filter(
                Q(display_title__icontains=q)
                | Q(normalized_title__icontains=normalize(q))
                | Q(names__normalized__istartswith=normalize(q))
            ).distinct()
        queryset = queryset.order_by('-mention_doc_count', 'display_title')
        return Response({
            'count': queryset.count(),
            'results': WorkOptionSerializer(queryset[:MAX_RESULTS], many=True).data,
        })


class DocumentStructureView(views.APIView):
    """``GET /api/extraction/documents/<doc_id>/structure/`` — active,
    non-rejected document-level structured extractions keyed by kind."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, doc_id: int):
        from search_engine.models import Document

        if not Document.objects.filter(id=doc_id).exists():
            return Response({'error': 'document not found'},
                            status=status.HTTP_404_NOT_FOUND)

        rows = DocumentStructuredExtraction.objects.filter(
            document_id=doc_id, superseded_at__isnull=True,
        ).exclude(review_status=EntityMention.ReviewStatus.REJECTED)
        return Response({
            'document_id': doc_id,
            'structures': {
                row.kind: {
                    'payload': row.payload,
                    'page_refs': row.page_refs,
                    'confidence': row.confidence,
                    'model_id': row.model_id,
                }
                for row in rows
            },
        })


class DocumentRelationsView(views.APIView):
    """``GET /api/extraction/documents/<doc_id>/relations/?predicate=`` —
    active, non-rejected knowledge-graph edges with their evidence spans."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, doc_id: int):
        from search_engine.models import Document

        if not Document.objects.filter(id=doc_id).exists():
            return Response({'error': 'document not found'},
                            status=status.HTTP_404_NOT_FOUND)

        queryset = EntityRelation.objects.filter(
            document_id=doc_id, superseded_at__isnull=True,
        ).exclude(review_status=EntityMention.ReviewStatus.REJECTED)
        predicate = (request.query_params.get('predicate') or '').strip()
        if predicate:
            queryset = queryset.filter(predicate=predicate)
        queryset = queryset.order_by('page_number', 'char_start')
        return Response({
            'document_id': doc_id,
            'count': queryset.count(),
            'relations': [
                {
                    'id': r.id,
                    'predicate': r.predicate,
                    'subject': {
                        'mention_id': r.subject_mention_id,
                        'person_id': r.subject_person_id,
                        'text': r.subject_text,
                    },
                    'object': {
                        'mention_id': r.object_mention_id,
                        'person_id': r.object_person_id,
                        'place_id': r.object_place_id,
                        'work_id': r.object_work_id,
                        'text': r.object_text,
                    },
                    'qualifiers': r.qualifiers,
                    'page_number': r.page_number,
                    'char_start': r.char_start,
                    'char_end': r.char_end,
                    'evidence_text': r.evidence_text,
                    'confidence': r.confidence,
                }
                for r in queryset[:500]
            ],
        })
