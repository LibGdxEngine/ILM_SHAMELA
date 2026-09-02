"""Heritage schema invariants the KB pipeline depends on: window planning
(packing, splitting, oversized coref scopes) and DocumentExtraction's
cross-validators. The schema module itself carries a fuller smoke test under
``python extraction/kb/schema.py``.
"""
from django.test import SimpleTestCase

from extraction.kb.schema import (
    DocumentExtraction,
    MentionRelation,
    PersonMention,
    PlaceMention,
    Provenance,
    RelationType,
    Segment,
    SegmentDetector,
    SegmentType,
    SegmentedDocument,
    TextSpan,
    plan_windows,
)


def _prov(**kw):
    return Provenance(book_id='doc_1', extraction_method='llm', **kw)


class PlanWindowsTests(SimpleTestCase):
    def test_packing_and_oversized_coref_scope(self):
        chapter = Segment(
            book_id='b', segment_type=SegmentType.CHAPTER,
            span=TextSpan(start=0, end=5000), order=0,
            detector=SegmentDetector.MARKUP)
        annal = Segment(
            book_id='b', segment_type=SegmentType.ANNAL,
            span=TextSpan(start=5000, end=9000), order=1,
            detector=SegmentDetector.MARKUP)
        doc = SegmentedDocument(book_id='b', text_length=9000,
                                segments=[chapter, annal])
        wins = plan_windows(doc, max_chars=1000, overlap=100)
        chapter_wins = [w for w in wins if w.segment_ids == [chapter.id]]
        annal_wins = [w for w in wins if w.segment_ids == [annal.id]]
        # A long chapter of running prose IS split; none flagged oversized.
        self.assertEqual(len(chapter_wins), 5)
        self.assertFalse(any(w.oversized for w in chapter_wins))
        # A coref scope (annal) is NEVER split — one oversized window.
        self.assertEqual(len(annal_wins), 1)
        self.assertTrue(annal_wins[0].oversized)
        # Focus spans tile each leaf exactly: no gaps, no overlaps.
        self.assertEqual(chapter_wins[0].focus_span.start, 0)
        self.assertEqual(chapter_wins[-1].focus_span.end, 5000)
        for a, b in zip(chapter_wins, chapter_wins[1:]):
            self.assertEqual(a.focus_span.end, b.focus_span.start)
        # Context overlap is clamped at document edges.
        self.assertEqual(wins[0].context_span.start, 0)

    def test_text_guided_cuts_land_on_whitespace(self):
        body = ('فقرة. ' * 160 + '\n\n') * 5
        doc = SegmentedDocument(
            book_id='b', text_length=len(body),
            segments=[Segment(book_id='b', segment_type=SegmentType.CHAPTER,
                              span=TextSpan(start=0, end=len(body)), order=0,
                              detector=SegmentDetector.MARKUP)])
        wins = plan_windows(doc, max_chars=1000, overlap=100, text=body)
        self.assertFalse(any(w.oversized for w in wins))
        for w in wins[1:]:
            self.assertTrue(body[w.focus_span.start - 1].isspace(),
                            'cuts must land on whitespace, never mid-word')

    def test_overlapping_siblings_rejected(self):
        with self.assertRaises(ValueError):
            SegmentedDocument(
                book_id='b', text_length=100,
                segments=[
                    Segment(book_id='b', segment_type=SegmentType.BIOGRAPHY,
                            span=TextSpan(start=0, end=60), order=0,
                            detector=SegmentDetector.MARKUP),
                    Segment(book_id='b', segment_type=SegmentType.BIOGRAPHY,
                            span=TextSpan(start=50, end=90), order=1,
                            detector=SegmentDetector.MARKUP),
                ])


class DocumentExtractionValidatorTests(SimpleTestCase):
    def test_valid_relation_between_known_mentions(self):
        p = PersonMention(surface_form='الشافعي', provenance=_prov())
        g = PlaceMention(surface_form='غزة', provenance=_prov())
        doc = DocumentExtraction(
            book_id='doc_1', mentions=[p, g],
            relations=[MentionRelation(
                relation_type=RelationType.BORN_IN,
                subject_mention_id=p.id, object_mention_id=g.id,
                provenance=_prov())])
        self.assertEqual(len(doc.relations), 1)

    def test_dangling_mention_id_rejected(self):
        p = PersonMention(surface_form='الشافعي', provenance=_prov())
        with self.assertRaises(ValueError):
            DocumentExtraction(
                book_id='doc_1', mentions=[p],
                relations=[MentionRelation(
                    relation_type=RelationType.BORN_IN,
                    subject_mention_id=p.id, object_mention_id='men_missing',
                    provenance=_prov())])

    def test_domain_range_enforced_at_mention_level(self):
        p = PersonMention(surface_form='البخاري', provenance=_prov())
        g = PlaceMention(surface_form='مصر', provenance=_prov())
        with self.assertRaises(ValueError):
            DocumentExtraction(
                book_id='doc_1', mentions=[p, g],
                relations=[MentionRelation(
                    relation_type=RelationType.AUTHORED,  # place cannot author
                    subject_mention_id=g.id, object_mention_id=p.id,
                    provenance=_prov())])
