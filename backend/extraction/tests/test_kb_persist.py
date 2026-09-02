"""Projection of KB pipeline output into the extraction_kb_* tables.

No network: fixtures are hand-built pydantic objects written to a temporary
KB_DATA_DIR exactly as run_stage2 writes them, plus the mocked-transport task
harness from test_kb_tasks.
"""
import json
from contextlib import contextmanager
from io import StringIO
from unittest import mock

import tempfile
from django.core.management import call_command
from django.db import IntegrityError, transaction
from django.test import SimpleTestCase, TestCase, override_settings

from extraction.kb import config as kb_config
from extraction.kb import choices as kb_choices
from extraction.kb import extract as kb_extract
from extraction.kb import io_utils, mapping, persist, split
from extraction.kb.normalize import normalize_document
from extraction.kb.schema import (
    AbsoluteTime,
    AppraisalPolarity,
    AppraisalRank,
    AppraisalScope,
    AppraisalScopeKind,
    ClaimPredicate,
    DocumentExtraction,
    HijriDate,
    HijriRange,
    MentionAppraisal,
    MentionClaim,
    MentionRelation,
    NameComponents,
    PersonMention,
    PlaceMention,
    QuotationMention,
    QuotationType,
    QuranRef,
    RelationType,
    Segment,
    SegmentDetector,
    SegmentType,
    SegmentedDocument,
    TextSpan,
    TimeMention,
    TimeRange,
    WorkMention,
    WorkSubtype,
)
from extraction.models import (
    EntityMention,
    ExtractionRun,
    KbMention,
    KbMentionAppraisal,
    KbMentionClaim,
    KbMentionRelation,
)
from search_engine.models import Document
from search_engine.utils import split_document_content_into_pages

# 'أحمد  بن حنبل' carries a double space the normalizer collapses but the raw
# page keeps — the case that breaks naive page-offset arithmetic.
PAGE_1 = ('ترجمة الشافعي رحمه الله وكتابه الرسالة.\n'
          'قال تعالى الله لا إله إلا هو الحي القيوم.\n'
          'توفي الشافعي بمصر سنة أربع ومائتين.')
PAGE_2 = 'قال أحمد  بن حنبل: الشافعي ثقة ثبت.'


@contextmanager
def _kb_tmpdir():
    with tempfile.TemporaryDirectory() as tmp:
        with override_settings(KB_DATA_DIR=tmp):
            yield tmp


def _make_document(content=None):
    return Document.objects.create(
        title='كتاب الاختبار', file='documents/test.txt',
        content=content if content is not None else f'{PAGE_1}\f{PAGE_2}',
        processed=True, ocr_engine_used='tesseract')


