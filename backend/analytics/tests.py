"""Tests for behavioral capture: signals, ingest allowlist, affinity math,
and the recommender's fallback layers + endpoint."""
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from analytics.models import EventType, UserDocumentAffinity, UserEvent
from analytics.recommendations import build_recommendations
from search_engine.models import Author, Bookmark, Document, Note

User = get_user_model()


class SignalCaptureTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='sig', email='sig@example.com', password='x'
        )
        self.doc = Document.objects.create(title='Test Book')

    def test_bookmark_create_emits_event_and_affinity(self):
        with self.captureOnCommitCallbacks(execute=True):
            Bookmark.objects.create(user=self.user, document=self.doc, page_number=3)

        ev = UserEvent.objects.filter(
            event_type=EventType.BOOKMARK_ADD, user=self.user
        ).first()
        self.assertIsNotNone(ev)
        self.assertEqual(ev.document_id, self.doc.id)
        self.assertEqual(ev.metadata.get('page_number'), 3)

        aff = UserDocumentAffinity.objects.get(user=self.user, document=self.doc)
        self.assertEqual(aff.bookmark_count, 1)
        self.assertGreater(aff.engagement_score, 0.0)

    def test_bookmark_delete_emits_remove_and_decrements(self):
        with self.captureOnCommitCallbacks(execute=True):
            bm = Bookmark.objects.create(user=self.user, document=self.doc, page_number=3)
        with self.captureOnCommitCallbacks(execute=True):
            bm.delete()

        self.assertTrue(
            UserEvent.objects.filter(event_type=EventType.BOOKMARK_REMOVE).exists()
        )
        aff = UserDocumentAffinity.objects.get(user=self.user, document=self.doc)
        self.assertEqual(aff.bookmark_count, 0)

    def test_note_create_emits_event(self):
        with self.captureOnCommitCallbacks(execute=True):
            Note.objects.create(
                user=self.user, document=self.doc, page_number=1, body='hi'
            )
        self.assertTrue(
            UserEvent.objects.filter(event_type=EventType.NOTE_ADD).exists()
        )


class IngestEndpointTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='ing', email='ing@example.com', password='x'
        )
        self.doc = Document.objects.create(title='Test Book 2')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_reading_session_accepted_and_aggregated(self):
        with self.captureOnCommitCallbacks(execute=True):
            resp = self.client.post(
                '/api/analytics/events/',
                {
                    'event_type': 'reading_session',
                    'document_id': self.doc.id,
                    'metadata': {
                        'duration_ms': 120000,
                        'pages_read': 5,
                        'percent_complete': 0.5,
                    },
                },
                format='json',
            )
        self.assertEqual(resp.status_code, 202)
        self.assertEqual(resp.data['recorded'], 1)

        aff = UserDocumentAffinity.objects.get(user=self.user, document=self.doc)
        self.assertEqual(aff.total_read_ms, 120000)
        self.assertEqual(aff.pages_read, 5)
        self.assertAlmostEqual(aff.percent_complete, 0.5)

    def test_reading_session_durations_accumulate(self):
        for _ in range(2):
            with self.captureOnCommitCallbacks(execute=True):
                self.client.post(
                    '/api/analytics/events/',
                    {
                        'event_type': 'reading_session',
                        'document_id': self.doc.id,
                        'metadata': {'duration_ms': 30000, 'pages_read': 2},
                    },
                    format='json',
                )
        aff = UserDocumentAffinity.objects.get(user=self.user, document=self.doc)
        self.assertEqual(aff.total_read_ms, 60000)
        # pages_read is max-merged, not summed.
        self.assertEqual(aff.pages_read, 2)

    def test_server_only_event_type_rejected(self):
        resp = self.client.post(
            '/api/analytics/events/',
            {'event_type': 'search', 'metadata': {'q': 'x'}},
            format='json',
        )
        self.assertEqual(resp.status_code, 400)
        self.assertFalse(UserEvent.objects.filter(event_type='search').exists())

    def test_requires_authentication(self):
        anon = APIClient()
        resp = anon.post(
            '/api/analytics/events/',
            {'event_type': 'reading_session'},
            format='json',
        )
        self.assertIn(resp.status_code, (401, 403))


