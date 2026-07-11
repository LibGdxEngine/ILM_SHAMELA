"""Analytics ingest endpoint.

Client-side telemetry the server can't observe (reading-time/dwell, suggestion
selects, filter usage) is POSTed here. Server-derived events (searches,
assistant questions, bookmarks/notes/highlights) are captured via signals and
view hooks — not here — and are rejected by the serializer's allowlist.
"""
import logging

from django.core.cache import cache
from rest_framework import permissions, status, views
from rest_framework.response import Response

from search_engine.models import Document

from .recommendations import build_recommendations
from .serializers import EventIngestSerializer, RecommendationSerializer
from .services import record_event

logger = logging.getLogger(__name__)

_MAX_BATCH = 50
_RECS_CACHE_TTL = 300  # seconds


class EventIngestView(views.APIView):
    """POST one event ``{event_type, …}`` or a batch ``{"events": [ … ]}``."""
    permission_classes = [permissions.IsAuthenticated]
    throttle_scope = 'analytics_ingest'

    def post(self, request):
        payload = request.data
        if isinstance(payload, dict) and 'events' in payload:
            raw_events = payload.get('events')
        else:
            raw_events = [payload]

        if not isinstance(raw_events, list):
            return Response(
                {'detail': 'events must be a list'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        raw_events = raw_events[:_MAX_BATCH]

        serializer = EventIngestSerializer(data=raw_events, many=True)
        serializer.is_valid(raise_exception=True)

        recorded = 0
        for item in serializer.validated_data:
            event = record_event(
                user_id=request.user.id,
                event_type=item['event_type'],
                document_id=item.get('document_id'),
                metadata=item.get('metadata') or {},
                session_id=item.get('session_id') or '',
                source=item.get('source') or 'web',
            )
            if event is not None:
                recorded += 1

        return Response({'recorded': recorded}, status=status.HTTP_202_ACCEPTED)


class RecommendationsView(views.APIView):
    """GET a personalized "Recommended for you" list of documents.

    Reads ``UserDocumentAffinity`` → ranks unseen documents (see
    ``analytics.recommendations``). The ranked *id list* is cached per user
    (not the serialized payload) so per-request absolute media URLs stay
    correct and only the expensive centroid/kNN/re-rank step is memoized.
    """
    permission_classes = [permissions.IsAuthenticated]
    throttle_scope = 'recommendations'

    def get(self, request):
        try:
            limit = int(request.query_params.get('limit', 12))
        except (TypeError, ValueError):
            limit = 12
        limit = max(1, min(limit, 50))

        cache_key = f'recs_v1_user_{request.user.id}_{limit}'
        try:
            cached = cache.get(cache_key)
        except Exception:  # noqa: BLE001
            cached = None

        if cached is None:
            try:
                recs = build_recommendations(request.user, limit)
            except Exception:  # noqa: BLE001 — the shelf must never 500 the page
                logger.exception('[recs] build failed')
                recs = []
            cached = [
                (r['document'].id, r['reason'], r.get('reason_detail'), r.get('score', 0.0))
                for r in recs
            ]
            try:
                cache.set(cache_key, cached, _RECS_CACHE_TTL)
            except Exception:  # noqa: BLE001
                pass

        # Rehydrate documents in the cached rank order, attach reason/score.
        doc_ids = [row[0] for row in cached]
        docs_by_id = {
            d.id: d for d in Document.objects
            .filter(id__in=doc_ids)
            .prefetch_related('authors', 'categories')
        }
        ordered = []
        for doc_id, reason, detail, score in cached:
            doc = docs_by_id.get(doc_id)
            if doc is None:
                continue
            doc._rec_reason = reason
            doc._rec_detail = detail
            doc._rec_score = score
            ordered.append(doc)

        data = RecommendationSerializer(
            ordered, many=True, context={'request': request}
        ).data
        return Response(data)
