"""Server-side behavioral capture via Django signals on ``search_engine`` models.

Mirrors ``search_engine/signals.py``: receivers are registered by string sender
refs and kept side-effect-only. Each funnels through
``analytics.services.record_event`` (itself best-effort). The only place a
receiver touches the DB outside ``record_event`` is the chat-session FK lookup,
which is guarded so a telemetry failure can never propagate into the user's write.
"""
import logging

from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from .models import EventType
from .services import record_event

logger = logging.getLogger(__name__)


# ── Bookmarks ────────────────────────────────────────────────────
@receiver(post_save, sender='search_engine.Bookmark')
def bookmark_saved(sender, instance, created, **kwargs):
    if not created:
        return
    record_event(
        user_id=instance.user_id,
        event_type=EventType.BOOKMARK_ADD,
        document_id=instance.document_id,
        metadata={'page_number': instance.page_number},
        source='reader',
    )


@receiver(post_delete, sender='search_engine.Bookmark')
def bookmark_deleted(sender, instance, **kwargs):
    record_event(
        user_id=instance.user_id,
        event_type=EventType.BOOKMARK_REMOVE,
        document_id=instance.document_id,
        metadata={'page_number': instance.page_number},
        source='reader',
    )


# ── Notes ────────────────────────────────────────────────────────
@receiver(post_save, sender='search_engine.Note')
def note_saved(sender, instance, created, **kwargs):
    if not created:
        return
    record_event(
        user_id=instance.user_id,
        event_type=EventType.NOTE_ADD,
        document_id=instance.document_id,
        metadata={'page_number': instance.page_number},
        source='reader',
    )


# ── Highlights ───────────────────────────────────────────────────
@receiver(post_save, sender='search_engine.Highlight')
def highlight_saved(sender, instance, created, **kwargs):
    if not created:
        return
    record_event(
        user_id=instance.user_id,
        event_type=EventType.HIGHLIGHT_ADD,
        document_id=instance.document_id,
        metadata={'page_number': instance.page_number, 'color': instance.color},
        source='reader',
    )


# ── Assistant questions (per-book) ───────────────────────────────
@receiver(post_save, sender='search_engine.ChatMessage')
def chat_message_saved(sender, instance, created, **kwargs):
    """A user turn in a per-book chat → ``assistant_query`` event."""
    if not created or instance.role != 'user':
        return
    try:
        user_id = instance.session.user_id
        document_id = instance.session.document_id
    except Exception:  # noqa: BLE001 — never break the chat write
        logger.exception('[analytics] chat session lookup failed')
        return
    record_event(
        user_id=user_id,
        event_type=EventType.ASSISTANT_QUERY,
        document_id=document_id,
        metadata={
            'scope': 'reader',
            'content': instance.content,
            'context_page': instance.context_page,
        },
        source='reader',
    )


# ── Assistant questions (library-wide, document-less) ────────────
@receiver(post_save, sender='search_engine.LibraryChatMessage')
def library_chat_message_saved(sender, instance, created, **kwargs):
    """A user turn in the library assistant → ``assistant_query`` event (no doc)."""
    if not created or instance.role != 'user':
        return
    try:
        user_id = instance.session.user_id
    except Exception:  # noqa: BLE001
        logger.exception('[analytics] library chat session lookup failed')
        return
    record_event(
        user_id=user_id,
        event_type=EventType.ASSISTANT_QUERY,
        document_id=None,
        metadata={'scope': 'library', 'content': instance.content},
        source='library',
    )
