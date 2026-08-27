"""Pure-unit tests for search_engine.word_geometry (fabricated sidecar output, no DB/HTTP)."""
from django.test import SimpleTestCase

from search_engine import word_geometry as wg
from search_engine.word_geometry import (
    OcrWord, _assigned_bbox, _enforce_reading_order, align_tokens, apply_word_geometry_to_page,
    block_word_geometry, build_rows, is_rtl, match_key, needs_geometry, order_ocr_lines,
    page_regions, page_scale, place_words, tokenize,
)

# 40 distinct real words (no repeats — keeps SequenceMatcher anchors unambiguous).
WORDS = (
    'وإذا تطبعت النفس على الكبر كان أضر عليها من طبع الحدة والعجلة قال الغزالي رحمه الله '
    'تعالى إن العلم نور يقذفه في قلب يشاء هذا الكتاب جمع فيه المؤلف أبواب الفقه وشرح مسائل '
    'الأصول بعبارة سهلة واضحة تناسب المبتدئ جميعا'
).split()
assert len(WORDS) == 40 and len(set(WORDS)) == 40

BLOCK_BBOX = [0.0, 0.0, 1000.0, 300.0]
# Rows of 40px-high words at pitch 60: row k spans y 10+60k .. 50+60k.
ROW_Y = [(10 + 60 * k, 50 + 60 * k) for k in range(4)]


def _word(text, x0, y0, x1, y1, conf=90):
    return {'text': text, 'bbox': [x0, y0, x1, y1], 'conf': conf}


def _line(texts, row=0, x_right=900, width=80, gap=20, order=(1, 1, 1)):
    """One tesseract line: words laid right-to-left from x_right in reading order."""
    y0, y1 = ROW_Y[row]
    words, x1 = [], x_right
    for text in texts:
        words.append(_word(text, x1 - width, y0, x1, y1))
        x1 -= width + gap
    return {'bbox': [words[-1]['bbox'][0], y0, x_right, y1], 'order': list(order), 'words': words}


def _region(lines, rid='0', error=None):
    region = {'id': rid, 'lines': lines}
    if error:
        region['error'] = error
    return region


def _block(text, bbox=None, **extra):
    block = {'id': '/page/0/Text/0', 'type': 'Text', 'bbox': list(bbox or BLOCK_BBOX),
             'text': text, 'char_start': 0, 'char_end': len(text)}
    block.update(extra)
    return block


def _ocr(lines, rtl=True, sx=1.0, sy=1.0):
    return order_ocr_lines(lines, sx, sy, rtl)


class TextHelperTests(SimpleTestCase):
    def test_tokenize_offsets_partition_text(self):
        text = 'وإذا تطبعت\nالنفس  على'
        tokens = tokenize(text)
        self.assertEqual([(t.start, t.end, t.text) for t in tokens],
                         [(0, 4, 'وإذا'), (5, 10, 'تطبعت'), (11, 16, 'النفس'), (18, 21, 'على')])
        starts = [t.start for t in tokens] + [len(text)]
        self.assertEqual(''.join(text[starts[i]:starts[i + 1]] for i in range(len(tokens))), text)
        self.assertEqual(tokenize(''), [])

    def test_match_key_normalizes(self):
        self.assertEqual(match_key('احتاجَت،'), 'احتاجت')
        self.assertEqual(match_key('دينيّةَ'), 'دينيه')
        self.assertEqual(match_key('أدلة'), 'ادله')
        self.assertEqual(match_key('(١)'), '1')
        self.assertEqual(match_key('١٢٣'), '123')
        for punct in ('»', '،', '...', '-'):
            self.assertEqual(match_key(punct), '')

    def test_is_rtl(self):
        self.assertTrue(is_rtl('وإذا تطبعت'))
        self.assertFalse(is_rtl('Hello world'))
        self.assertTrue(is_rtl('123', default=True))
        self.assertFalse(is_rtl('123', default=False))