class AffinityScoreTests(TestCase):
    def test_score_increases_with_engagement(self):
        aff = UserDocumentAffinity(user_id=1, document_id=1)
        base = aff.recompute_score()
        self.assertEqual(base, 0.0)

        aff.bookmark_count = 2
        aff.total_read_ms = 600000  # 10 minutes
        higher = aff.recompute_score()
        self.assertGreater(higher, base)

    def test_apply_event_noop_without_document(self):
        # Library-wide events (document=None) contribute to the firehose only.
        result = UserDocumentAffinity.apply_event(
            user_id=1, document_id=None, event_type=EventType.ASSISTANT_QUERY
        )
        self.assertIsNone(result)
        self.assertEqual(UserDocumentAffinity.objects.count(), 0)


class RecommendationTests(TestCase):
    """Covers the pure-ORM recommender layers (popular / newest / weak-signal),
    engaged-exclusion, and the endpoint shape. The ES kNN personalized path is
    inert here because test documents carry empty semantic_vectors (centroid is
    None → no ES call), so these tests are hermetic."""

    def setUp(self):
        cache.clear()  # LocMemCache persists across tests; avoid stale recs
        self.u1 = User.objects.create_user('r1', 'r1@example.com', 'x')
        self.u2 = User.objects.create_user('r2', 'r2@example.com', 'x')
        self.client = APIClient()

    def _doc(self, title, processed=True):
        return Document.objects.create(title=title, processed=processed)

    def _affinity(self, user, doc, score):
        return UserDocumentAffinity.objects.create(
            user=user, document=doc, engagement_score=score
        )

    def test_popular_ranks_by_engagement_and_excludes_engaged(self):
        pop_hi = self._doc('Popular High')
        pop_lo = self._doc('Popular Low')
        engaged = self._doc('Already Read')
        self._affinity(self.u2, pop_hi, 50)   # other users drive popularity
        self._affinity(self.u2, pop_lo, 5)
        self._affinity(self.u1, engaged, 10)  # u1's own read → must be excluded

        recs = build_recommendations(self.u1, 12)
        ids = [r['document'].id for r in recs]

        self.assertIn(pop_hi.id, ids)
        self.assertIn(pop_lo.id, ids)
        self.assertNotIn(engaged.id, ids)
        self.assertLess(ids.index(pop_hi.id), ids.index(pop_lo.id))
        self.assertTrue(all(r['reason'] == 'popular' for r in recs))

    def test_newest_when_no_affinity_anywhere(self):
        d_old = self._doc('Old')
        d_new = self._doc('New')
        recs = build_recommendations(self.u1, 12)
        ids = {r['document'].id for r in recs}
        self.assertEqual(ids, {d_old.id, d_new.id})
        self.assertTrue(all(r['reason'] == 'newest' for r in recs))

    def test_weak_signal_recommends_by_favored_author(self):
        author = Author.objects.create(name='Ibn Kathir')
        read = self._doc('Tafsir vol 1')
        read.authors.add(author)
        more = self._doc('Tafsir vol 2')
        more.authors.add(author)
        self._doc('Unrelated')  # no shared author → not a candidate
        self._affinity(self.u1, read, 20)

        recs = build_recommendations(self.u1, 12)
        ids = [r['document'].id for r in recs]

        self.assertIn(more.id, ids)
        self.assertNotIn(read.id, ids)
        rec_more = next(r for r in recs if r['document'].id == more.id)
        self.assertEqual(rec_more['reason'], 'more_by_author')
        self.assertEqual(rec_more['reason_detail'], 'Ibn Kathir')

    def test_endpoint_returns_recommendation_shape(self):
        self._doc('Any Doc')
        self.client.force_authenticate(self.u1)
        resp = self.client.get('/api/analytics/recommendations/?limit=5')
        self.assertEqual(resp.status_code, 200)
        self.assertIsInstance(resp.data, list)
        self.assertTrue(resp.data)
        for key in ('id', 'title', 'reason', 'reason_detail', 'score'):
            self.assertIn(key, resp.data[0])

    def test_endpoint_requires_auth(self):
        resp = self.client.get('/api/analytics/recommendations/')
        self.assertIn(resp.status_code, (401, 403))