class _Fixture:
    """A realistic two-page extraction, built through the pipeline's own
    provenance helper so page numbers and segment ids are derived, not asserted.
    """

    def __init__(self, document):
        self.document = document
        self.book_id = kb_config.book_id_for(document)
        self.ndoc = normalize_document(document)
        text = self.ndoc.text
        page2 = self.ndoc.page_offsets[1]

        self.seg1 = Segment(
            book_id=self.book_id, segment_type=SegmentType.BIOGRAPHY,
            span=TextSpan(start=0, end=page2), order=0,
            detector=SegmentDetector.MODEL, confidence=0.9)
        self.seg2 = Segment(
            book_id=self.book_id, segment_type=SegmentType.HADITH_REPORT,
            span=TextSpan(start=page2, end=len(text)), order=1,
            detector=SegmentDetector.FORMULA, confidence=0.7)
        self.sdoc = SegmentedDocument(
            book_id=self.book_id, text_length=len(text),
            segments=[self.seg1, self.seg2])
        self._segs = [self.seg1, self.seg2]

        self.shafii = self.mention(PersonMention, 'الشافعي',
                                   name_components=NameComponents(
                                       kunya='أبو عبد الله', ism='محمد',
                                       nasab=['إدريس'], nisba=['الشافعي'],
                                       shuhra='الشافعي'))
        self.work = self.mention(WorkMention, 'الرسالة', subtype=WorkSubtype.BOOK)
        self.ayah = self.mention(
            QuotationMention, 'الله لا إله إلا هو الحي القيوم',
            quote_type=QuotationType.QURAN,
            canonical_ref=QuranRef(sura=2, aya_start=255))
        self.misr = self.mention(PlaceMention, 'مصر')
        self.year = self.mention(TimeMention, 'سنة أربع ومائتين',
                                 parsed=AbsoluteTime(date=HijriDate(year=204)))
        self.ahmad = self.mention(PersonMention, 'أحمد بن حنبل')
        self.verdict = self.mention(QuotationMention, 'الشافعي ثقة ثبت',
                                    quote_type=QuotationType.ATHAR,
                                    speaker_mention_id=self.ahmad.id)

        self.mentions = [self.shafii, self.work, self.ayah, self.misr,
                         self.year, self.ahmad, self.verdict]
        self.relation = MentionRelation(
            relation_type=RelationType.DIED_IN,
            subject_mention_id=self.shafii.id, object_mention_id=self.misr.id,
            time_mention_id=self.year.id, trigger='توفي',
            provenance=self._prov(mapping._enclosing_span(self.shafii, self.misr)))
        self.claim = MentionClaim(
            predicate=ClaimPredicate.DEATH_DATE,
            subject_mention_id=self.shafii.id, time_mention_id=self.year.id,
            provenance=self._prov(mapping._enclosing_span(self.shafii, self.year)))
        self.appraisal = MentionAppraisal(
            critic_mention_id=self.ahmad.id, subject_mention_id=self.shafii.id,
            quotation_mention_id=self.verdict.id, verbatim='ثقة ثبت',
            polarity=AppraisalPolarity.TADIL, rank=AppraisalRank.THIQA,
            scope=AppraisalScope(kind=AppraisalScopeKind.GENERAL),
            provenance=self._prov(
                mapping._enclosing_span(self.ahmad, self.shafii)))

    def _segment_id(self, offset):
        return next((s.id for s in self._segs
                     if s.span.start <= offset < s.span.end), None)

    def _prov(self, span):
        return mapping.make_provenance(self.ndoc, self.book_id, span,
                                       self._segment_id(span.start))

    def span_of(self, needle, start_at=0):
        i = self.ndoc.text.index(needle, start_at)
        return TextSpan(start=i, end=i + len(needle))

    def mention(self, cls, needle, start_at=0, **kwargs):
        span = self.span_of(needle, start_at)
        return cls(surface_form=self.ndoc.text[span.start:span.end],
                   provenance=self._prov(span), **kwargs)

    def extraction(self, extra_mentions=(), extra_relations=()):
        return DocumentExtraction(
            book_id=self.book_id,
            mentions=list(self.mentions) + list(extra_mentions),
            relations=[self.relation] + list(extra_relations),
            claims=[self.claim], appraisals=[self.appraisal])

    def write_files(self, ext=None, complete=True, disk_format=2):
        """Write segments.json / extraction.json / extraction_meta.json exactly
        as run_stage2 does."""
        ext = ext if ext is not None else self.extraction()
        split.save_segments(self.book_id, self.ndoc, self.sdoc, {'total': 2},
                            document_id=self.document.pk)
        outdir = kb_config.output_dir(self.book_id)
        io_utils.atomic_write_text(
            outdir / 'extraction.json',
            json.dumps(mapping.prune_extraction(ext), ensure_ascii=False))
        io_utils.atomic_write_text(outdir / 'extraction_meta.json', json.dumps({
            'book_id': self.book_id, 'document_id': self.document.pk,
            'complete': complete, 'ocr_source': self.ndoc.ocr_source,
            'norm_sha256': split.norm_sha256(self.ndoc),
            'disk_format': disk_format,
        }))
        return ext


def _collapse(s):
    return ' '.join((s or '').split())


