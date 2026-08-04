"""Extraction task tests: persistence, idempotency, supersession, orphaning."""
from django.test import TestCase

from extraction.models import EntityMention, ExtractionRun
from extraction.tasks import extract_document_task
from search_engine.models import Document

PAGE_1 = 'قال تعالى: ﴿الم﴾ [البقرة: ١] وهو حديث رواه البخاري (رقم ٥٢).'
PAGE_2 = 'توفي المؤلف سنة ٧٢٨ هـ رحمه الله.'


class ExtractTaskTests(TestCase):
    def setUp(self):
        self.document = Document.objects.create(
            title='كتاب الاختبار',
            file='documents/test.txt',
            content=f'{PAGE_1}\f{PAGE_2}',
            processed=True,
        )

    def _run(self, **kwargs):
        extract_document_task.run(self.document.id, **kwargs)

    def test_extracts_and_records_runs(self):
        self._run()
        keys = set(EntityMention.objects.filter(
            document=self.document, superseded_at__isnull=True,
        ).values_list('normalized_text', flat=True))
        self.assertIn('quran:2:1', keys)
        self.assertIn('bukhari:52', keys)
        self.assertIn('hijri:728', keys)
        runs = ExtractionRun.objects.filter(document=self.document)
        self.assertTrue(all(r.status == ExtractionRun.Status.SUCCEEDED for r in runs))
        # Mentions carry the page hash + page-local offsets.
        mention = EntityMention.objects.get(
            document=self.document, normalized_text='hijri:728')
        self.assertEqual(mention.page_number, 2)
        self.assertEqual(
            PAGE_2[mention.char_start:mention.char_end], mention.surface_text)
        self.assertTrue(mention.content_hash)

    def test_rerun_without_changes_is_noop(self):
        self._run()
        first_ids = set(EntityMention.objects.values_list('id', flat=True))
        self._run()  # same corpus hash → skip
        self.assertEqual(
            set(EntityMention.objects.values_list('id', flat=True)), first_ids)

    def test_force_rerun_replaces_same_version_rows(self):
        self._run()
        first_count = EntityMention.objects.filter(
            superseded_at__isnull=True).count()
        self._run(force=True)
        self.assertEqual(
            EntityMention.objects.filter(superseded_at__isnull=True).count(),
            first_count,
        )

    def test_reprocess_drift_reextracts_and_orphans_verified(self):
        self._run()
        verified = EntityMention.objects.get(normalized_text='bukhari:52')
        verified.human_verified = True
        verified.review_status = EntityMention.ReviewStatus.APPROVED
        verified.save(update_fields=['human_verified', 'review_status'])

        # Content shifts (reprocess drift): page 1 text changes.
        self.document.content = f'مقدمة جديدة. {PAGE_1}\f{PAGE_2}'
        self.document.save(update_fields=['content'])
        self._run()

        verified.refresh_from_db()
        self.assertEqual(
            verified.review_status, EntityMention.ReviewStatus.ORPHANED)
        # Fresh machine mentions exist at the new offsets.
        fresh = EntityMention.objects.filter(
            normalized_text='bukhari:52', superseded_at__isnull=True,
            human_verified=False,
        )
        self.assertTrue(fresh.exists())

    def test_selected_extractor_only(self):
        self._run(extractors=['quran'])
        types = set(EntityMention.objects.values_list('entity_type', flat=True))
        self.assertEqual(types, {'quran'})
