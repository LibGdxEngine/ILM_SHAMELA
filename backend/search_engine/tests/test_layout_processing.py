from django.test import SimpleTestCase

from search_engine.tasks import _build_layout_pages, _html_block_to_text, _layout_page_index


def _block(page, index, block_type, html, bbox):
    return {
        'id': f'/page/{page}/{block_type}/{index}',
        'block_type': block_type,
        'html': html,
        'bbox': bbox,
        'polygon': [[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[2], bbox[3]], [bbox[0], bbox[3]]],
        'page': page,
    }


def _page(page, blocks, width=1260, height=1736):
    return {
        'id': f'/page/{page}/Page/{page}',
        'block_type': 'Page',
        'html': '',
        'bbox': [0, 0, width, height],
        'children': blocks,
        'page': page,
    }


def _full_doc_page(page, blocks, width=1148, height=1820):
    """datalab/marker *full-document* export: the page container carries no
    top-level 'page' (it's None); the index lives only in the id and on blocks."""
    return {
        'id': f'/page/{page}/Page/{page}',
        'block_type': 'Page',
        'html': '',
        'bbox': [0, 0, width, height],
        'children': blocks,
        'page': None,
    }


class HtmlBlockToTextTests(SimpleTestCase):
    """The HTML stripper defines the overlay text, so its output is load-bearing."""

    def test_paragraphs_and_br_become_newlines(self):
        self.assertEqual(
            _html_block_to_text('<p>سطر أول<br/>سطر ثان</p><p>فقرة ثانية</p>'),
            'سطر أول\nسطر ثان\nفقرة ثانية',
        )

    def test_headings_and_lists(self):
        self.assertEqual(
            _html_block_to_text('<h1>عنوان</h1><ol><li>أ</li><li>ب</li></ol>'),
            'عنوان\nأ\nب',
        )

    def test_entities_and_whitespace_collapse(self):
        self.assertEqual(_html_block_to_text('<p>a &amp;  b   c</p>'), 'a & b c')

    def test_img_only_block_is_empty(self):
        self.assertEqual(_html_block_to_text('<img src="x.jpg" alt="pic"/>'), '')

    def test_none_and_empty(self):
        self.assertEqual(_html_block_to_text(None), '')
        self.assertEqual(_html_block_to_text(''), '')


class BuildLayoutPagesTests(SimpleTestCase):
    """Parse a datalab/marker-shaped JSON into reader pages with offset invariants."""

    def _layout(self):
        return {
            'children': [
                _page(0, [
                    _block(0, 0, 'Text', '<p>النص الأول</p>', [126, 85, 846, 156]),
                    _block(0, 1, 'SectionHeader', '<h1>الفصل<br/>بين</h1>', [214, 364, 756, 868]),
                    _block(0, 2, 'Picture', '<img src="a.jpg"/>', [10, 10, 50, 50]),
                ]),
                _page(1, [
                    _block(1, 0, 'Picture', '<img src="b.jpg"/>', [0, 0, 100, 100]),
                ]),
                _page(2, [
                    _block(2, 0, 'Footnote', '<p>(١) حاشية</p>', [100, 1600, 900, 1700]),
                ]),
            ],
            'metadata': {},
        }

    def test_page_numbers_are_one_based_and_contiguous(self):
        pages = _build_layout_pages(self._layout())
        self.assertEqual([p['page_number'] for p in pages], [1, 2, 3])

    def test_char_offsets_index_into_page_content(self):
        pages = _build_layout_pages(self._layout())
        for page in pages:
            for block in page['layout']['blocks']:
                self.assertEqual(
                    page['content'][block['char_start']:block['char_end']],
                    block['text'],
                )

    def test_content_is_blocks_joined_by_newline(self):
        pages = _build_layout_pages(self._layout())
        self.assertEqual(pages[0]['content'], 'النص الأول\nالفصل\nبين')

    def test_picture_blocks_are_skipped_but_page_kept(self):
        pages = _build_layout_pages(self._layout())
        self.assertEqual(pages[0]['layout']['blocks'][0]['type'], 'Text')
        self.assertEqual(len(pages[0]['layout']['blocks']), 2)
        # Picture-only page stays (keeps page numbering aligned) with no blocks.
        self.assertEqual(pages[1]['content'], '')
        self.assertEqual(pages[1]['layout']['blocks'], [])

    def test_page_dimensions_come_from_page_bbox(self):
        pages = _build_layout_pages(self._layout())
        self.assertEqual(pages[0]['layout']['width'], 1260.0)
        self.assertEqual(pages[0]['layout']['height'], 1736.0)

    def test_pages_sorted_by_page_index(self):
        layout = self._layout()
        layout['children'].reverse()
        pages = _build_layout_pages(layout)
        self.assertEqual([p['page_number'] for p in pages], [1, 2, 3])

    def test_blocks_missing_bbox_are_skipped(self):
        layout = {
            'children': [
                _page(0, [
                    {**_block(0, 0, 'Text', '<p>نص</p>', [1, 2, 3, 4]), 'bbox': None},
                    _block(0, 1, 'Text', '<p>سليم</p>', [5, 6, 7, 8]),
                ]),
            ],
        }
        pages = _build_layout_pages(layout)
        self.assertEqual(len(pages[0]['layout']['blocks']), 1)
        self.assertEqual(pages[0]['content'], 'سليم')

    def test_empty_layout(self):
        self.assertEqual(_build_layout_pages({'children': []}), [])
        self.assertEqual(_build_layout_pages({}), [])


