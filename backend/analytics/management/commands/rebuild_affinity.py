"""Rebuild ``UserDocumentAffinity`` from durable source tables.

Bootstraps affinity (and thus recommendation signal) from data that predates
the event log: reading progress, bookmarks, notes, highlights, and per-book
assistant questions. Mirrors ``search_engine``'s ``rebuild_country_counts``.

Note: ``open_count`` and ``total_read_ms`` cannot be reconstructed historically
(no event log existed before this feature) — they start at 0 and accrue from
new events. ``pages_read`` / ``percent_complete`` are seeded from ReadingProgress.
"""
from collections import defaultdict

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from analytics.models import UserDocumentAffinity


class Command(BaseCommand):
    help = 'Recompute UserDocumentAffinity from bookmarks/notes/highlights/progress/chat.'

    @transaction.atomic
    def handle(self, *args, **options):
        from search_engine.models import (
            Bookmark, ChatMessage, Highlight, Note, ReadingProgress,
        )

        # (user_id, document_id) -> mutable counters
        agg = defaultdict(lambda: {
            'bookmark_count': 0, 'note_count': 0, 'highlight_count': 0,
            'assistant_query_count': 0, 'percent_complete': 0.0,
            'pages_read': 0, 'first': None, 'last': None,
        })

        def touch(key, when):
            if when is None:
                return
            rec = agg[key]
            if rec['first'] is None or when < rec['first']:
                rec['first'] = when
            if rec['last'] is None or when > rec['last']:
                rec['last'] = when

        for bm in Bookmark.objects.all().iterator():
            key = (bm.user_id, bm.document_id)
            agg[key]['bookmark_count'] += 1
            touch(key, bm.created_at)

        for nt in Note.objects.all().iterator():
            key = (nt.user_id, nt.document_id)
            agg[key]['note_count'] += 1
            touch(key, nt.created_at)

        for hl in Highlight.objects.all().iterator():
            key = (hl.user_id, hl.document_id)
            agg[key]['highlight_count'] += 1
            touch(key, hl.created_at)

        for rp in ReadingProgress.objects.all().iterator():
            key = (rp.user_id, rp.document_id)
            rec = agg[key]
            rec['percent_complete'] = max(
                rec['percent_complete'], min(1.0, rp.percent_complete or 0.0)
            )
            rec['pages_read'] = max(rec['pages_read'], rp.last_page or 0)
            touch(key, rp.updated_at)

        # Per-book assistant questions (role=user); library chat has no document.
        chat_qs = (
            ChatMessage.objects
            .filter(role='user')
            .select_related('session')
            .iterator()
        )
        for msg in chat_qs:
            sess = msg.session
            if sess is None or sess.document_id is None:
                continue
            key = (sess.user_id, sess.document_id)
            agg[key]['assistant_query_count'] += 1
            touch(key, msg.created_at)

        now = timezone.now()
        rows = []
        for (user_id, document_id), rec in agg.items():
            aff = UserDocumentAffinity(
                user_id=user_id,
                document_id=document_id,
                bookmark_count=rec['bookmark_count'],
                note_count=rec['note_count'],
                highlight_count=rec['highlight_count'],
                assistant_query_count=rec['assistant_query_count'],
                percent_complete=rec['percent_complete'],
                pages_read=rec['pages_read'],
                first_engaged_at=rec['first'] or now,
                last_engaged_at=rec['last'] or now,
            )
            aff.recompute_score()
            rows.append(aff)

        UserDocumentAffinity.objects.all().delete()
        UserDocumentAffinity.objects.bulk_create(rows, batch_size=500)
        self.stdout.write(self.style.SUCCESS(
            f'Rebuilt {len(rows)} affinity rows from durable source tables.'
        ))