class PersistDocumentTests(TestCase):
    def setUp(self):
        self.document = _make_document()

    def test_writes_all_four_tables_with_segment_type(self):
        with _kb_tmpdir():
            fx = _Fixture(self.document)
            fx.write_files()
            result = persist.persist_document(self.document)

        self.assertFalse(result.skipped)
        self.assertEqual(KbMention.objects.count(), 7)
        self.assertEqual(KbMentionRelation.objects.count(), 1)
        self.assertEqual(KbMentionClaim.objects.count(), 1)
        self.assertEqual(KbMentionAppraisal.objects.count(), 1)

        # segment_type is denormalized from segments.json — the structural layer
        # stays queryable without a segments table.
        self.assertEqual(
            KbMention.objects.get(surface_form='مصر').segment_type, 'biography')
        self.assertEqual(
            KbMention.objects.get(surface_form='أحمد بن حنبل').segment_type,
            'hadith_report')
        self.assertFalse(KbMention.objects.filter(segment_type='').exists())
        self.assertTrue(
            all(m.segment_source_id for m in KbMention.objects.all()))

        run = ExtractionRun.objects.get(
            document=self.document, extractor_name=kb_config.KB_EXTRACTOR_NAME)
        self.assertTrue(run.persisted_hash)
        self.assertIsNotNone(run.persisted_at)

    def test_mention_fk_graph_is_resolved(self):
        with _kb_tmpdir():
            _Fixture(self.document).write_files()
            persist.persist_document(self.document)

        rel = KbMentionRelation.objects.get()
        self.assertEqual(rel.relation_type, 'died_in')
        self.assertEqual(rel.subject_mention.surface_form, 'الشافعي')
        self.assertEqual(rel.object_mention.surface_form, 'مصر')
        self.assertEqual(rel.time_mention.hijri_year, 204)
        self.assertIsNone(rel.place_mention)
        self.assertEqual(rel.trigger, 'توفي')

        claim = KbMentionClaim.objects.get()
        self.assertEqual(claim.subject_mention_id, rel.subject_mention_id)
        self.assertEqual(claim.time_mention_id, rel.time_mention_id)

        appr = KbMentionAppraisal.objects.get()
        self.assertEqual(appr.critic_mention.surface_form, 'أحمد بن حنبل')
        self.assertEqual(appr.subject_mention.surface_form, 'الشافعي')
        self.assertEqual(appr.quotation_mention.quote_type, 'athar')
        self.assertIsNone(appr.scope_target_mention)   # general scope

        verdict = KbMention.objects.get(quote_type='athar')
        self.assertEqual(verdict.speaker_mention.surface_form, 'أحمد بن حنبل')

    def test_absolute_spans_round_trip(self):
        with _kb_tmpdir():
            fx = _Fixture(self.document)
            fx.write_files()
            persist.persist_document(self.document)
            text = fx.ndoc.text

        for m in KbMention.objects.all():
            self.assertEqual(text[m.doc_char_start:m.doc_char_end], m.surface_form)
        rel = KbMentionRelation.objects.get()
        self.assertEqual(text[rel.doc_char_start:rel.doc_char_end],
                         rel.evidence_text)

    def test_page_spans_round_trip_against_raw_page_content(self):
        """The invariant that catches naive `doc_char_start - page_offset`
        arithmetic: page offsets must index RAW page content, not the
        normalized text."""
        with _kb_tmpdir():
            _Fixture(self.document).write_files()
            persist.persist_document(self.document)

        pages = {p['page_number']: p['content']
                 for p in split_document_content_into_pages(self.document.content)}
        checked = 0
        for m in KbMention.objects.exclude(page_char_start=None):
            raw = pages[m.page_number][m.page_char_start:m.page_char_end]
            # Whitespace-collapsed comparison: the normalizer collapses runs the
            # raw page keeps, so the shadow-matched span can be a character
            # longer. Everything else must line up exactly.
            self.assertEqual(_collapse(raw), _collapse(m.surface_form))
            checked += 1
        self.assertEqual(checked, 7)
        self.assertEqual(KbMention.objects.filter(page_char_start=None).count(), 0)

    def test_page_span_survives_whitespace_collapse(self):
        with _kb_tmpdir():
            _Fixture(self.document).write_files()
            persist.persist_document(self.document)

        ahmad = KbMention.objects.get(surface_form='أحمد بن حنبل')
        self.assertEqual(ahmad.page_number, 2)
        self.assertIsNotNone(ahmad.page_char_start)
        pages = {p['page_number']: p['content']
                 for p in split_document_content_into_pages(self.document.content)}
        raw = pages[2][ahmad.page_char_start:ahmad.page_char_end]
        self.assertIn('  ', raw)                       # the raw double space
        self.assertEqual(_collapse(raw), 'أحمد بن حنبل')

    def test_page_span_is_null_when_unlocatable(self):
        pages = split_document_content_into_pages(self.document.content)
        resolver = persist._PageSpanResolver(pages)
        self.assertIsNone(resolver.locate(1, 'نص غير موجود بتاتا', 1))
        self.assertIsNone(resolver.locate(99, 'الشافعي', 1))
        self.assertIsNotNone(resolver.locate(1, 'الشافعي', 1))

    def test_duplicate_spans_deduped_and_assertions_remapped(self):
        """Two mentions at identical offsets are legal in DocumentExtraction but
        violate kb_mention_unique_per_version. The loser must be aliased onto
        the survivor so a relation pointing at it is not silently dropped."""
        with _kb_tmpdir():
            fx = _Fixture(self.document)
            twin = fx.mention(PlaceMention, 'مصر')      # same span as fx.misr
            self.assertNotEqual(twin.id, fx.misr.id)
            extra = MentionRelation(
                relation_type=RelationType.BURIED_IN,
                subject_mention_id=fx.shafii.id,
                object_mention_id=twin.id,               # points at the loser
                provenance=fx._prov(
                    mapping._enclosing_span(fx.shafii, twin)))
            ext = fx.extraction(extra_mentions=[twin], extra_relations=[extra])
            fx.write_files(ext=ext)
            result = persist.persist_document(self.document)

        self.assertEqual(result.mentions_deduped, 1)
        self.assertEqual(KbMention.objects.filter(surface_form='مصر').count(), 1)
        survivor = KbMention.objects.get(surface_form='مصر')
        buried = KbMentionRelation.objects.get(relation_type='buried_in')
        self.assertEqual(buried.object_mention_id, survivor.pk)

    def test_self_loop_after_dedupe_is_dropped(self):
        with _kb_tmpdir():
            fx = _Fixture(self.document)
            twin = fx.mention(PlaceMention, 'مصر')
            loop = MentionRelation(
                relation_type=RelationType.PART_OF,
                subject_mention_id=fx.misr.id, object_mention_id=twin.id,
                provenance=fx._prov(fx.span_of('مصر')))
            ext = fx.extraction(extra_mentions=[twin], extra_relations=[loop])
            fx.write_files(ext=ext)
            result = persist.persist_document(self.document)

        self.assertEqual(result.assertions_dropped, 1)
        self.assertFalse(
            KbMentionRelation.objects.filter(relation_type='part_of').exists())

    def test_hijri_denormalization(self):
        with _kb_tmpdir():
            fx = _Fixture(self.document)
            ranged = fx.mention(
                TimeMention, 'أربع ومائتين',
                parsed=TimeRange(range=HijriRange(
                    earliest=HijriDate(year=200, approximate=True),
                    latest=HijriDate(year=210))))
            fx.write_files(ext=fx.extraction(extra_mentions=[ranged]))
            persist.persist_document(self.document)

        absolute = KbMention.objects.get(surface_form='سنة أربع ومائتين')
        self.assertEqual((absolute.time_kind, absolute.hijri_year,
                          absolute.hijri_year_to, absolute.hijri_approximate),
                         ('absolute', 204, None, False))
        rng = KbMention.objects.get(surface_form='أربع ومائتين')
        self.assertEqual((rng.time_kind, rng.hijri_year, rng.hijri_year_to,
                          rng.hijri_approximate), ('range', 200, 210, True))
        # The claim copies its time mention's year so "every death date" is one
        # indexed query rather than a join plus a JSON dig.
        self.assertEqual(KbMentionClaim.objects.get().hijri_year, 204)

    def test_ref_key_and_subtype_derivation(self):
        with _kb_tmpdir():
            _Fixture(self.document).write_files()
            persist.persist_document(self.document)

        ayah = KbMention.objects.get(quote_type='quran')
        self.assertEqual(ayah.ref_key, 'quran:2:255')
        self.assertEqual(ayah.canonical_ref['sura'], 2)
        # A one-aya range must key the same as a bare reference, or one verse
        # ends up split across two grouping keys.
        self.assertEqual(persist._ref_key(QuranRef(sura=4, aya_start=101,
                                                   aya_end=101)),
                         'quran:4:101')
        self.assertEqual(persist._ref_key(QuranRef(sura=2, aya_start=1,
                                                   aya_end=5)),
                         'quran:2:1-5')
        work = KbMention.objects.get(label='work')
        self.assertEqual(work.subtype, 'book')
        person = KbMention.objects.get(surface_form='الشافعي')
        self.assertEqual(person.subtype, '')
        self.assertEqual(person.name_components['nasab'], ['إدريس'])

    def test_appraisal_rank_level_and_db_constraint(self):
        with _kb_tmpdir():
            _Fixture(self.document).write_files()
            persist.persist_document(self.document)

        appr = KbMentionAppraisal.objects.get()
        self.assertEqual(appr.rank, 'thiqa')
        self.assertEqual(appr.rank_level, 3)
        self.assertEqual(appr.polarity, 'tadil')
        # A jarh level filed as tadil must be impossible at the DB level.
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                KbMentionAppraisal.objects.filter(pk=appr.pk).update(
                    polarity='tadil', rank_level=10)

    def test_second_persist_is_skipped(self):
        with _kb_tmpdir():
            _Fixture(self.document).write_files()
            persist.persist_document(self.document)
            created = KbMention.objects.earliest('id').created_at
            result = persist.persist_document(self.document)

        self.assertTrue(result.skipped)
        self.assertEqual(result.reason, 'up to date')
        self.assertEqual(KbMention.objects.count(), 7)
        self.assertEqual(KbMention.objects.earliest('id').created_at, created)

    def test_force_reprojects_idempotently(self):
        with _kb_tmpdir():
            _Fixture(self.document).write_files()
            persist.persist_document(self.document)
            persist.persist_document(self.document, force=True)
            result = persist.persist_document(self.document, force=True)

        self.assertFalse(result.skipped)
        self.assertEqual(KbMention.objects.count(), 7)
        self.assertEqual(KbMentionRelation.objects.count(), 1)
        self.assertEqual(KbMentionAppraisal.objects.count(), 1)

    def test_incomplete_extraction_is_not_persisted(self):
        with _kb_tmpdir():
            fx = _Fixture(self.document)
            fx.write_files()
            persist.persist_document(self.document)
            # A later partial run must not blank the rows a complete run wrote.
            fx.write_files(complete=False)
            result = persist.persist_document(self.document)

        self.assertTrue(result.skipped)
        self.assertEqual(result.reason, 'incomplete extraction')
        self.assertEqual(KbMention.objects.count(), 7)

    def test_drift_is_refused(self):
        with _kb_tmpdir():
            _Fixture(self.document).write_files()
            self.document.content = f'{PAGE_1}\fنص مختلف تماما عن السابق.'
            self.document.save(update_fields=['content'])
            result = persist.persist_document(self.document)

        self.assertTrue(result.skipped)
        self.assertEqual(result.reason, 'normalization drift')
        self.assertEqual(KbMention.objects.count(), 0)

    def test_missing_files_are_skipped(self):
        with _kb_tmpdir():
            result = persist.persist_document(self.document)
        self.assertTrue(result.skipped)
        self.assertEqual(result.reason, 'no segments.json')

    def test_verified_rows_are_reused_not_recreated(self):
        with _kb_tmpdir():
            _Fixture(self.document).write_files()
            persist.persist_document(self.document)
            keep = KbMention.objects.get(surface_form='الشافعي')
            keep.human_verified = True
            keep.review_status = EntityMention.ReviewStatus.APPROVED
            keep.save(update_fields=['human_verified', 'review_status'])
            appr = KbMentionAppraisal.objects.get()
            appr.human_verified = True
            appr.save(update_fields=['human_verified'])

            # _replace_versioned_rows never deletes verified rows, so a re-run
            # would trip the unique constraints unless they are reused.
            result = persist.persist_document(self.document, force=True)

        self.assertFalse(result.skipped)
        self.assertGreaterEqual(result.verified_reused, 2)
        self.assertEqual(KbMention.objects.filter(surface_form='الشافعي').count(), 1)
        self.assertEqual(KbMentionAppraisal.objects.count(), 1)
        survivor = KbMention.objects.get(surface_form='الشافعي')
        self.assertEqual(survivor.pk, keep.pk)
        self.assertTrue(survivor.human_verified)

    def test_verified_assertions_are_reanchored(self):
        """A verified appraisal whose critic FK was SET_NULL by the mention
        replacement is uninterpretable — it must be re-pointed at the new rows."""
        with _kb_tmpdir():
            _Fixture(self.document).write_files()
            persist.persist_document(self.document)
            appr = KbMentionAppraisal.objects.get()
            appr.human_verified = True
            appr.save(update_fields=['human_verified'])
            old_critic = appr.critic_mention_id

            result = persist.persist_document(self.document, force=True)

        appr.refresh_from_db()
        self.assertIsNotNone(appr.critic_mention_id)
        self.assertIsNotNone(appr.subject_mention_id)
        self.assertNotEqual(appr.critic_mention_id, old_critic)
        self.assertEqual(appr.critic_mention.surface_form, 'أحمد بن حنبل')
        self.assertEqual(appr.subject_mention.surface_form, 'الشافعي')
        self.assertGreaterEqual(result.verified_reanchored, 1)

    def test_orphan_flag_when_raw_page_changes_but_normalized_text_does_not(self):
        """Widening an internal whitespace run changes the raw page hash while
        the normalized text — and so norm_sha256 — stays identical. That is the
        only way a verified KB row can outlive its page without tripping the
        drift guard, so it is the only path on which the orphan flag can fire.
        (Trailing whitespace would not do it: split_document_content_into_pages
        strips each page before hashing.)"""
        with _kb_tmpdir():
            fx = _Fixture(self.document)
            fx.write_files()
            persist.persist_document(self.document)
            keep = KbMention.objects.get(surface_form='أحمد بن حنبل')
            keep.human_verified = True
            keep.save(update_fields=['human_verified'])

            widened = PAGE_2.replace('أحمد  بن', 'أحمد   بن')
            self.assertNotEqual(widened, PAGE_2)
            self.document.content = f'{PAGE_1}\f{widened}'
            self.document.save(update_fields=['content'])
            reloaded = Document.objects.get(pk=self.document.pk)
            self.assertEqual(split.norm_sha256(normalize_document(reloaded)),
                             split.norm_sha256(fx.ndoc))
            persist.persist_document(reloaded, force=True)

        keep.refresh_from_db()
        self.assertEqual(keep.review_status, EntityMention.ReviewStatus.ORPHANED)

    def test_dry_run_writes_nothing(self):
        with _kb_tmpdir():
            _Fixture(self.document).write_files()
            result = persist.persist_document(self.document, dry_run=True)

        self.assertFalse(result.skipped)
        self.assertEqual(result.mentions, 7)
        self.assertEqual(KbMention.objects.count(), 0)
        self.assertFalse(ExtractionRun.objects.filter(
            document=self.document).exclude(persisted_hash='').exists())

    def test_legacy_disk_format_is_reported(self):
        with _kb_tmpdir():
            fx = _Fixture(self.document)
            fx.write_files(disk_format=1)
            result = persist.persist_document(self.document)
        self.assertEqual(result.disk_format, 1)


