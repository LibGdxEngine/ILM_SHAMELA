"""
Tesseract OCR sidecar.

    POST /parse   (multipart: file=<pdf>)  ->  {"pages": [{"page_number": N, "content": "..."}]}
    POST /words   (multipart: file=<page image>; form: regions=<json>, lang, psm, pad, dpi)
                  ->  {"width": W, "height": H,
                       "regions": [{"id": ..., "lines": [{"bbox": [...], "order": [b, p, l],
                                                          "words": [{"text", "bbox", "conf"}]}],
                                    "ink_bbox": [x0, y0, x1, y1] | null,
                                    "error"?: "..."}]}
    Region objects: {"id", "bbox", "psm"?, "lang"?, "passes"?, "ink_only"?}. `ink_bbox` is the
    extent of dark pixels inside the region (speck-filtered) — the printed extent of a header
    or page number even when tesseract cannot read it. `ink_only` skips OCR for the region.
    GET  /health                           ->  {"status": "ok", "backend": "tesseract", "lang": "...",
                                                "features": ["parse", "words"]}

`/words` returns WORD bounding boxes for a page image: the caller (the Django
word-geometry task) crops nothing itself — it sends the full page render once plus
the paragraph regions it already knows from the layout JSON, and gets back, per
region, tesseract's lines and words with coordinates translated to full-image
pixel space. Words are returned in tesseract's own `word_num` order, which is the
logical (reading) order — for Arabic that is right-to-left; callers must not
re-sort by x.
"""

import json
import logging
import math
import os
import statistics
from io import BytesIO
from typing import Dict, List, Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger('ocr-tesseract')

app = FastAPI(title='Tesseract OCR Sidecar', version='1.1')

OCR_LANG = os.environ.get('OCR_LANG', 'ara+eng+fas+urd')
OCR_DPI = int(os.environ.get('OCR_DPI', '200'))
# Word geometry defaults to a single script: mixing `eng` into Arabic pages makes
# tesseract hallucinate Latin fragments over decorative glyphs.
OCR_WORDS_LANG = os.environ.get('OCR_WORDS_LANG', 'ara')
# Below this median word height (px) tesseract's LSTM degrades sharply; the region
# is re-run at 2x.
MIN_WORD_PX = 20
UPSCALE_FACTOR = 2
# Tesseract's text-line finding is unstable on paragraph crops: the same block
# loses a different printed line depending on a few pixels of crop padding or
# the segmentation mode. Each region is therefore OCR'd several times and the
# line sets are unioned (a later pass's line is added when no earlier line
# overlaps its vertical centre; overlapping lines keep the version with more
# words). Passes are "psm:extra_pad" pairs; the first is the base pass and uses
# the region's own psm when one is given. OCR_WORDS_PASSES="6:0" = single pass.
def _parse_passes(spec: str) -> List[tuple]:
    passes = []
    for item in (spec or '').split(','):
        item = item.strip()
        if not item:
            continue
        psm_part, _, pad_part = item.partition(':')
        try:
            passes.append((int(psm_part), int(pad_part or 0)))
        except ValueError:
            continue
    return passes or [(6, 0)]


OCR_WORDS_PASSES = _parse_passes(os.environ.get('OCR_WORDS_PASSES', '6:0,6:10,11:0'))
# Ink extent: pixels darker than this (0-255 grayscale) count as ink after a 3x3
# erosion that drops isolated specks.
INK_THRESHOLD = 135
INK_PAD = 2


@app.get('/health')
def health():
    return {
        'status': 'ok',
        'backend': 'tesseract',
        'lang': OCR_LANG,
        'words_lang': OCR_WORDS_LANG,
        'features': ['parse', 'words'],
    }


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


