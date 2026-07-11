"""Celery tasks for analytics housekeeping.

Celery is already configured for this project (see ``search_engine/tasks.py``).
Wire ``purge_old_events`` into a Celery beat schedule, or run the equivalent
``manage.py purge_events`` from cron, to enforce the retention window.
"""
import logging

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task
def purge_old_events(days=None):
    """Delete ``UserEvent`` rows older than the retention window. Aggregates kept."""
    from .services import purge_expired_events

    deleted = purge_expired_events(days=days)
    logger.info('[analytics] purged %s expired events', deleted)
    return deleted