class KbTaskPersistenceTests(TestCase):
    """The task wiring: fresh runs project, and so do runs that skip extraction."""

    def setUp(self):
        from extraction.tests import test_kb_tasks as harness

        self.harness = harness
        self.document = Document.objects.create(
            title='كتاب الاختبار', file='documents/test.txt',
            content=f'{harness.PAGE_1}\f{harness.PAGE_2}', processed=True,
            ocr_engine_used='tesseract')

    def _run(self, **kwargs):
        from extraction.tasks import kb_extract_document_task

        with mock.patch('extraction.kb.split._split_completion',
                        return_value=self.harness.SPLIT_RESPONSE) as m_split, \
                mock.patch('extraction.kb.extract._gemini_call',
                           side_effect=self.harness._fake_gemini) as m_gem:
            kb_extract_document_task.run(self.document.id, **kwargs)
        return m_split, m_gem

    def test_task_persists_on_fresh_run(self):
        with _kb_tmpdir():
            self._run()
        self.assertEqual(KbMention.objects.count(), 3)
        self.assertEqual(KbMentionRelation.objects.count(), 1)
        self.assertEqual(KbMentionClaim.objects.count(), 1)
        run = ExtractionRun.objects.get(
            document=self.document, extractor_name=kb_config.KB_EXTRACTOR_NAME)
        self.assertTrue(run.persisted_hash)

    def test_task_persists_on_the_extraction_skip_path(self):
        """A book extracted before these tables existed must land in the DB on
        its next run — without re-billing a single LLM call."""
        with _kb_tmpdir():
            with mock.patch('extraction.tasks._persist_kb_projection'):
                self._run()
            self.assertEqual(KbMention.objects.count(), 0)

            m_split, m_gem = self._run()
            self.assertFalse(m_split.called)
            self.assertFalse(m_gem.called)
            self.assertEqual(KbMention.objects.count(), 3)

    def test_task_rerun_does_not_duplicate(self):
        with _kb_tmpdir():
            self._run()
            first = KbMention.objects.earliest('id').created_at
            m_split, m_gem = self._run()

        self.assertFalse(m_split.called)
        self.assertFalse(m_gem.called)
        self.assertEqual(KbMention.objects.count(), 3)
        self.assertEqual(KbMention.objects.earliest('id').created_at, first)

    def test_persist_failure_does_not_fail_the_run(self):
        with _kb_tmpdir():
            with mock.patch('extraction.kb.persist.persist_document',
                            side_effect=RuntimeError('boom')):
                self._run()
            book_id = kb_config.book_id_for(self.document)
            self.assertTrue(
                (kb_config.output_dir(book_id) / 'extraction.json').exists())

        run = ExtractionRun.objects.get(
            document=self.document, extractor_name=kb_config.KB_EXTRACTOR_NAME)
        self.assertEqual(run.status, ExtractionRun.Status.SUCCEEDED)
        self.assertIn('db-projection FAILED', run.error)
        self.assertEqual(run.persisted_hash, '')
        self.assertEqual(KbMention.objects.count(), 0)