class LayoutPageIndexTests(SimpleTestCase):
    """Page index must survive datalab's full-document export where the
    page-container 'page' is absent (regression for the all-pages-collapse bug)."""

    def test_prefers_integer_page_field(self):
        self.assertEqual(_layout_page_index({'page': 7, 'id': '/page/3/Page/3'}, 99), 7)

    def test_falls_back_to_id_when_page_is_none(self):
        self.assertEqual(_layout_page_index({'page': None, 'id': '/page/42/Page/42'}, 99), 42)

    def test_falls_back_to_position_when_no_index_available(self):
        self.assertEqual(_layout_page_index({'page': None, 'id': None}, 5), 5)

    def test_full_document_pages_are_one_based_and_contiguous(self):
        # 3 pages, page-container 'page' all None — the exact shape that produced
        # page_number=1 for every page and collapsed rendering to a single image.
        layout = {
            'children': [
                _full_doc_page(0, [_block(0, 0, 'Text', '<p>الأولى</p>', [1, 2, 3, 4])]),
                _full_doc_page(1, [_block(1, 0, 'Text', '<p>الثانية</p>', [1, 2, 3, 4])]),
                _full_doc_page(2, [_block(2, 0, 'Text', '<p>الثالثة</p>', [1, 2, 3, 4])]),
            ],
            'metadata': {},
        }
        pages = _build_layout_pages(layout)
        self.assertEqual([p['page_number'] for p in pages], [1, 2, 3])
        # Distinct page numbers → by_page won't collapse when rendering images.
        self.assertEqual(len({p['page_number'] for p in pages}), 3)

    def test_full_document_pages_sorted_by_id_index(self):
        layout = {
            'children': [
                _full_doc_page(2, [_block(2, 0, 'Text', '<p>ج</p>', [1, 2, 3, 4])]),
                _full_doc_page(0, [_block(0, 0, 'Text', '<p>أ</p>', [1, 2, 3, 4])]),
                _full_doc_page(1, [_block(1, 0, 'Text', '<p>ب</p>', [1, 2, 3, 4])]),
            ],
        }
        pages = _build_layout_pages(layout)
        self.assertEqual([p['page_number'] for p in pages], [1, 2, 3])
        self.assertEqual([p['content'] for p in pages], ['أ', 'ب', 'ج'])