class OrderOcrLinesTests(SimpleTestCase):
    def test_scales_by_sx_sy_and_orders_words_geometrically(self):
        line = {'bbox': [0, 0, 0, 0], 'order': [1, 1, 1],
                'words': [_word('وإذا', 100, 10, 200, 50), _word('تطبعت', 0, 10, 90, 50)]}
        words = _ocr([line], sx=0.5, sy=2.0)
        self.assertEqual([w.text for w in words], ['وإذا', 'تطبعت'])
        self.assertEqual(words[0].bbox, [50.0, 20.0, 100.0, 100.0])
        self.assertEqual([w.row for w in words], [0, 0])
        # Reading order is geometric: rtl → x descending even when tesseract emitted
        # visual (LTR) order; ltr → x ascending.
        line['words'].reverse()
        self.assertEqual([w.text for w in _ocr([line])], ['وإذا', 'تطبعت'])
        self.assertEqual([w.text for w in _ocr([line], rtl=False)], ['تطبعت', 'وإذا'])

    def test_drops_empty_key_words_and_lines(self):
        lines = [_line(['وإذا', '»', 'تطبعت'], row=0), _line(['،', '»'], row=1), _line(['النفس'], row=2)]
        words = _ocr(lines)
        self.assertEqual([w.text for w in words], ['وإذا', 'تطبعت', 'النفس'])
        self.assertEqual([w.row for w in words], [0, 0, 1])

    def test_rows_sequential_by_y_even_when_lines_arrive_out_of_order(self):
        words = _ocr([_line(['كان'], row=1), _line(['وإذا'], row=0)])
        self.assertEqual([(w.text, w.row) for w in words], [('وإذا', 0), ('كان', 1)])

    def test_close_lines_merge_into_one_row_sorted_by_x_for_rtl(self):
        first = _line(['وإذا', 'النفس'], row=0, x_right=900, width=80, gap=120)  # x 820-900, 620-700
        second = _line(['تطبعت'], row=0, x_right=800)                          # x 720-800
        for w in second['words']:
            w['bbox'][1] += 6
            w['bbox'][3] += 6  # centre 36 vs 30: within 0.5 × height
        words = _ocr([first, second])
        self.assertEqual([w.text for w in words], ['وإذا', 'تطبعت', 'النفس'])
        self.assertEqual({w.row for w in words}, {0})


class AlignTokensTests(SimpleTestCase):
    def test_exact_match(self):
        tokens = tokenize('وإذا تطبعت النفس')
        assign = align_tokens(tokens, _ocr([_line(['وإذا', 'تطبعت', 'النفس'])]), True)
        self.assertEqual(assign, [[0], [1], [2]])

    def test_equal_count_gap_paired_positionally(self):
        tokens = tokenize('احتاجت إلى استعمال')
        assign = align_tokens(tokens, _ocr([_line(['احتاجث', 'إلى', 'استعمالٍ'])]), True)
        self.assertEqual(assign, [[0], [1], [2]])

    def test_merge_when_tesseract_split_a_word(self):
        tokens = tokenize('استخدام الأدلة والبراهين كما')
        ocr = _ocr([_line(['استخدام', 'الأدلة', 'وال', 'براهين', 'كما'])])
        assign = align_tokens(tokens, ocr, True)
        self.assertEqual(assign[2], [2, 3])
        union = _assigned_bbox(assign[2], ocr, True)
        self.assertEqual(union[0], ocr[3].bbox[0])
        self.assertEqual(union[2], ocr[2].bbox[2])

    def test_split_when_tesseract_joined_two_words(self):
        tokens = tokenize('على استخدام الأدلة من')
        ocr = _ocr([_line(['على', 'استخدامالأدلة', 'من'])])
        assign = align_tokens(tokens, ocr, True)
        self.assertEqual(assign[1][:3], ('split', 1, 0))
        self.assertEqual(assign[2][:3], ('split', 1, 1))
        first = _assigned_bbox(assign[1], ocr, True)
        second = _assigned_bbox(assign[2], ocr, True)
        joined = ocr[1].bbox
        self.assertEqual(first[2], joined[2])   # first token takes the RIGHT part (rtl)
        self.assertEqual(second[0], joined[0])
        self.assertAlmostEqual(first[0], second[2])
        self.assertLess(second[2], first[2])

    def test_out_of_order_anchor_is_demoted(self):
        tokens = tokenize('وإذا تطبعت النفس على')
        ocr = _ocr([_line(['وإذا', 'تطبعت', 'النفس', 'على'])])  # x1: 900, 800, 700, 600
        assign = [[0], [3], [1], [2]]  # token 1 anchored far ahead (x1=600) → breaks order
        _enforce_reading_order(tokens, ocr, assign, True)
        self.assertEqual(assign, [[0], None, [1], [2]])


