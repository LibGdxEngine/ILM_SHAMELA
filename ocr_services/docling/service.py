"""
Docling extraction sidecar.

    POST /parse   (multipart: file=<pdf>)  ->  {"pages": [{
                                                    "page_number": N,
                                                    "content": "...",        # plain text
                                                    "markdown": "...",        # per-page markdown
                                                    "tables": [{"markdown": "...", "html": "..."}]
                                                }]}
    GET  /health                           ->  {"status": "ok", "backend": "docling", "ocr_enabled": bool}

Docling preserves layout (tables, headings, multi-column) that Tika flattens. We group items by
prov.page_no so the response shape stays drop-in compatible with the shared OCR /parse contract
used by tesseract and chandra sidecars.
"""

import logging
import os
import tempfile
from collections import OrderedDict
from typing import Dict, List, Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger('ocr-docling')

app = FastAPI(title='Docling Extraction Sidecar', version='1.0')

DOCLING_OCR_ENABLED = os.environ.get('DOCLING_OCR_ENABLED', 'false').lower() in ('1', 'true', 'yes')
DOCLING_OCR_LANG = os.environ.get('DOCLING_OCR_LANG', 'ara,eng,fas,urd')
DOCLING_TABLE_MODE = os.environ.get('DOCLING_TABLE_MODE', 'accurate').lower()


def _build_converter():
    """
    Build a DocumentConverter with PDF options reflecting env config.

    Imported lazily so /health stays cheap and module import does not block startup
    if model weights are still being fetched.
    """
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions, TableFormerMode
    from docling.document_converter import DocumentConverter, PdfFormatOption

    pipeline_options = PdfPipelineOptions()
    pipeline_options.do_ocr = DOCLING_OCR_ENABLED
    pipeline_options.do_table_structure = True
    pipeline_options.table_structure_options.do_cell_matching = True
    pipeline_options.table_structure_options.mode = (
        TableFormerMode.ACCURATE if DOCLING_TABLE_MODE == 'accurate' else TableFormerMode.FAST
    )
    if DOCLING_OCR_ENABLED:
        pipeline_options.ocr_options.lang = [
            lang.strip() for lang in DOCLING_OCR_LANG.split(',') if lang.strip()
        ]

    return DocumentConverter(
        format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options)}
    )


# Lazy singleton — built on first /parse call, reused for the lifetime of the process.
_CONVERTER = None


def _get_converter():
    global _CONVERTER
    if _CONVERTER is None:
        logger.info('Initializing Docling DocumentConverter (ocr=%s, table_mode=%s)',
                    DOCLING_OCR_ENABLED, DOCLING_TABLE_MODE)
        _CONVERTER = _build_converter()
    return _CONVERTER


@app.get('/health')
def health():
    return {
        'status': 'ok',
        'backend': 'docling',
        'ocr_enabled': DOCLING_OCR_ENABLED,
        'table_mode': DOCLING_TABLE_MODE,
    }


@app.post('/parse')
async def parse_pdf(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail='No filename provided')

    content = await file.read()
    logger.info('Parsing %s (%d bytes) with docling', file.filename, len(content))

    try:
        pages = docling_extract_pages(content, file.filename)
    except Exception as exc:
        logger.exception('Docling extraction failed')
        raise HTTPException(status_code=500, detail=f'Extraction failed: {exc}')

    if not pages:
        raise HTTPException(status_code=500, detail='Docling produced no pages')

    logger.info('Returning %d pages, total chars=%d',
                len(pages), sum(len(p['content']) for p in pages))
    return JSONResponse({'pages': pages})


def docling_extract_pages(pdf_bytes: bytes, file_name: str) -> List[Dict]:
    """
    Convert a PDF with Docling and split the result into per-page payloads.

    Returns a list of {page_number, content, markdown, tables} dicts in ascending page order.
    Pages with no text-bearing items are skipped (matches the existing OCR contract).
    """
    converter = _get_converter()

    suffix = os.path.splitext(file_name)[1] or '.pdf'
    with tempfile.NamedTemporaryFile(prefix='docling-', suffix=suffix, delete=True) as handle:
        handle.write(pdf_bytes)
        handle.flush()
        result = converter.convert(handle.name)

    doc = result.document
    return _split_by_page(doc)


def _split_by_page(doc) -> List[Dict]:
    """Group Docling document items by page and serialize each page's text/markdown/tables."""
    pages_text: "OrderedDict[int, List[str]]" = OrderedDict()
    pages_tables: Dict[int, List[Dict]] = {}

    for item, _level in doc.iterate_items():
        page_no = _item_page(item)
        if page_no is None:
            continue

        text = _item_text(item)
        if text:
            pages_text.setdefault(page_no, []).append(text)

        table_payload = _item_table(item, doc)
        if table_payload is not None:
            pages_tables.setdefault(page_no, []).append(table_payload)

    pages: List[Dict] = []
    for page_no in sorted(pages_text.keys()):
        plain = '\n\n'.join(pages_text[page_no]).strip()
        if not plain:
            continue
        markdown = _page_markdown(doc, page_no, fallback=plain)
        pages.append({
            'page_number': page_no,
            'content': plain,
            'markdown': markdown,
            'tables': pages_tables.get(page_no, []),
        })
    return pages


def _item_page(item) -> Optional[int]:
    prov = getattr(item, 'prov', None)
    if not prov:
        return None
    page_no = getattr(prov[0], 'page_no', None)
    return int(page_no) if page_no is not None else None


def _item_text(item) -> str:
    text = getattr(item, 'text', None)
    if isinstance(text, str) and text.strip():
        return text.strip()
    return ''


def _item_table(item, doc) -> Optional[Dict]:
    """If `item` is a table, return {'markdown': ..., 'html': ...}; otherwise None."""
    if item.__class__.__name__ != 'TableItem':
        return None
    payload: Dict[str, str] = {}
    try:
        md = item.export_to_markdown()
        if md:
            payload['markdown'] = md
    except Exception:
        logger.debug('table markdown export failed', exc_info=True)
    try:
        html = item.export_to_html(doc=doc) if 'doc' in item.export_to_html.__code__.co_varnames \
            else item.export_to_html()
        if html:
            payload['html'] = html
    except Exception:
        logger.debug('table html export failed', exc_info=True)
    return payload or None


def _page_markdown(doc, page_no: int, fallback: str) -> str:
    """Export Docling's markdown filtered to a single page; fall back to plain text on error."""
    try:
        md = doc.export_to_markdown(page_no=page_no)
        if isinstance(md, str) and md.strip():
            return md
    except TypeError:
        # Older Docling: export_to_markdown does not accept page_no — return whole-doc fallback.
        try:
            md = doc.export_to_markdown()
            if isinstance(md, str) and md.strip():
                return md
        except Exception:
            pass
    except Exception:
        logger.debug('markdown export failed on page %d', page_no, exc_info=True)
    return fallback
