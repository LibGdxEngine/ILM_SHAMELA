"""
Chandra OCR sidecar.

    POST /parse   (multipart: file=<pdf>)  ->  {"pages": [{"page_number": N, "content": "..."}]}
    GET  /health                           ->  {"status": "ok", "backend": "chandra", ...}

Implementation: wraps the `chandra` CLI via subprocess. Chandra produces a directory of
per-page markdown (and metadata JSON); we walk that output and normalize to the shared
/parse contract so the Django backend does not need engine-specific parsing logic.
"""

import glob
import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
from typing import List, Dict, Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger('ocr-chandra')

app = FastAPI(title='Chandra OCR Sidecar', version='1.0')

CHANDRA_METHOD = os.environ.get('CHANDRA_METHOD', 'hf')  # "hf" (in-process) or "vllm"
CHANDRA_BIN = os.environ.get('CHANDRA_BIN', 'chandra')
CHANDRA_TIMEOUT = int(os.environ.get('CHANDRA_TIMEOUT', '1800'))


@app.get('/health')
def health():
    available = shutil.which(CHANDRA_BIN) is not None
    return {
        'status': 'ok' if available else 'degraded',
        'backend': 'chandra',
        'method': CHANDRA_METHOD,
        'cli_found': available,
    }


@app.post('/parse')
async def parse_pdf(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail='No filename provided')

    content = await file.read()
    logger.info('Parsing %s (%d bytes) with chandra method=%s',
                file.filename, len(content), CHANDRA_METHOD)

    try:
        pages = chandra_extract_pages(content, file.filename)
    except Exception as exc:
        logger.exception('Chandra OCR failed')
        raise HTTPException(status_code=500, detail=f'OCR failed: {exc}')

    if not pages:
        raise HTTPException(status_code=500, detail='OCR produced no pages')

    logger.info('Returning %d pages, total chars=%d',
                len(pages), sum(len(p['content']) for p in pages))
    return JSONResponse({'pages': pages})


def chandra_extract_pages(pdf_bytes: bytes, file_name: str) -> List[Dict]:
    """
    Invoke `chandra <input.pdf> <output_dir> --method {hf|vllm}` and collect per-page markdown.
    """
    with tempfile.TemporaryDirectory(prefix='chandra-') as workdir:
        input_path = os.path.join(workdir, 'input.pdf')
        output_dir = os.path.join(workdir, 'out')
        os.makedirs(output_dir, exist_ok=True)

        with open(input_path, 'wb') as handle:
            handle.write(pdf_bytes)

        cmd = [CHANDRA_BIN, input_path, output_dir, '--method', CHANDRA_METHOD]
        logger.info('Running: %s', ' '.join(cmd))

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=CHANDRA_TIMEOUT,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f'chandra CLI exited {result.returncode}: '
                f'stderr={result.stderr[:500]} stdout={result.stdout[:500]}'
            )

        return _collect_pages(output_dir)


_PAGE_NUM_RE = re.compile(r'(?:page[_-]?|_)(\d+)', re.IGNORECASE)


def _collect_pages(output_dir: str) -> List[Dict]:
    """
    Chandra's CLI writes per-page artifacts into the output dir. The exact file layout can
    vary slightly between releases, so we try a few strategies in order:

      1. JSON manifest (pages.json / <doc>.json) with a "pages" array.
      2. Per-page markdown files matching *page*_<N>.md or page_<N>.md.
      3. Single combined markdown split on form-feed characters.
    """
    # Strategy 1: JSON manifest
    for candidate in glob.glob(os.path.join(output_dir, '**', '*.json'), recursive=True):
        try:
            with open(candidate, 'r', encoding='utf-8') as handle:
                data = json.load(handle)
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(data, dict) and isinstance(data.get('pages'), list):
            normalized = []
            for idx, page in enumerate(data['pages'], start=1):
                text = _page_text(page)
                if not text:
                    continue
                normalized.append({
                    'page_number': page.get('page_number') or page.get('page') or idx,
                    'content': text,
                })
            if normalized:
                return normalized

    # Strategy 2: per-page markdown files
    md_files = sorted(glob.glob(os.path.join(output_dir, '**', '*.md'), recursive=True))
    per_page: List[Dict] = []
    for path in md_files:
        match = _PAGE_NUM_RE.search(os.path.basename(path))
        if not match:
            continue
        page_number = int(match.group(1))
        with open(path, 'r', encoding='utf-8') as handle:
            text = handle.read().strip()
        if text:
            per_page.append({'page_number': page_number, 'content': text})
    if per_page:
        per_page.sort(key=lambda p: p['page_number'])
        return per_page

    # Strategy 3: single combined markdown, split on form-feed
    combined: Optional[str] = None
    if md_files:
        with open(md_files[0], 'r', encoding='utf-8') as handle:
            combined = handle.read()
    if combined:
        chunks = [c.strip() for c in combined.split('\f') if c.strip()]
        if len(chunks) <= 1:
            chunks = [c.strip() for c in combined.split('\n\n\n') if c.strip()]
        return [
            {'page_number': idx + 1, 'content': chunk}
            for idx, chunk in enumerate(chunks)
            if chunk
        ]

    return []


def _page_text(page: object) -> str:
    if not isinstance(page, dict):
        return ''
    for key in ('content', 'text', 'markdown', 'md'):
        value = page.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ''