class BuildRowsTests(SimpleTestCase):
    @staticmethod
    def _words(*rows_y, x=(800, 900)):
        return [OcrWord(text='كلمة', bbox=[x[0], y0, x[1], y1], row=i, key='كلمه')
                for i, (y0, y1) in enumerate(rows_y)]

    def test_uniform_rows_from_centres(self):
        rows, H, pitch = build_rows(self._words((10, 50), (70, 110)), BLOCK_BBOX)
        self.assertEqual(H, 40)
        self.assertEqual(pitch, 60)
        self.assertEqual([(r.y0, r.y1) for r in rows], [(6, 54), (66, 114)])

    def test_adjacent_rows_clamped_at_midpoint(self):
        rows, _, _ = build_rows(self._words((10, 50), (40, 80)), BLOCK_BBOX)
        self.assertEqual(rows[0].y1, 45)
        self.assertEqual(rows[1].y0, 45)

    def test_rows_clipped_to_block(self):
        rows, _, _ = build_rows(self._words((10, 50)), [0, 10, 1000, 40])
        self.assertEqual((rows[0].y0, rows[0].y1), (10, 40))

    def test_phantom_row_inserted_on_pitch_jump_and_words_renumbered(self):
        words = self._words((10, 50), (70, 110), (190, 230))  # centres 30, 90, 210
        rows, _, pitch = build_rows(words, BLOCK_BBOX)
        self.assertEqual(pitch, 60)
        self.assertEqual(len(rows), 4)
        self.assertEqual(rows[2].yc, 150)
        self.assertEqual([w.row for w in words], [0, 1, 3])


class PlaceWordsTests(SimpleTestCase):
    def _place(self, text, lines):
        tokens = tokenize(text)
        ocr = _ocr(lines)
        assign = align_tokens(tokens, ocr, True)
        words, rows = place_words(tokens, assign, ocr, BLOCK_BBOX, True)
        return tokens, words, rows

    def test_matched_tokens_take_ocr_x_and_row_y(self):
        _, words, rows = self._place('وإذا تطبعت النفس', [_line(['وإذا', 'تطبعت', 'النفس'])])
        self.assertEqual(rows, 1)
        self.assertEqual(words[0]['bbox'], [820.0, 6.0, 900.0, 54.0])
        self.assertEqual(words[2]['bbox'][:1] + words[2]['bbox'][2:3], [620.0, 700.0])
        self.assertTrue(all(w['matched'] and w['line'] == 0 for w in words))

    def test_unmatched_run_fills_gap_on_same_row(self):
        text = 'وإذا تطبعت النفس على الكبر'
        _, words, _ = self._place(text, [_line(['وإذا', 'تطبعت', 'الكبر'], gap=20)])
        a, b = words[1], words[4]  # x0=720 / x1=... — OCR laid 'الكبر' at 620-700
        for w in (words[2], words[3]):
            self.assertFalse(w['matched'])
            self.assertEqual(w['line'], 0)
            self.assertGreaterEqual(w['bbox'][0], b['bbox'][2])
            self.assertLessEqual(w['bbox'][2], a['bbox'][0])
        self.assertGreater(words[2]['bbox'][0], words[3]['bbox'][2])  # reading order → decreasing x

    def test_unmatched_at_block_start_leads_into_first_match(self):
        _, words, _ = self._place('وإذا تطبعت النفس', [_line(['تطبعت', 'النفس'], x_right=800)])
        self.assertFalse(words[0]['matched'])
        self.assertGreaterEqual(words[0]['bbox'][0], 800)
        self.assertLessEqual(words[0]['bbox'][2], 1000)
        self.assertEqual(words[0]['line'], 0)

    def test_unmatched_at_block_end_hugs_last_match(self):
        _, words, rows = self._place('وإذا تطبعت النفس', [_line(['وإذا', 'تطبعت'])])
        self.assertEqual(rows, 1)
        self.assertFalse(words[2]['matched'])
        self.assertLess(words[2]['bbox'][2], 720)
        self.assertGreater(words[2]['bbox'][2], 600)
        self.assertGreaterEqual(words[2]['bbox'][0], 0)

    def test_unmatched_run_across_rows_stays_inside_block(self):
        text = 'وإذا تطبعت النفس على الكبر كان أضر عليها'
        _, words, rows = self._place(text, [_line(['وإذا', 'تطبعت', 'النفس'], row=0),
                                            _line(['كان', 'أضر', 'عليها'], row=1)])
        self.assertEqual(rows, 2)
        for w in (words[3], words[4]):
            self.assertFalse(w['matched'])
            self.assertEqual(w['line'], 0)
            self.assertLess(w['bbox'][2], 620)
            self.assertGreaterEqual(w['bbox'][0], 0)
        self.assertEqual([w['line'] for w in words[5:]], [1, 1, 1])

    def test_punctuation_only_token_gets_small_box_in_gap(self):
        _, words, _ = self._place('قال - الشيخ', [_line(['قال', 'الشيخ'], gap=120)])  # 800-900, 600-700
        dash = words[1]
        self.assertFalse(dash['matched'])
        self.assertGreaterEqual(dash['bbox'][0], 700)
        self.assertLessEqual(dash['bbox'][2], 800)
        self.assertLessEqual(dash['bbox'][2] - dash['bbox'][0], 60)