@app.post('/words')
async def words(
    file: UploadFile = File(...),
    regions: Optional[str] = Form(None),
    lang: Optional[str] = Form(None),
    psm: int = Form(6),
    pad: int = Form(6),
    dpi: Optional[int] = Form(None),
):
    """Word bounding boxes for the given regions of one page image."""
    from PIL import Image

    content = await file.read()
    try:
        image = Image.open(BytesIO(content))
        image.load()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f'Unreadable image: {exc}')
    if image.mode != 'L':
        image = image.convert('L')

    if regions:
        try:
            parsed_regions = json.loads(regions)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f'regions is not valid JSON: {exc}')
        if not isinstance(parsed_regions, list):
            raise HTTPException(status_code=400, detail='regions must be a JSON list')
    else:
        parsed_regions = [{'id': 'page', 'bbox': [0, 0, image.width, image.height]}]

    lang = (lang or OCR_WORDS_LANG).strip() or OCR_WORDS_LANG
    logger.info('Word boxes for %s (%dx%d, %d regions, lang=%s, psm=%d)',
                file.filename, image.width, image.height, len(parsed_regions), lang, psm)

    results = []
    for region in parsed_regions:
        if not isinstance(region, dict):
            results.append({'id': None, 'lines': [], 'error': 'region must be an object'})
            continue
        results.append(ocr_region(image, region, lang=lang, default_psm=psm, pad=pad, dpi=dpi))

    word_total = sum(len(line['words']) for r in results for line in r['lines'])
    logger.info('Returning %d regions, %d words', len(results), word_total)
    return JSONResponse({'width': image.width, 'height': image.height, 'regions': results})


def ocr_region(image, region: Dict, *, lang: str, default_psm: int, pad: int, dpi: Optional[int]) -> Dict:
    """OCR one region (image-pixel bbox) and return its lines/words in full-image coordinates."""
    region_id = region.get('id')
    bbox = region.get('bbox')
    try:
        x0, y0, x1, y1 = (float(v) for v in bbox)
    except (TypeError, ValueError):
        return {'id': region_id, 'lines': [], 'error': 'invalid bbox'}

    try:
        region_psm = int(region.get('psm') or default_psm)
    except (TypeError, ValueError):
        region_psm = default_psm

    passes = OCR_WORDS_PASSES
    if isinstance(region.get('passes'), str):
        passes = _parse_passes(region['passes'])

    pad = max(0, int(pad))
    try:
        ink_bbox = _ink_bbox(image, x0, y0, x1, y1)
    except Exception as exc:  # noqa: BLE001
        logger.warning('Ink extent failed on region %s: %s', region_id, exc)
        ink_bbox = None
    if region.get('ink_only'):
        return {'id': region_id, 'lines': [], 'ink_bbox': ink_bbox}

    region_lang = region.get('lang') if isinstance(region.get('lang'), str) and region.get('lang').strip() else lang
    try:
        lines = None
        for index, (pass_psm, extra_pad) in enumerate(passes):
            # The base pass honours the caller's psm (e.g. 7 for one-line blocks);
            # later passes deliberately vary the segmentation mode.
            psm_used = region_psm if index == 0 else pass_psm
            result = _ocr_pass(image, x0, y0, x1, y1, pad=pad + extra_pad, lang=region_lang, psm=psm_used, dpi=dpi)
            if result is None:
                if index == 0:
                    return {'id': region_id, 'lines': [], 'ink_bbox': ink_bbox, 'error': 'empty crop'}
                continue
            lines = result if lines is None else _merge_lines(lines, result)
        lines = lines or []
    except Exception as exc:  # noqa: BLE001 — one bad region must not fail the page
        logger.warning('Tesseract failed on region %s: %s', region_id, exc)
        return {'id': region_id, 'lines': [], 'ink_bbox': ink_bbox, 'error': str(exc)[:300]}
    return {'id': region_id, 'lines': lines, 'ink_bbox': ink_bbox}


def _ink_bbox(image, x0, y0, x1, y1) -> Optional[List[float]]:
    """Bounding box of the dark (ink) pixels inside the region, full-image coordinates."""
    from PIL import ImageFilter, ImageOps

    left = max(0, int(math.floor(min(x0, x1))) - INK_PAD)
    top = max(0, int(math.floor(min(y0, y1))) - INK_PAD)
    right = min(image.width, int(math.ceil(max(x0, x1))) + INK_PAD)
    bottom = min(image.height, int(math.ceil(max(y0, y1))) + INK_PAD)
    if right - left < 3 or bottom - top < 3:
        return None
    crop = image.crop((left, top, right, bottom))
    # Invert so ink is bright, erode 3x3 to drop specks, threshold, take the bbox.
    ink = ImageOps.invert(crop).filter(ImageFilter.MinFilter(3)).point(
        lambda p: 255 if p > (255 - INK_THRESHOLD) else 0
    )
    box = ink.getbbox()
    if not box:
        return None
    return [
        float(left + max(0, box[0] - 1)),
        float(top + max(0, box[1] - 1)),
        float(left + min(crop.width, box[2] + 1)),
        float(top + min(crop.height, box[3] + 1)),
    ]


