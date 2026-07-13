import json
import logging
import os
import re
from html.parser import HTMLParser
from io import BytesIO

from celery import shared_task
from django.core.files.base import ContentFile
from django.db import transaction
from django.utils import timezone
from langdetect import LangDetectException, detect
from PIL import Image
from tika import parser

from core.metrics import increment_metric
from core.request_id import reset_request_id, set_request_id
from .documents import DocumentIndex
from .models import Author, Category, Document, DocumentChunk
from .semantic import build_batch_embedding, build_embedding
from .utils import split_document_content_into_pages
from . import ocr as ocr_registry
from .ocr import OCRUnavailable

logger = logging.getLogger(__name__)

MIN_PDF_TEXT_CHARS = 100
MIN_PDF_CHARS_PER_PAGE = 100


class RetriableProcessingError(Exception):
    """Raised when a processing step can be retried safely."""


def _is_pdf(document):
    file_name = (document.file.name or '').lower()
    return file_name.endswith('.pdf')


def _count_pdf_pages(file_content):
    try:
        from pdf2image import pdfinfo_from_bytes
        info = pdfinfo_from_bytes(file_content)
        return int(info.get('Pages', 0)) or None
    except Exception:
        return None


def _generate_pdf_thumbnail(document, file_content):
    """
    Best-effort first-page thumbnail generation for PDF files.
    Returns True when thumbnail is generated and attached to the model instance.
    """
    if not _is_pdf(document) or document.thumbnail:
        return False

    try:
        # Import lazily so missing optional dependency does not break processing.
        from pdf2image import convert_from_bytes
    except Exception:
        logger.warning(
            '[THUMBNAIL] pdf2image not available; skipping thumbnail generation',
            extra={'document_id': document.id},
        )
        return False

    try:
        pages = convert_from_bytes(
            file_content,
            first_page=1,
            last_page=1,
            dpi=150,
        )
        if not pages:
            return False

        image = pages[0]
        if image.mode != 'RGB':
            image = image.convert('RGB')
        image.thumbnail((480, 480), Image.Resampling.LANCZOS)

        output = BytesIO()
        image.save(output, format='JPEG', quality=85, optimize=True)
        output.seek(0)

        original_name = os.path.splitext(os.path.basename(document.file.name))[0] or f'document_{document.id}'
        thumbnail_name = f'{original_name}_thumbnail.jpg'
        document.thumbnail.save(thumbnail_name, ContentFile(output.read()), save=False)
        return True
    except Exception:
        logger.warning(
            '[THUMBNAIL] Failed generating PDF thumbnail',
            exc_info=True,
            extra={'document_id': document.id},
        )
        return False


def _structured_payload(page):
    """Pluck layout-aware extras off a page dict. Returns None when nothing structured is present."""
    payload = {}
    markdown = page.get('markdown') if isinstance(page, dict) else None
    if isinstance(markdown, str) and markdown.strip():
        payload['markdown'] = markdown
    tables = page.get('tables') if isinstance(page, dict) else None
    if isinstance(tables, list) and tables:
        payload['tables'] = tables
    return payload or None


# Block types in the datalab/marker OCR JSON that carry no overlay text.
_LAYOUT_SKIPPED_BLOCK_TYPES = {'Picture'}


