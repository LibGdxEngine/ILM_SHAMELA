from rest_framework import serializers

from search_engine.serializers import DocumentListSerializer

from .models import CLIENT_ALLOWED_EVENT_TYPES, EventType


class EventIngestSerializer(serializers.Serializer):
    """Validates a single client-submitted event.

    Only client-allowlisted event types are accepted; server-derived types
    (``search``, ``assistant_query``, ``bookmark_*``, …) are captured
    server-side and cannot be spoofed from the browser.
    """
    event_type = serializers.ChoiceField(choices=EventType.choices)
    document_id = serializers.IntegerField(required=False, allow_null=True)
    session_id = serializers.CharField(
        required=False, allow_blank=True, max_length=64, default=''
    )
    source = serializers.CharField(
        required=False, allow_blank=True, max_length=16, default='web'
    )
    metadata = serializers.DictField(required=False, default=dict)

    def validate_event_type(self, value):
        if value not in CLIENT_ALLOWED_EVENT_TYPES:
            raise serializers.ValidationError(
                'This event type cannot be submitted from the client.'
            )
        return value


class RecommendationSerializer(DocumentListSerializer):
    """A recommended document card: the standard document list shape plus the
    recommendation's ``reason``/``reason_detail``/``score``.

    ``reason`` etc. are per-(user, document) — not model fields — so the view
    attaches them to each Document instance as ``_rec_*`` before serializing
    (the same attach-then-serialize trick DocumentSearchView uses for search
    metadata).
    """
    reason = serializers.SerializerMethodField()
    reason_detail = serializers.SerializerMethodField()
    score = serializers.SerializerMethodField()

    class Meta(DocumentListSerializer.Meta):
        fields = DocumentListSerializer.Meta.fields + ['reason', 'reason_detail', 'score']

    def get_reason(self, obj):
        return getattr(obj, '_rec_reason', 'for_you')

    def get_reason_detail(self, obj):
        return getattr(obj, '_rec_detail', None)

    def get_score(self, obj):
        return getattr(obj, '_rec_score', 0.0)
