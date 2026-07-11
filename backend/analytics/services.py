"""Single funnel for recording behavioral events.

Both server-side capture (signals / view hooks) and the client ingest endpoint
call ``record_event`` so there is exactly one place that writes a ``UserEvent``
and folds it into ``UserDocumentAffinity``. Every call is **best-effort**:
telemetry must never raise into a user-facing request.
"""
import datetime as _dt
import json
import logging

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from .models import UserDocumentAffinity, UserEvent

logger = logging.getLogger(__name__)

_MAX_METADATA_BYTES = 8192
_MAX_STRING_LEN = 2000


def _sanitize_metadata(metadata):
    """Bound stored metadata so a hostile/huge payload can't bloat the table."""
    if not isinstance(metadata, dict):
        return {}
    clipped = {}
    for key, value in metadata.items():
        if isinstance(value, str) and len(value) > _MAX_STRING_LEN:
            value = value[:_MAX_STRING_LEN]
        clipped[str(key)[:64]] = value
    try:
        if len(json.dumps(clipped, ensure_ascii=False, default=str).encode('utf-8')) <= _MAX_METADATA_BYTES:
            return clipped
    except (TypeError, ValueError):
        return {}
    # Too big even after clipping strings: keep only small scalars.
    return {
        k: v for k, v in clipped.items()
        if isinstance(v, (int, float, bool))
        or (isinstance(v, str) and len(v) <= 200)
    }


def record_event(*, user_id, event_type, document_id=None, metadata=None,
                 session_id='', source='web'):
    """Persist one event and update its (user, document) affinity. Best-effort.

    Returns the created ``UserEvent`` or ``None`` on any failure. Callers in the
    request path must not depend on the return value.
    """
    if not user_id or not event_type:
        return None
    metadata = _sanitize_metadata(metadata or {})
    try:
        event = UserEvent.objects.create(
            user_id=user_id,
            event_type=event_type,
            document_id=document_id,
            session_id=(session_id or '')[:64],
            source=(source or 'web')[:16],
            metadata=metadata,
        )
    except Exception:  # noqa: BLE001 — telemetry must never break the request
        logger.exception('[analytics] failed to record event %s', event_type)
        return None

    # Fold into the aggregate after the surrounding transaction commits so the
    # request path pays only for the cheap insert above. When there is no open
    # transaction, Django runs the callback immediately.
    def _apply():
        try:
            UserDocumentAffinity.apply_event(
                user_id=user_id,
                document_id=document_id,
                event_type=event_type,
                metadata=metadata,
                when=event.created_at,
            )
        except Exception:  # noqa: BLE001
            logger.exception('[analytics] failed to update affinity for %s', event_type)

    transaction.on_commit(_apply)
    return event


def purge_expired_events(days=None):
    """Delete ``UserEvent`` rows older than the retention window.

    Aggregates (``UserDocumentAffinity``) are retained. Returns the number of
    rows deleted.
    """
    if days is None:
        days = getattr(settings, 'ANALYTICS_EVENT_RETENTION_DAYS', 180)
    cutoff = timezone.now() - _dt.timedelta(days=days)
    deleted, _ = UserEvent.objects.filter(created_at__lt=cutoff).delete()
    return deleted
