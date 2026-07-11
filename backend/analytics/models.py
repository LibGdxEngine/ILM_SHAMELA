"""User-behavior telemetry models.

Two layers power future document recommendations:

1. ``UserEvent`` — an append-only firehose. One row per behavioral signal
   (book opened, reading session, search, assistant question, bookmark, …).
   Raw rows are subject to a retention window (see ``manage.py purge_events``).

2. ``UserDocumentAffinity`` — a denormalized per-(user, document) aggregate,
   folded in by ``apply_event`` as events arrive. This is the
   "recommendation-ready" store a future recommender reads instead of scanning
   the raw log. Modeled on ``search_engine.CountryDocumentCount``: a
   signal-maintained aggregate with a management-command rebuild.
"""
import math

from django.conf import settings
from django.db import models
from django.utils import timezone


class EventType(models.TextChoices):
    """Every behavioral signal we capture. Values are stored verbatim."""
    DOCUMENT_OPEN = 'document_open', 'Document opened'
    READING_SESSION = 'reading_session', 'Reading session'
    SEARCH = 'search', 'Corpus search'
    SEARCH_ASSIST = 'search_assist', 'NL search assist'
    IN_DOC_SEARCH = 'in_doc_search', 'In-document search'
    SUGGESTION_SELECT = 'suggestion_select', 'Suggestion selected'
    ASSISTANT_QUERY = 'assistant_query', 'Assistant question'
    BOOKMARK_ADD = 'bookmark_add', 'Bookmark added'
    BOOKMARK_REMOVE = 'bookmark_remove', 'Bookmark removed'
    NOTE_ADD = 'note_add', 'Note added'
    HIGHLIGHT_ADD = 'highlight_add', 'Highlight added'
    FILTER_APPLY = 'filter_apply', 'Filter applied'
    PRESET_APPLY = 'preset_apply', 'Preset applied'


# Event types the ingest endpoint accepts from the browser. Everything else is
# server-derived (signals / view hooks) and MUST NOT be spoofable by a client
# POST — see analytics.serializers.EventIngestSerializer.
CLIENT_ALLOWED_EVENT_TYPES = frozenset({
    EventType.READING_SESSION,
    EventType.SUGGESTION_SELECT,
    EventType.FILTER_APPLY,
    EventType.PRESET_APPLY,
})


# Engagement-score weights. Tunable in one place so the score can be rebuilt
# with ``manage.py rebuild_affinity`` after any change.
SCORE_WEIGHTS = {
    'open': 1.0,
    'time': 2.0,          # applied to log1p(minutes read)
    # Deliberately tiny: raw page count is confounded by book length; use it
    # only as a minor tiebreaker. "How much of the book was read" is carried by
    # the length-normalized ``complete`` term below.
    'pages': 0.02,
    'in_doc_search': 0.5,
    'assistant': 1.5,
    'bookmark': 3.0,      # explicit intent signals weigh most
    'note': 3.0,
    'highlight': 2.0,
    'complete': 5.0,      # applied to percent_complete (0..1)
}


class UserEvent(models.Model):
    """Append-only behavioral event. See module docstring."""
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='events',
    )
    event_type = models.CharField(
        max_length=32, choices=EventType.choices, db_index=True
    )
    # SET_NULL (not CASCADE): keep the behavioral record even if the book is
    # later deleted; a null document just means "library-wide / doc removed".
    document = models.ForeignKey(
        'search_engine.Document',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='+',
    )
    session_id = models.CharField(
        max_length=64, blank=True, default='',
        help_text='Client browsing-session id (sessionization); blank for server events.',
    )
    source = models.CharField(max_length=16, blank=True, default='web')
    metadata = models.JSONField(
        default=dict, blank=True,
        help_text='Event payload: query text, mode, filters, duration_ms, result_count, …',
    )
    created_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        db_table = 'analytics_user_events'
        verbose_name = 'User Event'
        verbose_name_plural = 'User Events'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', '-created_at']),
            models.Index(fields=['document', 'event_type']),
            models.Index(fields=['event_type', '-created_at']),
        ]

    def __str__(self):
        return (
            f"UserEvent({self.event_type}, user={self.user_id}, "
            f"doc={self.document_id})"
        )


