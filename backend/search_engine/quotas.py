"""Per-user daily reading quotas, backed by the default Django cache.

Uses only the portable cache API (``add``/``incr``/``get``) so the module
behaves identically on Redis in production and LocMemCache in tests:
``cache.add`` is an atomic SETNX on Redis and ``cache.incr`` is atomic there
too. Keys are day-stamped (UTC), so quota windows roll over at UTC midnight
regardless of TTL; the TTL only garbage-collects expired keys.

Concurrency: the pages counter increments *before* checking the limit, so
concurrent requests cannot sneak under it (worst case is a small overshoot
past the limit, which is harmless). The distinct-documents quota has a tiny
check-then-act window that can overshoot by one document — also acceptable.
"""
from dataclasses import dataclass
from datetime import timedelta
from typing import Optional

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

from .permissions import has_editor_privileges

# Longer than 24h so a key never expires before its own day-stamp rolls over.
KEY_TTL = 26 * 3600


@dataclass
class QuotaExceeded:
    quota: str  # 'documents' | 'pages'
    limit: int
    retry_after_seconds: int


def _day() -> str:
    return timezone.now().strftime('%Y%m%d')


def _seconds_until_utc_midnight() -> int:
    now = timezone.now()
    tomorrow = (now + timedelta(days=1)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    return max(1, int((tomorrow - now).total_seconds()))


def _is_exempt(user) -> bool:
    # Staff, superusers and the editor/admin groups read without quotas.
    return has_editor_privileges(user)


def check_and_count_document_open(user, doc_id) -> Optional[QuotaExceeded]:
    """Count a document against the user's daily distinct-documents quota.

    Re-opening a document already counted today is always free — even after
    the limit is reached — so a reader mid-book is never locked out.
    """
    limit = getattr(settings, 'READER_MAX_DOCS_PER_DAY', 0) or 0
    if not limit or _is_exempt(user):
        return None
    day = _day()
    member_key = f'quota:doc:{user.id}:{day}:{doc_id}'
    count_key = f'quota:docs:{user.id}:{day}'
    if cache.get(member_key):
        return None
    if (cache.get(count_key) or 0) >= limit:
        return QuotaExceeded('documents', limit, _seconds_until_utc_midnight())
    if cache.add(member_key, 1, KEY_TTL):  # atomic: one concurrent request wins
        cache.add(count_key, 0, KEY_TTL)  # ensure key exists so incr can't raise
        cache.incr(count_key)
    return None


def check_and_count_pages(user, n_pages: int) -> Optional[QuotaExceeded]:
    """Count ``n_pages`` against the user's daily page-fetch quota."""
    limit = getattr(settings, 'READER_MAX_PAGES_PER_DAY', 0) or 0
    if not limit or _is_exempt(user):
        return None
    count_key = f'quota:pages:{user.id}:{_day()}'
    cache.add(count_key, 0, KEY_TTL)
    total = cache.incr(count_key, n_pages)
    if total > limit:
        return QuotaExceeded('pages', limit, _seconds_until_utc_midnight())
    return None
