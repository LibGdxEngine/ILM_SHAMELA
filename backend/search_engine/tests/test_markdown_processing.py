from django.test import SimpleTestCase

from search_engine.tasks import _split_markdown_pages
from search_engine.utils import split_document_content_into_pages


def _sep(n, dashes=48):
    """A marker/datalab page separator line."""
    return '{%d}%s' % (n, '-' * dashes)


class SplitMarkdownPagesTests(SimpleTestCase):
    """The splitter defines the page space every KB/extraction row anchors to."""

    def test_splits_on_separators_and_drops_the_marker_lines(self):
        text = f'## باب الطهارة\n\nقال الشافعي\n\n{_sep(0)}\n\nوأخبرنا مالك\n'
        pages = _split_markdown_pages(text)

        self.assertEqual(
            pages,
            [
                {'page_number': 1, 'content': '## باب الطهارة\n\nقال الشافعي'},
                {'page_number': 2, 'content': 'وأخبرنا مالك'},
            ],
        )
        self.assertNotIn('---', pages[0]['content'])

    def test_markdown_syntax_is_preserved_verbatim(self):
        text = f'**قال** [المصدر](x)\n\n{_sep(0)}\n\n# عنوان\n'
        pages = _split_markdown_pages(text)

        self.assertEqual(pages[0]['content'], '**قال** [المصدر](x)')
        self.assertEqual(pages[1]['content'], '# عنوان')

    def test_page_numbers_are_positional_not_the_declared_value(self):
        """marker emits 0-based markers; downstream re-splits number from 1."""
        text = f'أ\n{_sep(0)}\nب\n{_sep(1)}\nج\n'
        pages = _split_markdown_pages(text)

        self.assertEqual([p['page_number'] for p in pages], [1, 2, 3])

    def test_non_contiguous_declared_numbers_still_renumber_contiguously(self):
        text = f'أ\n{_sep(7)}\nب\n{_sep(41)}\nج\n'
        pages = _split_markdown_pages(text)

        self.assertEqual([p['page_number'] for p in pages], [1, 2, 3])

    def test_blank_pages_are_dropped_without_leaving_a_numbering_gap(self):
        text = f'أ\n{_sep(0)}\n   \n{_sep(1)}\nج\n'
        pages = _split_markdown_pages(text)

        self.assertEqual(
            pages,
            [{'page_number': 1, 'content': 'أ'}, {'page_number': 2, 'content': 'ج'}],
        )

    def test_trailing_separator_yields_no_empty_final_page(self):
        text = f'أ\n{_sep(0)}\nب\n{_sep(1)}\n'
        pages = _split_markdown_pages(text)

        self.assertEqual(len(pages), 2)

    def test_leading_separator_yields_no_empty_first_page(self):
        text = f'{_sep(0)}\nأ\n'
        pages = _split_markdown_pages(text)

        self.assertEqual(pages, [{'page_number': 1, 'content': 'أ'}])

    def test_file_without_separators_returns_none(self):
        self.assertIsNone(_split_markdown_pages('# عنوان\n\nنص عادي بلا فواصل.\n'))

    def test_plain_horizontal_rule_is_not_a_separator(self):
        """A bare Markdown `---` has no {N} prefix, so it never splits."""
        self.assertIsNone(_split_markdown_pages('أ\n\n---\n\nب\n'))

    def test_crlf_line_endings(self):
        text = f'أ\r\n{_sep(0)}\r\nب\r\n'
        pages = _split_markdown_pages(text)

        self.assertEqual([p['page_number'] for p in pages], [1, 2])
        self.assertEqual(pages[1]['content'], 'ب')

    def test_indented_and_trailing_whitespace_around_the_separator(self):
        text = f'أ\n  {_sep(0)}  \nب\n'
        pages = _split_markdown_pages(text)

        self.assertEqual(len(pages), 2)

    def test_separator_mid_line_is_not_a_boundary(self):
        text = 'رأى {1}------------- في السطر\n'
        self.assertIsNone(_split_markdown_pages(text))

    def test_pages_rejoin_and_resplit_identically(self):
        """`\\f`-joined pages must survive split_document_content_into_pages.

        That round trip is what keeps the reader, in-document search and the
        extraction pipelines agreeing on page numbers.
        """
        text = f'أ\n{_sep(0)}\nب\n{_sep(7)}\nج\n'
        pages = _split_markdown_pages(text)
        rebuilt = split_document_content_into_pages(
            '\n\f\n'.join(p['content'] for p in pages))

        self.assertEqual(pages, rebuilt)

    def test_short_dash_run_still_splits(self):
        text = f'أ\n{_sep(0, dashes=3)}\nب\n'
        pages = _split_markdown_pages(text)

        self.assertEqual(len(pages), 2)