class BlockWordGeometryTests(SimpleTestCase):
    def test_none_for_empty_degenerate_or_errored(self):
        self.assertIsNone(block_word_geometry(_block(''), None, 1, 1))
        self.assertIsNone(block_word_geometry(_block('كلمة أخرى', bbox=[10, 10, 10, 50]), None, 1, 1))
        self.assertIsNone(block_word_geometry(_block('كلمة أخرى ثالثة'), _region([], error='boom'), 1, 1))

    def test_single_token_uses_block_bbox(self):
        result = block_word_geometry(_block('٩', bbox=[10, 10, 50, 40]), None, 1, 1)
        self.assertEqual(result.words, [{'start': 0, 'end': 1, 'bbox': [10.0, 10.0, 50.0, 40.0],
                                         'line': 0, 'matched': False}])
        self.assertEqual(result.meta['method'], 'block')
        self.assertEqual(result.meta['coverage'], 1.0)

    def test_small_block_with_matching_count_is_positional(self):
        region = _region([_line(['وهذا', 'الاستخدامُ'])])
        result = block_word_geometry(_block('وهذا الاستخدام'), region, 1, 1)
        self.assertEqual(result.meta['method'], 'ocr')
        self.assertEqual([w['bbox'][0] for w in result.words], [820.0, 720.0])
        self.assertTrue(all(w['matched'] for w in result.words))

    def test_small_block_with_count_mismatch_is_proportional(self):
        result = block_word_geometry(_block('وهذا الاستخدام'), _region([_line(['وهذاالاستخدام'])]), 1, 1)
        self.assertEqual(result.meta['method'], 'proportional')
        first, second = result.words
        self.assertEqual(first['bbox'][2], 1000.0)   # rtl: first token at the right edge
        self.assertEqual(second['bbox'][0], 0.0)
        self.assertAlmostEqual(first['bbox'][0], second['bbox'][2], places=1)
        self.assertEqual({w['line'] for w in result.words}, {0})

    def test_multiline_block_without_ocr_records_attempt_only(self):
        result = block_word_geometry(_block('وإذا تطبعت\nالنفس على'), _region([]), 1, 1)
        self.assertIsNone(result.words)
        self.assertEqual(result.meta['coverage'], 0.0)
        self.assertEqual(result.meta['method'], 'ocr')

    def test_low_coverage_keeps_meta_without_words(self):
        text = ' '.join(WORDS[:10])
        result = block_word_geometry(_block(text), _region([_line(WORDS[:3])]), 1, 1)
        self.assertIsNone(result.words)
        self.assertEqual(result.meta['coverage'], 0.3)
        self.assertEqual(result.meta['tokens'], 10)

    def test_long_unmatched_run_rejected_despite_coverage(self):
        text = ' '.join(WORDS)  # 4 printed rows of 10
        lines = [_line(WORDS[0:10], row=0, x_right=1000, width=80, gap=20),
                 _line(WORDS[10:20], row=1, x_right=1000, width=80, gap=20),
                 _line(WORDS[33:40], row=3, x_right=700, width=80, gap=20)]  # row 2 + 3 words missing
        result = block_word_geometry(_block(text), _region(lines), 1, 1)
        self.assertGreaterEqual(result.meta['coverage'], wg.MIN_COVERAGE)
        self.assertIsNone(result.words)

    def test_good_block_yields_complete_words_satisfying_invariants(self):
        text = ' '.join(WORDS[:5]) + '\n' + ' '.join(WORDS[5:10]) + ' ' + ' '.join(WORDS[10:13])
        lines = [_line(['وإذا', 'تطبّعت', 'النفسُ', '»', 'على', 'الكبر»'], row=0),
                 _line(WORDS[5:10], row=1),
                 _line(WORDS[10:13], row=2)]
        block = _block(text)
        result = block_word_geometry(block, _region(lines), 1, 1)
        self.assertIsNotNone(result.words)
        self.assertEqual(result.meta['coverage'], 1.0)
        self.assertEqual(result.meta['lines'], 3)
        words = result.words
        tokens = tokenize(text)
        self.assertEqual(len(words), len(tokens))
        starts = [w['start'] for w in words]
        self.assertEqual(starts, sorted(set(starts)))
        by_line = {}
        for w, t in zip(words, tokens):
            self.assertGreater(w['end'], w['start'])
            self.assertEqual(text[w['start']:w['end']], t.text)
            x0, y0, x1, y1 = w['bbox']
            self.assertTrue(0 <= x0 < x1 <= 1000 and 0 <= y0 < y1 <= 300, w)
            by_line.setdefault(w['line'], set()).add((y0, y1))
        self.assertTrue(all(len(v) == 1 for v in by_line.values()))
        self.assertEqual(block['text'], text)  # input untouched


