"""Stage 1 tests without any LLM: marker->offset resolution through the
folded shadow, merge rules, and the full-coverage segment invariant (port of
the notebook's cell self-test).
"""
from django.test import SimpleTestCase

from extraction.kb.normalize import normalize_pages
from extraction.kb.schema import SegmentDetector, SegmentType
from extraction.kb.split import (
    SplitMarker,
    build_segments,
    chunk_for_split,
    merge_points,
    resolve_markers,
    seeds_to_points,
)


def _ndoc(text, book_id='doc_1'):
    return normalize_pages([{'page_number': 1, 'content': text}], book_id)


class ResolveMarkersTests(SimpleTestCase):
    TEXT = '\n'.join([
        'مقدمة الكتاب وفيها كلام كثير.',
        'ذكر أَبُو عَبْدِ اللهِ البُخارِيُّ رحمه الله.',
        '12 - محمد بن إسماعيل البخاري الجعفي.',
        'ثم دخلت سنة خمس وثلاثين ومائتين.',
        'وقال بعض أهل العلم كلاما آخر.',
    ])

    def test_exact_and_shadow_tiers(self):
        nd = _ndoc(self.TEXT)
        markers = [
            # exact match
            SplitMarker(verbatim_line='12 - محمد بن إسماعيل البخاري الجعفي.',
                        segment_type='biography'),
            # differs in tashkeel + hamza forms -> folded-shadow tier resolves it
            SplitMarker(verbatim_line='ثم دخلت سنه خمس وثلاثين ومايتين'.replace('ومايتين', 'ومائتين'),
                        segment_type='annal'),
        ]
        pts, stats = resolve_markers(nd, markers)
        self.assertEqual(stats['resolved'], 2)
        self.assertEqual([p.segment_type for p in pts],
                         [SegmentType.BIOGRAPHY, SegmentType.ANNAL])
        # Offsets snap to line starts.
        for p in pts:
            self.assertTrue(p.offset == 0 or nd.text[p.offset - 1] == '\n')

    def test_shadow_tier_bridges_diacritics(self):
        nd = _ndoc(self.TEXT)
        # The model echoes the line without tashkeel and with bare hamzas.
        markers = [SplitMarker(
            verbatim_line='ذكر ابو عبد الله البخاري رحمه الله.',
            segment_type='chapter')]
        pts, stats = resolve_markers(nd, markers)
        self.assertEqual(stats['resolved'], 1)
        self.assertTrue(nd.text[pts[0].offset:].startswith('ذكر أَبُو'))

    def test_unresolvable_marker_is_skipped(self):
        nd = _ndoc(self.TEXT)
        pts, stats = resolve_markers(
            nd, [SplitMarker(verbatim_line='سطر غير موجود إطلاقا')])
        self.assertEqual(pts, [])
        self.assertEqual(len(stats['unresolved']), 1)

    def test_offsets_strictly_increase(self):
        nd = _ndoc(self.TEXT)
        line = '12 - محمد بن إسماعيل البخاري الجعفي.'
        # Duplicate markers (as from overlapping chunks) collapse to one.
        pts, stats = resolve_markers(nd, [
            SplitMarker(verbatim_line=line, segment_type='biography'),
            SplitMarker(verbatim_line=line, segment_type='biography'),
        ])
        self.assertEqual(len(pts), 1)


class MergeAndBuildTests(SimpleTestCase):
    def test_markup_wins_within_five_chars(self):
        nd = _ndoc('عنوان الباب\nنص تحت الباب يطول قليلا هنا.')
        seed_pts = seeds_to_points(nd)  # empty (no markdown headings) — build manually
        llm_pts, _ = resolve_markers(nd, [SplitMarker(
            verbatim_line='عنوان الباب', segment_type='chapter')])
        from extraction.kb.split import SplitPoint
        from extraction.kb.schema import TextStream
        markup = [SplitPoint(0, SegmentType.CHAPTER, 'عنوان', TextStream.MAIN,
                             SegmentDetector.MARKUP, 1.0)]
        merged = merge_points(llm_pts, markup)
        self.assertEqual(len(merged), 1)
        self.assertIs(merged[0].detector, SegmentDetector.MARKUP)

    def test_full_coverage_and_leading_gap(self):
        nd = _ndoc('نص قبل أول فاصل.\nالباب الأول هنا.\nونص تابع له.')
        offset = nd.text.find('الباب الأول')
        from extraction.kb.split import SplitPoint
        from extraction.kb.schema import TextStream
        pts = [SplitPoint(offset, SegmentType.CHAPTER, None, TextStream.MAIN,
                          SegmentDetector.MODEL, 0.9)]
        doc = build_segments('doc_1', nd, pts)
        # Every character sits in exactly one segment (leading gap covered too).
        self.assertEqual(sum(s.length for s in doc.segments), doc.text_length)
        self.assertEqual(doc.segments[0].span.start, 0)
        self.assertIs(doc.segments[0].detector, SegmentDetector.TYPOGRAPHY)

    def test_no_points_falls_back_to_windows(self):
        nd = _ndoc('سطر.\n' * 500)
        doc = build_segments('doc_1', nd, [])
        self.assertTrue(all(s.detector is SegmentDetector.FALLBACK_WINDOW
                            for s in doc.segments))
        self.assertEqual(sum(s.length for s in doc.segments), doc.text_length)

    def test_chunking_covers_text_with_overlap(self):
        text = ('سطر من النص هنا.\n' * 20000)
        chunks = chunk_for_split(text)
        self.assertGreater(len(chunks), 1)
        # Concatenating chunk contents must cover the whole text (with overlap).
        self.assertGreaterEqual(sum(len(c) for c in chunks), len(text))
        for c in chunks:
            self.assertIn(c[:50], text)


class ConfigErrorTests(SimpleTestCase):
    def test_missing_key_fails_stage1_loudly(self):
        from unittest import mock

        from extraction.kb import split as kb_split

        nd = _ndoc('نص الكتاب هنا يمتد قليلا.')
        with mock.patch.object(
                kb_split, '_split_completion',
                side_effect=RuntimeError('OPENROUTER_API_KEY is not set')):
            with self.assertRaises(RuntimeError):
                kb_split.collect_markers('doc_1', nd)

    def test_transient_chunk_error_still_degrades_gracefully(self):
        from unittest import mock

        from extraction.kb import split as kb_split

        nd = _ndoc('نص الكتاب هنا يمتد قليلا.')
        with mock.patch.object(
                kb_split, '_split_completion',
                side_effect=TimeoutError('socket timed out')):
            self.assertEqual(kb_split.collect_markers('doc_1', nd), [])
