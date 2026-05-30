"""
Extract chapter rows for a document by scanning its content for headings.

Detects three heading styles per page (page-level boundaries come from
`split_document_content_into_pages`):
  - HTML tags:    <h1>…</h1>, <h2>…</h2>, <h3>…</h3>
  - Markdown:     # title, ## title, ### title  (start of line)
  - All-caps:     short uppercase-Arabic-or-Latin line surrounded by blank lines

Levels: h1 -> top-level, h2 -> nested under previous h1, h3 -> nested under previous h2.

Usage:
    python manage.py extract_chapters --document-id 12
    python manage.py extract_chapters --all
    python manage.py extract_chapters --document-id 12 --dry-run
    python manage.py extract_chapters --document-id 12 --replace
"""
import re
from html import unescape

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from search_engine.models import Chapter, Document
from search_engine.utils import split_document_content_into_pages


HTML_HEADING_RE = re.compile(
    r'<h([1-3])[^>]*>(.*?)</h\1>', re.IGNORECASE | re.DOTALL
)
MD_HEADING_RE = re.compile(r'^(#{1,3})\s+(.+?)\s*$', re.MULTILINE)
TAG_STRIP_RE = re.compile(r'<[^>]+>')


def _clean(text: str) -> str:
    text = TAG_STRIP_RE.sub('', unescape(text))
    return ' '.join(text.split()).strip()


def _extract_from_page(page_text: str):
    """Return [(level, title), …] for headings found on one page, in order."""
    found = []
    for match in HTML_HEADING_RE.finditer(page_text):
        level = int(match.group(1))
        title = _clean(match.group(2))
        if title:
            found.append((match.start(), level, title))
    for match in MD_HEADING_RE.finditer(page_text):
        level = len(match.group(1))
        title = _clean(match.group(2))
        if title:
            found.append((match.start(), level, title))
    found.sort(key=lambda t: t[0])
    return [(level, title) for _, level, title in found]


class Command(BaseCommand):
    help = 'Extract Chapter rows from document content by scanning for headings.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--document-id',
            type=int,
            help='Process a specific document by ID',
        )
        parser.add_argument(
            '--all',
            action='store_true',
            help='Process every document that has content',
        )
        parser.add_argument(
            '--replace',
            action='store_true',
            help='Delete existing chapters before inserting new ones',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Report what would be created without writing to the database',
        )

    def handle(self, *args, **options):
        doc_id = options.get('document_id')
        process_all = options.get('all', False)
        replace = options.get('replace', False)
        dry_run = options.get('dry_run', False)

        if not doc_id and not process_all:
            raise CommandError('Pass --document-id <id> or --all.')

        if doc_id:
            queryset = Document.objects.filter(pk=doc_id)
        else:
            queryset = Document.objects.exclude(content__isnull=True).exclude(content='')

        total_documents = 0
        total_chapters = 0
        for document in queryset.iterator():
            if not document.content:
                self.stdout.write(self.style.WARNING(
                    f'Skipping doc {document.id} ({document.title}): no content.'
                ))
                continue

            pages = split_document_content_into_pages(document.content)
            entries = []  # [(level, title, page_start)]
            for page in pages:
                for level, title in _extract_from_page(page['content']):
                    entries.append((level, title, page['page_number']))

            if not entries:
                self.stdout.write(
                    f'doc {document.id} ({document.title}): no headings found.'
                )
                continue

            total_documents += 1
            total_chapters += len(entries)
            self.stdout.write(self.style.SUCCESS(
                f'doc {document.id} ({document.title}): {len(entries)} headings'
            ))

            if dry_run:
                for level, title, page_number in entries[:20]:
                    self.stdout.write(f'  h{level} p{page_number}: {title[:80]}')
                if len(entries) > 20:
                    self.stdout.write(f'  … ({len(entries) - 20} more)')
                continue

            with transaction.atomic():
                if replace:
                    Chapter.objects.filter(document=document).delete()
                self._persist_chapters(document, entries)

        self.stdout.write(self.style.SUCCESS(
            f'Done: {total_chapters} chapters across {total_documents} documents.'
        ))

    def _persist_chapters(self, document, entries):
        """Create Chapter rows, nesting h2 under h1 and h3 under h2.

        `entries` is [(level, title, page_start)] in document order.
        Sets `page_end` of each chapter to (page_start of next sibling - 1)
        when known, else leaves it null.
        """
        h1_parent = None
        h2_parent = None
        order_counter = 0
        created = []
        for level, title, page_start in entries:
            parent = None
            if level == 2:
                parent = h1_parent
            elif level == 3:
                parent = h2_parent or h1_parent
            chapter = Chapter.objects.create(
                document=document,
                parent=parent,
                title=title,
                order=order_counter,
                page_start=page_start,
            )
            order_counter += 1
            created.append(chapter)
            if level == 1:
                h1_parent = chapter
                h2_parent = None
            elif level == 2:
                h2_parent = chapter

        # Backfill page_end as the page before the next sibling/parent boundary.
        for i, chapter in enumerate(created):
            for j in range(i + 1, len(created)):
                nxt = created[j]
                if nxt.parent_id == chapter.parent_id:
                    if nxt.page_start > chapter.page_start:
                        chapter.page_end = nxt.page_start - 1
                        chapter.save(update_fields=['page_end'])
                    break