class PageHelperTests(SimpleTestCase):
    def _layout(self):
        return {'width': 1000, 'height': 1400, 'blocks': [
            _block('٩', bbox=[100, 10, 140, 40]) | {'id': 'a'},
            _block('وهذا الاستخدام', bbox=[100, 50, 900, 100]) | {'id': 'b'},
            _block(' '.join(WORDS[:6]), bbox=[100, 120, 900, 400]) | {'id': 'c'},
            _block(' '.join(WORDS[6:10]), bbox=[100, 420, 900, 500], word_geometry={'engine': 'x'}) | {'id': 'd'},
        ]}

    def test_page_scale(self):
        sx, sy = page_scale({'width': 1260, 'height': 1736}, 989, 1357)
        self.assertAlmostEqual(sx, 1260 / 989)
        self.assertAlmostEqual(sy, 1736 / 1357)
        self.assertEqual(page_scale({}, 500, 700), (1.0, 1.0))

    def test_needs_geometry(self):
        self.assertTrue(needs_geometry({}))
        self.assertFalse(needs_geometry({'word_geometry': {'engine': 'tesseract'}}))
        self.assertTrue(needs_geometry({'word_geometry': {'engine': 'tesseract'}}, force=True))

    def test_page_regions(self):
        regions = page_regions(self._layout(), 2.0, 2.0)
        # Single-token blocks only ask for their ink extent; multi-token blocks are OCR'd.
        self.assertEqual([r['id'] for r in regions], ['0', '1', '2'])
        self.assertTrue(regions[0].get('ink_only'))
        self.assertNotIn('psm', regions[0])
        self.assertEqual([(r['id'], r['psm']) for r in regions[1:]],
                         [('1', wg.SINGLE_LINE_PSM), ('2', wg.DEFAULT_PSM)])
        self.assertEqual(regions[1]['bbox'], [50.0, 25.0, 450.0, 50.0])
        self.assertTrue(all('lang' not in r for r in regions))  # Arabic pages use the page default
        self.assertEqual([r['id'] for r in page_regions(self._layout(), 2.0, 2.0, force=True)], ['0', '1', '2', '3'])

    def test_apply_word_geometry_to_page(self):
        layout = self._layout()
        result = {'width': 1000, 'height': 1400, 'regions': [
            _region([_line(['وهذا', 'الاستخدام'], row=0)], rid='1'),
            _region([], rid='2', error='tesseract exploded'),
        ]}
        new_layout, stats = apply_word_geometry_to_page(layout, result, 1.0, 1.0)
        self.assertIsNot(new_layout, layout)
        self.assertNotIn('word_geometry', layout['blocks'][1])
        self.assertEqual(stats['blocks'], 4)
        self.assertEqual(stats['skipped'], 1)
        self.assertEqual(stats['errors'], 1)
        self.assertEqual(stats['with_words'], 2)   # single-token header + small block
        self.assertEqual(stats['attempted'], 2)
        blocks = new_layout['blocks']
        self.assertEqual(blocks[0]['word_geometry']['method'], 'block')
        self.assertEqual(len(blocks[1]['words']), 2)
        self.assertNotIn('word_geometry', blocks[2])      # errored region → retry later
        self.assertNotIn('words', blocks[3])              # skipped, untouched
        for old, new in zip(layout['blocks'], blocks):
            for key in ('text', 'char_start', 'char_end', 'bbox', 'id'):
                self.assertEqual(old[key], new[key])

    def test_apply_with_force_recomputes_existing_geometry(self):
        layout = self._layout()
        result = {'regions': [_region([_line(WORDS[6:10], row=0)], rid='3')]}
        new_layout, stats = apply_word_geometry_to_page(layout, result, 1.0, 1.0, force=True)
        self.assertEqual(stats['skipped'], 0)
        self.assertEqual(new_layout['blocks'][3]['word_geometry']['engine'], wg.ENGINE)
        self.assertEqual(len(new_layout['blocks'][3]['words']), 4)


