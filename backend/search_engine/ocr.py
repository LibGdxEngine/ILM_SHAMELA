"""
OCR engine registry.

Each engine is a thin HTTP client pointing at a sidecar service that implements:
    POST /parse  (multipart: file=<pdf>)  ->  {"pages": [{"page_number": N, "content": "..."}]}
    GET  /health                          ->  {"status": "ok", ...}

Adding a new engine = add a registry entry with its URL env var + redeploy the sidecar.
The Django task dispatcher (tasks.py) chooses an engine per-document from Document.ocr_engine.
"""

import logging
import os
from typing import List, Dict

import requests

logger = logging.getLogger(__name__)


class OCRUnavailable(Exception):
    """Raised when the OCR service cannot be reached or returns an error."""


class OCREngineClient:
    """HTTP client for a single OCR sidecar that speaks the /parse + /health contract."""

    def __init__(self, name: str, label: str, url: str, timeout: int = 1800):
        self.name = name
        self.label = label
        self.url = (url or '').rstrip('/')
        self.timeout = timeout

    @property
    def configured(self) -> bool:
        return bool(self.url)

    def health(self) -> bool:
        """Return True if GET /health returns a 2xx response."""
        if not self.configured:
            return False
        try:
            r = requests.get(f'{self.url}/health', timeout=5)
            return 200 <= r.status_code < 300
        except requests.RequestException:
            return False

    def parse(self, file_content: bytes, file_name: str) -> List[Dict]:
        """
        POST the PDF to the engine's /parse endpoint.

        Returns a list of {'page_number': int, 'content': str} dicts.
        Raises OCRUnavailable on any transport or contract failure.
        """
        if not self.configured:
            raise OCRUnavailable(f'OCR engine "{self.name}" is not configured (no URL)')

        try:
            response = requests.post(
                f'{self.url}/parse',
                files={'file': (file_name or 'document.pdf', file_content, 'application/pdf')},
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            raise OCRUnavailable(f'{self.name} request failed: {exc}') from exc

        if response.status_code != 200:
            raise OCRUnavailable(
                f'{self.name} returned HTTP {response.status_code}: {response.text[:500]}'
            )

        try:
            data = response.json()
        except ValueError as exc:
            raise OCRUnavailable(f'{self.name} returned non-JSON: {exc}') from exc

        pages = data.get('pages')
        if not isinstance(pages, list) or not pages:
            raise OCRUnavailable(f'{self.name} returned no pages')

        normalized = []
        for idx, page in enumerate(pages):
            content = (page.get('content') or page.get('text') or '').strip()
            if not content:
                continue
            normalized.append({
                'page_number': page.get('page_number') or (idx + 1),
                'content': content,
            })

        if not normalized:
            raise OCRUnavailable(f'{self.name} returned only empty pages')

        return normalized


# Tesseract URL: honor legacy MONKEYOCR_API_URL as a fallback for one release.
_TESSERACT_URL = (
    os.environ.get('OCR_TESSERACT_URL')
    or os.environ.get('MONKEYOCR_API_URL')
    or ''
)
_CHANDRA_URL = os.environ.get('OCR_CHANDRA_URL', '')
_OCR_TIMEOUT = int(os.environ.get('OCR_TIMEOUT', os.environ.get('MONKEYOCR_TIMEOUT', '1800')))

REGISTRY: Dict[str, OCREngineClient] = {
    'tesseract': OCREngineClient(
        name='tesseract',
        label='Tesseract (fast, CPU)',
        url=_TESSERACT_URL,
        timeout=_OCR_TIMEOUT,
    ),
    'chandra': OCREngineClient(
        name='chandra',
        label='Chandra (high-quality, GPU)',
        url=_CHANDRA_URL,
        timeout=_OCR_TIMEOUT,
    ),
}

DEFAULT_ENGINE = os.environ.get('OCR_DEFAULT_ENGINE', 'tesseract')


def get_engine(name: str) -> OCREngineClient:
    """Look up an engine by name. Raises OCRUnavailable if unknown."""
    engine = REGISTRY.get(name)
    if engine is None:
        raise OCRUnavailable(f'Unknown OCR engine "{name}"')
    return engine


def list_engines() -> List[Dict]:
    """
    Return [{id, label, available}] for all registered engines.
    `available` = configured AND /health returned 2xx.
    """
    return [
        {
            'id': engine.name,
            'label': engine.label,
            'available': engine.configured and engine.health(),
        }
        for engine in REGISTRY.values()
    ]


def is_any_engine_configured() -> bool:
    """True when at least one registered engine has a URL set."""
    return any(engine.configured for engine in REGISTRY.values())
