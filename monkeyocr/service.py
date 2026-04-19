"""
OCR microservice. Exposes a single endpoint:

    POST /parse  (multipart: file=<pdf>)  ->  {"pages": [{"page_number": N, "content": "..."}]}

Default backend: Tesseract with Arabic + English + Farsi + Urdu language packs.
Swap in PaddleOCR-VL or MonkeyOCR by changing the Dockerfile + this file.
"""

import logging
import os
from typing import List, Dict

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger('ocr-service')

app = FastAPI(title='OCR Microservice', version='1.0')

OCR_LANG = os.environ.get('OCR_LANG', 'ara+eng+fas+urd')
OCR_DPI = int(os.environ.get('OCR_DPI', '200'))


@app.get('/health')
def health():
    return {'status': 'ok', 'backend': 'tesseract', 'lang': OCR_LANG}


@app.post('/parse')
async def parse_pdf(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail='No filename provided')

    content = await file.read()
    logger.info('Parsing %s (%d bytes) with tesseract', file.filename, len(content))

    try:
        pages = tesseract_extract_pages(content)
    except Exception as exc:
        logger.exception('OCR failed')
        raise HTTPException(status_code=500, detail=f'OCR failed: {exc}')

    if not pages:
        raise HTTPException(status_code=500, detail='OCR produced no pages')

    logger.info('Returning %d pages, total chars=%d',
                len(pages), sum(len(p['content']) for p in pages))
    return JSONResponse({'pages': pages})


def tesseract_extract_pages(pdf_bytes: bytes) -> List[Dict]:
    from pdf2image import convert_from_bytes
    import pytesseract

    images = convert_from_bytes(pdf_bytes, dpi=OCR_DPI, fmt='png')
    logger.info('Rendered %d pages at %d dpi', len(images), OCR_DPI)

    pages = []
    for idx, img in enumerate(images, start=1):
        if img.mode != 'RGB':
            img = img.convert('RGB')
        try:
            text = pytesseract.image_to_string(img, lang=OCR_LANG)
        except pytesseract.TesseractError as exc:
            logger.warning('Tesseract failed on page %d: %s', idx, exc)
            text = ''
        pages.append({'page_number': idx, 'content': (text or '').strip()})
    return pages