def _ocr_pass(image, x0, y0, x1, y1, *, pad: int, lang: str, psm: int, dpi: Optional[int]) -> Optional[List[Dict]]:
    """One tesseract run over the padded crop; lines/words translated to full-image coords."""
    left = max(0, int(math.floor(min(x0, x1))) - pad)
    top = max(0, int(math.floor(min(y0, y1))) - pad)
    right = min(image.width, int(math.ceil(max(x0, x1))) + pad)
    bottom = min(image.height, int(math.ceil(max(y0, y1))) + pad)
    if right - left < 2 or bottom - top < 2:
        return None

    crop = image.crop((left, top, right, bottom))
    lines = _run_tesseract(crop, lang=lang, psm=psm, dpi=dpi, scale=1)
    heights = [w['bbox'][3] - w['bbox'][1] for line in lines for w in line['words']]
    if heights and statistics.median(heights) < MIN_WORD_PX:
        from PIL import Image
        upscaled = crop.resize(
            (crop.width * UPSCALE_FACTOR, crop.height * UPSCALE_FACTOR),
            Image.LANCZOS,
        )
        lines = _run_tesseract(upscaled, lang=lang, psm=psm, dpi=dpi, scale=UPSCALE_FACTOR)

    for line in lines:
        for word in line['words']:
            word['bbox'] = _translate(word['bbox'], left, top)
        line['bbox'] = _translate(line['bbox'], left, top)
    return lines


def _merge_lines(base: List[Dict], extra: List[Dict]) -> List[Dict]:
    """
    Union of two passes: an `extra` line is added when no `base` line vertically
    covers its centre; when one does, the version with more words wins.
    """
    merged = list(base)
    for line in extra:
        yc = (line['bbox'][1] + line['bbox'][3]) / 2
        covering = None
        for index, known in enumerate(merged):
            h = max(1.0, known['bbox'][3] - known['bbox'][1])
            if known['bbox'][1] - 0.25 * h <= yc <= known['bbox'][3] + 0.25 * h:
                covering = index
                break
        if covering is None:
            merged.append(line)
        elif len(line['words']) > len(merged[covering]['words']):
            merged[covering] = line
    merged.sort(key=lambda l: (l['bbox'][1] + l['bbox'][3]) / 2)
    return merged


def _translate(box: List[float], dx: int, dy: int) -> List[float]:
    return [round(box[0] + dx, 1), round(box[1] + dy, 1), round(box[2] + dx, 1), round(box[3] + dy, 1)]


def _run_tesseract(crop, *, lang: str, psm: int, dpi: Optional[int], scale: int) -> List[Dict]:
    """image_to_data → [{bbox, order, words:[{text,bbox,conf}]}] in CROP coordinates (÷ scale)."""
    import pytesseract

    config = f'--psm {int(psm)}'
    if dpi:
        config += f' --dpi {int(dpi) * scale}'
    data = pytesseract.image_to_data(
        crop, lang=lang, config=config, output_type=pytesseract.Output.DICT,
    )

    lines: Dict[tuple, Dict] = {}
    order: List[tuple] = []
    count = len(data.get('text') or [])
    for i in range(count):
        try:
            if int(data['level'][i]) != 5:
                continue
        except (TypeError, ValueError):
            continue
        text = (data['text'][i] or '').strip()
        if not text:
            continue
        key = (int(data['block_num'][i]), int(data['par_num'][i]), int(data['line_num'][i]))
        x = float(data['left'][i]) / scale
        y = float(data['top'][i]) / scale
        w = float(data['width'][i]) / scale
        h = float(data['height'][i]) / scale
        try:
            conf = float(data['conf'][i])
        except (TypeError, ValueError):
            conf = -1.0
        word = {'text': text, 'bbox': [x, y, x + w, y + h], 'conf': conf}
        if key not in lines:
            lines[key] = {'bbox': list(word['bbox']), 'order': list(key), 'words': []}
            order.append(key)
        line = lines[key]
        line['words'].append(word)
        line['bbox'] = [
            min(line['bbox'][0], word['bbox'][0]),
            min(line['bbox'][1], word['bbox'][1]),
            max(line['bbox'][2], word['bbox'][2]),
            max(line['bbox'][3], word['bbox'][3]),
        ]
    return [lines[key] for key in order]


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