class BackfillCommandTests(TestCase):
    def setUp(self):
        self.document = _make_document()

    def _call(self, *args):
        out = StringIO()
        call_command('backfill_kb_to_db', *args, stdout=out, stderr=out)
        return out.getvalue()

    def test_backfills_a_book_with_no_db_rows(self):
        with _kb_tmpdir():
            _Fixture(self.document).write_files()
            output = self._call('--all')

        self.assertEqual(KbMention.objects.count(), 7)
        self.assertIn(f'doc {self.document.pk}', output)

    def test_dry_run_writes_nothing(self):
        with _kb_tmpdir():
            _Fixture(self.document).write_files()
            output = self._call('--all', '--dry-run')

        self.assertEqual(KbMention.objects.count(), 0)
        self.assertIn('would project', output)

    def test_only_unpersisted_skips_projected_documents(self):
        with _kb_tmpdir():
            _Fixture(self.document).write_files()
            self._call('--all')
            output = self._call('--all', '--only-unpersisted')

        self.assertIn('Nothing to do', output)

    def test_drift_is_reported_with_the_remedy(self):
        with _kb_tmpdir():
            _Fixture(self.document).write_files()
            self.document.content = f'{PAGE_1}\fمحتوى مختلف.'
            self.document.save(update_fields=['content'])
            output = self._call('--all')

        self.assertEqual(KbMention.objects.count(), 0)
        self.assertIn('normalization drift', output)
        self.assertIn('--force-stage1', output)

    def test_files_built_for_another_document_are_refused(self):
        with _kb_tmpdir():
            fx = _Fixture(self.document)
            fx.write_files()
            meta_path = kb_config.output_dir(fx.book_id) / 'extraction_meta.json'
            meta = json.loads(meta_path.read_text(encoding='utf-8'))
            meta['document_id'] = self.document.pk + 999
            io_utils.atomic_write_text(meta_path, json.dumps(meta))
            output = self._call('--all')

        self.assertEqual(KbMention.objects.count(), 0)
        self.assertIn('another environment', output)

    def test_legacy_disk_format_warning_names_the_remedy(self):
        with _kb_tmpdir():
            _Fixture(self.document).write_files(disk_format=1)
            output = self._call('--all')

        self.assertIn('legacy disk_format 1', output)
        self.assertIn('--force-stage2', output)