class UserDocumentAffinity(models.Model):
    """Denormalized per-(user, document) engagement aggregate.

    Kept in sync by ``apply_event`` (called from analytics signals / view
    hooks via ``analytics.services.record_event``). Rebuildable from durable
    source tables via ``manage.py rebuild_affinity``.
    """
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='document_affinities',
    )
    document = models.ForeignKey(
        'search_engine.Document',
        on_delete=models.CASCADE,
        related_name='user_affinities',
    )
    open_count = models.PositiveIntegerField(default=0)
    total_read_ms = models.BigIntegerField(default=0)
    pages_read = models.PositiveIntegerField(default=0)
    in_doc_search_count = models.PositiveIntegerField(default=0)
    assistant_query_count = models.PositiveIntegerField(default=0)
    bookmark_count = models.PositiveIntegerField(default=0)
    note_count = models.PositiveIntegerField(default=0)
    highlight_count = models.PositiveIntegerField(default=0)
    percent_complete = models.FloatField(default=0.0)
    engagement_score = models.FloatField(default=0.0, db_index=True)
    first_engaged_at = models.DateTimeField(null=True, blank=True)
    last_engaged_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'analytics_user_document_affinity'
        verbose_name = 'User-Document Affinity'
        verbose_name_plural = 'User-Document Affinities'
        unique_together = [['user', 'document']]
        indexes = [
            models.Index(fields=['user', '-engagement_score']),
            models.Index(fields=['user', '-last_engaged_at']),
        ]

    def __str__(self):
        return (
            f"Affinity(user={self.user_id}, doc={self.document_id}, "
            f"score={self.engagement_score:.1f})"
        )

    def recompute_score(self):
        """Recompute ``engagement_score`` from the current counters."""
        w = SCORE_WEIGHTS
        minutes = max(self.total_read_ms, 0) / 60000.0
        self.engagement_score = (
            w['open'] * self.open_count
            + w['time'] * math.log1p(minutes)
            + w['pages'] * self.pages_read
            + w['in_doc_search'] * self.in_doc_search_count
            + w['assistant'] * self.assistant_query_count
            + w['bookmark'] * self.bookmark_count
            + w['note'] * self.note_count
            + w['highlight'] * self.highlight_count
            + w['complete'] * max(0.0, min(1.0, self.percent_complete))
        )
        return self.engagement_score

    @classmethod
    def apply_event(cls, *, user_id, document_id, event_type, metadata=None, when=None):
        """Fold a single event into the (user, document) aggregate.

        No-op when there is no document: library-wide events (e.g. the
        library assistant) contribute to the firehose but not to per-document
        affinity. Counters are additive; ``pages_read`` / ``percent_complete``
        are max-merged so repeated reading-session reports stay idempotent.
        """
        if not document_id:
            return None
        metadata = metadata or {}
        when = when or timezone.now()

        aff, _ = cls.objects.get_or_create(
            user_id=user_id, document_id=document_id,
            defaults={'first_engaged_at': when},
        )

        et = event_type
        if et == EventType.DOCUMENT_OPEN:
            aff.open_count += 1
        elif et == EventType.READING_SESSION:
            aff.total_read_ms += int(metadata.get('duration_ms') or 0)
            pages = metadata.get('pages_read')
            if isinstance(pages, int) and pages > 0:
                aff.pages_read = max(aff.pages_read, pages)
            pct = metadata.get('percent_complete')
            if isinstance(pct, (int, float)):
                aff.percent_complete = max(aff.percent_complete, min(1.0, float(pct)))
        elif et == EventType.IN_DOC_SEARCH:
            aff.in_doc_search_count += 1
        elif et == EventType.ASSISTANT_QUERY:
            aff.assistant_query_count += 1
        elif et == EventType.BOOKMARK_ADD:
            aff.bookmark_count += 1
        elif et == EventType.BOOKMARK_REMOVE:
            aff.bookmark_count = max(0, aff.bookmark_count - 1)
        elif et == EventType.NOTE_ADD:
            aff.note_count += 1
        elif et == EventType.HIGHLIGHT_ADD:
            aff.highlight_count += 1
        # search / search_assist / suggestion_select / filter / preset are not
        # document-scoped engagement signals → firehose only, no counter here.

        if aff.first_engaged_at is None:
            aff.first_engaged_at = when
        aff.last_engaged_at = when
        aff.recompute_score()
        aff.save()
        return aff