class InkExtentAndFallbackTests(SimpleTestCase):
    """Ink-extent regions, per-block language, and the single-line proportional fallback."""

    def test_block_lang_prefers_eng_for_latin_dominant_text(self):
        self.assertEqual(wg.block_lang('Ibn Khaldun, Muqaddimah, vol. 2'), 'eng')
        self.assertIsNone(wg.block_lang('المقدمة لابن خلدون vol. 2'))
        self.assertIsNone(wg.block_lang('١٢٣'))

    def test_page_regions_sets_lang_for_latin_blocks(self):
        layout = {'width': 100, 'height': 100, 'blocks': [
            {'id': 'a', 'type': 'Text', 'bbox': [0, 0, 50, 10], 'text': 'Printed in Cairo 1932',
             'char_start': 0, 'char_end': 21},
        ]}
        regions = page_regions(layout, 1.0, 1.0)
        self.assertEqual(regions[0]['lang'], 'eng')

    def test_is_single_line_block(self):
        tokens = wg.tokenize('الفصل بين النفس والعقل')
        self.assertTrue(wg.is_single_line_block({'type': 'PageHeader', 'text': 'الفصل بين النفس والعقل'}, tokens))
        self.assertTrue(wg.is_single_line_block({'type': 'Text', 'text': 'الفصل بين النفس والعقل'}, tokens))  # ≤ 6 tokens
        long_text = ' '.join(['كلمة'] * 9)
        self.assertFalse(wg.is_single_line_block({'type': 'Text', 'text': long_text}, wg.tokenize(long_text)))
        self.assertFalse(wg.is_single_line_block({'type': 'SectionHeader', 'text': 'سطر\nسطر'}, wg.tokenize('سطر\nسطر')))

    def test_scaled_ink_bbox_scales_and_clips(self):
        block = [100.0, 100.0, 300.0, 140.0]
        self.assertEqual(wg.scaled_ink_bbox({'ink_bbox': [55, 52, 145, 68]}, 2.0, 2.0, block), [110.0, 104.0, 290.0, 136.0])
        # Outside / degenerate / missing → None
        self.assertIsNone(wg.scaled_ink_bbox({'ink_bbox': [0, 0, 10, 10]}, 1.0, 1.0, block))
        self.assertIsNone(wg.scaled_ink_bbox({'ink_bbox': None}, 1.0, 1.0, block))
        self.assertIsNone(wg.scaled_ink_bbox(None, 1.0, 1.0, block))

    def test_single_token_uses_ink_extent(self):
        block = {'id': 'h', 'type': 'PageHeader', 'bbox': [259, 65, 277, 97], 'text': '٩', 'char_start': 0, 'char_end': 1}
        result = block_word_geometry(block, {'id': '0', 'lines': [], 'ink_bbox': [261, 66, 275, 89]}, 1.0, 1.0)
        self.assertEqual(result.meta['method'], 'block')
        self.assertEqual(result.words[0]['bbox'], [261.0, 66.0, 275.0, 89.0])
        # No ink extent → the block box.
        result = block_word_geometry(block, None, 1.0, 1.0)
        self.assertEqual(result.words[0]['bbox'], [259.0, 65.0, 277.0, 97.0])

    def test_unreadable_single_line_header_is_proportional_over_ink(self):
        text = 'الفصل بين النفس والعقل'
        block = {'id': 'h', 'type': 'PageHeader', 'bbox': [156, 34, 409, 90], 'text': text,
                 'char_start': 0, 'char_end': len(text)}
        # Tesseract read nothing at all.
        result = block_word_geometry(block, {'id': '0', 'lines': [], 'ink_bbox': [161, 41, 411, 87]}, 1.0, 1.0)
        self.assertEqual(result.meta['method'], 'proportional')
        self.assertEqual(len(result.words), 4)
        xs = [w['bbox'] for w in result.words]
        self.assertEqual(xs[0][2], 409.0)          # first token at the inline-start (right) edge, clipped to block
        self.assertEqual(xs[-1][0], 161.0)         # last token ends at the ink's left edge
        self.assertTrue(all(b[1] == 41.0 and b[3] == 87.0 for b in xs))
        self.assertEqual([w['line'] for w in result.words], [0, 0, 0, 0])
        # Garbled OCR (low coverage) on a header → same fallback, coverage recorded.
        garbled = {'id': '0', 'ink_bbox': [161, 41, 411, 87], 'lines': [
            {'bbox': [161, 41, 411, 87], 'order': [1, 1, 1], 'words': [
                {'text': 'المَصبلْبَينَ', 'bbox': [300, 41, 411, 87], 'conf': 20},
                {'text': 'نامقل', 'bbox': [161, 41, 290, 87], 'conf': 20}]}]}
        result = block_word_geometry(block, garbled, 1.0, 1.0)
        # Either the fuzzy aligner salvages enough of the garbled words (real ink
        # positions) or the proportional fallback kicks in — never the frontend guess.
        self.assertIn(result.meta['method'], ('ocr', 'proportional'))
        self.assertEqual(len(result.words), 4)
        for word in result.words:
            x0, y0, x1, y1 = word['bbox']
            self.assertTrue(156 <= x0 < x1 <= 409 and 34 <= y0 < y1 <= 90, word)

    def test_multiline_low_coverage_still_falls_back_to_frontend(self):
        text = ' '.join(['كلمة%d' % i for i in range(12)]) + '\n' + ' '.join(['سطر%d' % i for i in range(12)])
        block = {'id': 't', 'type': 'Text', 'bbox': [0, 0, 500, 100], 'text': text, 'char_start': 0, 'char_end': len(text)}
        result = block_word_geometry(block, {'id': '0', 'lines': [], 'ink_bbox': [5, 5, 495, 95]}, 1.0, 1.0)
        self.assertIsNone(result.words)
        self.assertEqual(result.meta['method'], 'ocr')