class ChoiceVocabularyTests(SimpleTestCase):
    """Choices are derived from kb/schema.py, but max_length is hardcoded — so
    a new enum member must never silently outgrow its column."""

    MODELS = (KbMention, KbMentionRelation, KbMentionClaim, KbMentionAppraisal)

    def test_every_choice_value_fits_its_column(self):
        checked = 0
        for model in self.MODELS:
            for field in model._meta.get_fields():
                if not getattr(field, 'choices', None) or not getattr(
                        field, 'max_length', None):
                    continue
                longest = max(len(v) for v, _ in field.choices)
                self.assertLessEqual(
                    longest, field.max_length,
                    f'{model.__name__}.{field.name}: longest choice is '
                    f'{longest} chars but max_length is {field.max_length}')
                checked += 1
        self.assertGreater(checked, 10)

    def test_every_enum_value_is_offered_as_a_choice(self):
        from extraction.kb import schema

        pairs = (
            (schema.QuotationType, kb_choices.QUOTATION_TYPE_CHOICES),
            (schema.MatchMethod, kb_choices.MATCH_METHOD_CHOICES),
            (schema.LinkingStatus, kb_choices.LINKING_STATUS_CHOICES),
            (schema.ExtractionMethod, kb_choices.EXTRACTION_METHOD_CHOICES),
            (schema.TextStream, kb_choices.TEXT_STREAM_CHOICES),
            (schema.SegmentType, kb_choices.SEGMENT_TYPE_CHOICES),
            (schema.RelationType, kb_choices.RELATION_TYPE_CHOICES),
            (schema.ClaimPredicate, kb_choices.CLAIM_PREDICATE_CHOICES),
            (schema.AppraisalPolarity, kb_choices.APPRAISAL_POLARITY_CHOICES),
            (schema.AppraisalRank, kb_choices.APPRAISAL_RANK_CHOICES),
            (schema.AppraisalScopeKind, kb_choices.APPRAISAL_SCOPE_KIND_CHOICES),
        )
        for enum_cls, choices in pairs:
            offered = {v for v, _ in choices}
            self.assertEqual({m.value for m in enum_cls} - offered, set(),
                             f'{enum_cls.__name__} has values with no choice')
        subtypes = {v for v, _ in kb_choices.MENTION_SUBTYPE_CHOICES}
        for enum_cls in (schema.WorkSubtype, schema.OrganizationSubtype,
                         schema.SectKind):
            self.assertEqual({m.value for m in enum_cls} - subtypes, set())

    def test_mention_labels_match_the_extraction_schema(self):
        self.assertEqual({v for v, _ in kb_choices.MENTION_LABEL_CHOICES},
                         set(kb_extract.MENTION_LABELS))

    def test_relation_type_choices_match_the_llm_vocabulary(self):
        self.assertEqual({v for v, _ in kb_choices.RELATION_TYPE_CHOICES},
                         set(kb_extract.RELATION_TYPE_VALUES))