class _HTMLTextExtractor(HTMLParser):
    """Strip an OCR block's HTML fragment to plain text (<br>/<p>/<li>… → newline)."""

    _NEWLINE_END_TAGS = {'p', 'li', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div'}
    _SPACE_END_TAGS = {'td', 'th'}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag == 'br':
            self.parts.append('\n')

    def handle_endtag(self, tag):
        if tag in self._NEWLINE_END_TAGS:
            self.parts.append('\n')
        elif tag in self._SPACE_END_TAGS:
            self.parts.append(' ')

    def handle_data(self, data):
        self.parts.append(data)

    def text(self):
        raw = ''.join(self.parts)
        lines = [re.sub(r'[ \t]+', ' ', line).strip() for line in raw.split('\n')]
        return '\n'.join(line for line in lines if line)


def _html_block_to_text(html):
    extractor = _HTMLTextExtractor()
    extractor.feed(html or '')
    extractor.close()
    return extractor.text()


def _load_ocr_layout(document):
    """Read and parse the uploaded datalab/marker OCR JSON."""
    document.ocr_layout.open('rb')
    try:
        return json.load(document.ocr_layout)
    finally:
        document.ocr_layout.close()


def _layout_page_index(raw_page, position):
    """
    0-based page index for a datalab/marker page container.

    Per-page exports set a top-level integer 'page'. Full-document exports leave
    the page-container 'page' absent (None) and encode the index only in the id
    ('/page/N/Page/N'); their leaf blocks carry the 'page'. Fall back to the
    container's position (children are emitted in page order) when neither exists.
    """
    page = raw_page.get('page')
    if isinstance(page, int):
        return page
    match = re.match(r'/page/(\d+)', str(raw_page.get('id') or ''))
    if match:
        return int(match.group(1))
    return position


def _build_layout_pages(layout_data):
    """
    Convert a datalab/marker OCR JSON into reader pages.

    Returns [{page_number, content, layout}] where layout is
    {width, height, blocks: [{id, type, bbox, text, char_start, char_end}]}.

    Invariant shared with the frontend overlay and stored highlight/note offsets:
    page content == '\\n'.join(block texts), and each block's char_start/char_end
    index into that exact string.
    """
    raw_pages = layout_data.get('children') or []
    indexed_pages = sorted(
        ((_layout_page_index(raw_page, position), raw_page)
         for position, raw_page in enumerate(raw_pages)),
        key=lambda item: item[0],
    )
    pages = []
    for page_index, raw_page in indexed_pages:
        page_bbox = raw_page.get('bbox') or []
        width = float(page_bbox[2]) if len(page_bbox) == 4 and page_bbox[2] else 1.0
        height = float(page_bbox[3]) if len(page_bbox) == 4 and page_bbox[3] else 1.0
        blocks = []
        texts = []
        offset = 0
        for raw_block in raw_page.get('children') or []:
            block_type = raw_block.get('block_type') or ''
            if block_type in _LAYOUT_SKIPPED_BLOCK_TYPES:
                continue
            bbox = raw_block.get('bbox')
            if not isinstance(bbox, (list, tuple)) or len(bbox) != 4:
                continue
            text = _html_block_to_text(raw_block.get('html'))
            if not text:
                continue
            blocks.append({
                'id': raw_block.get('id') or f'/page/{page_index}/Block/{len(blocks)}',
                'type': block_type,
                'bbox': [round(float(value), 2) for value in bbox],
                'text': text,
                'char_start': offset,
                'char_end': offset + len(text),
            })
            texts.append(text)
            offset += len(text) + 1  # +1 for the '\n' join separator
        pages.append({
            'page_number': page_index + 1,
            'content': '\n'.join(texts),
            'layout': {'width': width, 'height': height, 'blocks': blocks},
        })
    return pages


def _delete_existing_page_images(document):
    """Best-effort removal of previously rendered page images (idempotent reprocessing)."""
    for chunk in document.chunks.exclude(page_image='').exclude(page_image__isnull=True):
        try:
            chunk.page_image.delete(save=False)
        except Exception:
            logger.warning(
                '[LAYOUT] Failed deleting stale page image',
                exc_info=True,
                extra={'document_id': document.id, 'page_number': chunk.page_number},
            )


def _render_layout_page_images(document, file_content, chunk_objects, batch_size=10, dpi=150):
    """
    Render each PDF page to a WebP image and attach it to the matching (unsaved)
    chunk via FieldFile.save(save=False). Renders in small batches to bound memory
    on large books.
    """
    from pdf2image import convert_from_bytes  # poppler already required for thumbnails

    by_page = {chunk.page_number: chunk for chunk in chunk_objects}
    if not by_page:
        return
    if len(by_page) != len(chunk_objects):
        # Duplicate page numbers collapse the dict and silently drop page images
        # (e.g. a layout JSON whose page indices all resolve to the same value).
        # Fail loudly so processing is marked failed instead of rendering blanks.
        raise ValueError(
            f'Layout chunks have duplicate page numbers: {len(chunk_objects)} chunks '
            f'collapsed to {len(by_page)} distinct pages — page images would be lost.'
        )
    max_page = max(by_page)
    for first_page in range(1, max_page + 1, batch_size):
        last_page = min(first_page + batch_size - 1, max_page)
        images = convert_from_bytes(
            file_content,
            first_page=first_page,
            last_page=last_page,
            dpi=dpi,
        )
        for index, image in enumerate(images):
            page_number = first_page + index
            chunk = by_page.get(page_number)
            if chunk is None:
                continue
            if image.mode != 'RGB':
                image = image.convert('RGB')
            output = BytesIO()
            image.save(output, format='WEBP', quality=80)
            output.seek(0)
            chunk.page_image.save(
                f'{document.id}/page-{page_number:04d}.webp',
                ContentFile(output.read()),
                save=False,
            )


def _extract_authors_and_categories(metadata):
    authors = []
    categories = []
    if not metadata:
        return authors, categories

    author_fields = ['meta:author', 'Author', 'creator', 'dc:creator', 'meta:creator']
    for field in author_fields:
        value = metadata.get(field)
        if not value:
            continue
        if isinstance(value, list):
            authors.extend([str(item).strip() for item in value if item])
        else:
            authors.extend(
                [part.strip() for part in str(value).replace(';', ',').split(',') if part.strip()]
            )

    category_fields = ['meta:keywords', 'Keywords', 'dc:subject', 'subject', 'category', 'categories']
    for field in category_fields:
        value = metadata.get(field)
        if not value:
            continue
        if isinstance(value, list):
            categories.extend([str(item).strip() for item in value if item])
        else:
            categories.extend(
                [part.strip() for part in str(value).replace(';', ',').split(',') if part.strip()]
            )

    # Preserve order while removing duplicates.
    return list(dict.fromkeys(authors)), list(dict.fromkeys(categories))


@shared_task(bind=True, max_retries=5, default_retry_delay=30)
def process_document_task(self, doc_id):
    """
    Process document text extraction and indexing with retry-aware failure handling.
    """
    task_id = self.request.id or 'unknown-task'
    token = set_request_id(f'task:{task_id}')
    log_extra = {'task_id': task_id, 'document_id': doc_id}

    logger.info('[PROCESS] Started document processing', extra=log_extra)
    try:
        document = Document.objects.get(id=doc_id)
    except Document.DoesNotExist:
        logger.error('[PROCESS] Document not found', extra=log_extra)
        increment_metric('document_processing_failure_total', 1.0, reason='document_not_found')
        reset_request_id(token)
        return {'status': 'error', 'reason': 'document_not_found', 'doc_id': doc_id}

    document.processing_status = Document.ProcessingStatus.PROCESSING
    document.processing_error = None
    document.processing_started_at = timezone.now()
    document.processing_attempts += 1
    document.save(
        update_fields=[
            'processing_status',
            'processing_error',
            'processing_started_at',
            'processing_attempts',
        ]
    )

    try:
        if not document.file:
            raise ValueError('Document has no attached file')

        try:
            file_content = document.file.read()
        except Exception as exc:
            raise RetriableProcessingError(f'Failed reading file: {exc}') from exc

        layout_pages: list | None = None
        ocr_pages: list | None = None
        engine_used: str = ''
        authors: list = []
        categories: list = []

        if document.ocr_layout and _is_pdf(document):
            # A datalab/marker OCR JSON was supplied — it *is* the OCR output, so
            # skip Tika/OCR entirely and build page text + geometry from it.
            try:
                layout_pages = _build_layout_pages(_load_ocr_layout(document))
            except Exception as exc:
                raise ValueError(f'OCR layout parsing failed: {exc}') from exc
            if not layout_pages:
                raise ValueError('OCR layout JSON contains no pages')
            extracted_text = '\n\f\n'.join(p['content'] for p in layout_pages)
            engine_used = 'datalab-json'
            logger.info(
                '[LAYOUT] Built pages from OCR layout JSON',
                extra={
                    'document_id': document.id,
                    'page_count': len(layout_pages),
                    'char_count': len(extracted_text),
                },
            )
        else:
            try:
                parsed = parser.from_buffer(file_content)
            except Exception as exc:
                # Parser failures are treated as terminal to avoid repeated expensive loops.
                raise ValueError(f'Text extraction failed: {exc}') from exc

            extracted_text = parsed.get('content') or ''
            metadata = parsed.get('metadata') or {}
            authors, categories = _extract_authors_and_categories(metadata)

            if _is_pdf(document):
                requested = (document.ocr_engine or Document.OCREngine.AUTO).strip() or Document.OCREngine.AUTO
                engine_name: str | None = None

                if requested == Document.OCREngine.NONE:
                    engine_name = None
                elif requested == Document.OCREngine.AUTO:
                    tika_chars = len(extracted_text.strip())
                    pdf_page_count = _count_pdf_pages(file_content)
                    chars_per_page = (tika_chars / pdf_page_count) if pdf_page_count else tika_chars
                    needs_ocr = tika_chars < MIN_PDF_TEXT_CHARS or chars_per_page < MIN_PDF_CHARS_PER_PAGE
                    if needs_ocr and ocr_registry.is_any_engine_configured():
                        engine_name = ocr_registry.DEFAULT_ENGINE
                        logger.info(
                            '[OCR] Auto fallback — tika text insufficient, using default engine',
                            extra={
                                'document_id': document.id,
                                'tika_chars': tika_chars,
                                'pdf_pages': pdf_page_count,
                                'chars_per_page': round(chars_per_page, 1),
                                'engine': engine_name,
                            },
                        )
                else:
                    engine_name = requested
                    logger.info(
                        '[OCR] Explicit engine requested, overriding tika output',
                        extra={'document_id': document.id, 'engine': engine_name},
                    )

                if engine_name:
                    try:
                        engine = ocr_registry.get_engine(engine_name)
                        ocr_pages = engine.parse(file_content, document.file.name)
                        extracted_text = '\n\f\n'.join(p['content'] for p in ocr_pages)
                        engine_used = engine_name
                        logger.info(
                            '[OCR] Engine %s extracted text',
                            engine_name,
                            extra={
                                'document_id': document.id,
                                'page_count': len(ocr_pages),
                                'char_count': len(extracted_text),
                                'engine': engine_name,
                            },
                        )
                    except OCRUnavailable as exc:
                        if requested == Document.OCREngine.AUTO:
                            logger.warning(
                                '[OCR] Engine %s unavailable, continuing with original text: %s',
                                engine_name, exc,
                                extra={'document_id': document.id, 'engine': engine_name},
                            )
                        else:
                            # Admin explicitly asked for this engine — fail loudly so they see it.
                            raise

        try:
            detected_language = detect(extracted_text) if extracted_text.strip() else None
        except LangDetectException:
            detected_language = None

        semantic_input = '\n'.join(
            [
                document.title or '',
                document.description or '',
                extracted_text,
            ]
        )
        semantic_vector = build_embedding(semantic_input, task_type="RETRIEVAL_DOCUMENT")

        # Per-chunk embeddings for in-document semantic search
        if layout_pages is not None:
            pages = layout_pages
        elif ocr_pages:
            pages = ocr_pages
        else:
            pages = split_document_content_into_pages(extracted_text)
        chunk_texts = [p['content'] for p in pages]
        chunk_embeddings = build_batch_embedding(chunk_texts, task_type="RETRIEVAL_DOCUMENT")
        chunk_objects = [
            DocumentChunk(
                document=document,
                chunk_index=idx,
                page_number=p['page_number'],
                content=p['content'],
                structured_content=_structured_payload(p),
                layout=p.get('layout'),
                embedding=chunk_embeddings[idx] if idx < len(chunk_embeddings) else [],
            )
            for idx, p in enumerate(pages)
        ]

        if layout_pages is not None:
            # Page images are essential for the PDF-overlay reader — let failures
            # propagate so processing is marked failed instead of silently degrading.
            _delete_existing_page_images(document)
            _render_layout_page_images(document, file_content, chunk_objects)

        try:
            _generate_pdf_thumbnail(document, file_content)
        except Exception:
            logger.warning(
                '[THUMBNAIL] Unexpected thumbnail generation failure',
                exc_info=True,
                extra={'document_id': document.id},
            )

        with transaction.atomic():
            document.content = extracted_text
            document.language = detected_language
            document.processed = False
            document.processing_status = Document.ProcessingStatus.PROCESSING
            document.processing_error = None
            document.semantic_vector = semantic_vector
            document.ocr_engine_used = engine_used
            document.has_layout = layout_pages is not None
            document.save()

            # Idempotent: clear old chunks then bulk-insert new ones
            DocumentChunk.objects.filter(document=document).delete()
            if chunk_objects:
                DocumentChunk.objects.bulk_create(chunk_objects, batch_size=500)

            for author_name in authors:
                author, _ = Author.objects.get_or_create(
                    name=author_name,
                    defaults={'alternate_names': []},
                )
                document.authors.add(author)

            for category_name in categories:
                category, _ = Category.objects.get_or_create(name=category_name)
                document.categories.add(category)

        try:
            index_doc = DocumentIndex(meta={'id': document.id})
            index_doc.prepare(document)
            index_doc.save(refresh=True)
        except Exception as exc:
            raise RetriableProcessingError(f'Indexing failed: {exc}') from exc

        document.processed = True
        document.processing_status = Document.ProcessingStatus.SUCCEEDED
        document.processing_error = None
        document.processing_completed_at = timezone.now()
        document.save(
            update_fields=[
                'processed',
                'processing_status',
                'processing_error',
                'processing_completed_at',
            ]
        )

        increment_metric('document_processing_success_total', 1.0)
        logger.info(
            '[PROCESS] Completed successfully',
            extra={**log_extra, 'status_code': 200},
        )
        return {
            'status': 'success',
            'doc_id': doc_id,
            'language': detected_language,
            'content_length': len(extracted_text),
            'authors': authors,
            'categories': categories,
        }

    except RetriableProcessingError as exc:
        retries = self.request.retries
        if retries < self.max_retries:
            countdown = min(30 * (2 ** retries), 600)
            increment_metric('document_processing_retries_total', 1.0)
            document.processing_status = Document.ProcessingStatus.PENDING
            document.processing_error = str(exc)
            document.processed = False
            document.save(update_fields=['processing_status', 'processing_error', 'processed'])
            logger.warning(
                '[PROCESS] Retrying after transient failure',
                extra={**log_extra, 'status_code': 503},
            )
            raise self.retry(exc=exc, countdown=countdown)

        document.processing_status = Document.ProcessingStatus.FAILED
        document.processing_error = str(exc)
        document.processing_completed_at = timezone.now()
        document.save(
            update_fields=['processing_status', 'processing_error', 'processing_completed_at']
        )
        increment_metric('document_processing_failure_total', 1.0, reason='retries_exhausted')
        logger.error('[PROCESS] Retries exhausted', extra=log_extra)
        return {'status': 'error', 'reason': 'retries_exhausted', 'doc_id': doc_id}

    except Exception as exc:
        document.processing_status = Document.ProcessingStatus.FAILED
        document.processing_error = str(exc)
        document.processing_completed_at = timezone.now()
        document.processed = False
        document.save(
            update_fields=[
                'processing_status',
                'processing_error',
                'processing_completed_at',
                'processed',
            ]
        )
        increment_metric('document_processing_failure_total', 1.0, reason='terminal_error')
        logger.error('[PROCESS] Terminal failure', exc_info=True, extra=log_extra)
        return {'status': 'error', 'reason': 'terminal_error', 'error': str(exc), 'doc_id': doc_id}

    finally:
        reset_request_id(token)
