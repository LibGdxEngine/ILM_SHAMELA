"""KB pipeline configuration: constants ported from the notebook plus
env-derived model names, guards, and path helpers.

Model/guard values are read at call time (matching the ``layer0``/``ner``
env-var style) so a worker restart is never needed to change them.
"""
import os
from pathlib import Path

from django.conf import settings

# Version stamps. KB_PIPELINE_VERSION doubles as ExtractionRun.extractor_version
# (max_length=20 — keep it short).
KB_PIPELINE_VERSION = "kb-1.0.0"
NORMALIZER_VERSION = "norm-db-1.0"
STAGE2_PROMPT_VERSION = "stage2-v4"

KB_EXTRACTOR_NAME = "kb_llm"

# --- Stage 1: split detection (DeepSeek via OpenRouter) ----------------------
SPLIT_TEMPERATURE = 0.0
SPLIT_CHUNK_CHARS = 150_000      # chars of book text per split call
SPLIT_CHUNK_TAIL = 2_000         # overlap between consecutive chunks
FALLBACK_SEG_CHARS = 6_000       # fixed-window size when no split point is found

# --- Stage 2: extraction (Gemini via google-genai) ---------------------------
WINDOW_MAX_CHARS = 3_000         # focus size per extraction call
WINDOW_OVERLAP = 250             # cross-boundary context on each side
OVERSIZED_FOCUS_CAP = 30_000     # hard cap on focus text sent for oversized leaves
LINKS_MIN_MENTIONS = 2           # pass B is skipped below this many mentions

# --- Cost model (estimates only; dry runs use these) -------------------------
CHARS_PER_TOKEN = 3.5            # rough Arabic chars-per-token heuristic
PROMPT_OVERHEAD_TOKENS = 2_600   # Stage 1 instructions overhead per call
DEEPSEEK_PRICE_IN, DEEPSEEK_PRICE_OUT = 0.098 / 1e6, 0.196 / 1e6
GEMINI_PRICE_IN, GEMINI_PRICE_OUT = 2.0 / 1e6, 12.0 / 1e6  # <=200k-token tier


def split_model() -> str:
    return os.environ.get('KB_SPLIT_MODEL', 'deepseek/deepseek-v4-flash')


def extract_model() -> str:
    return os.environ.get('KB_EXTRACT_MODEL', 'gemini-3.1-pro-preview')


def thinking_level() -> str:
    return os.environ.get('KB_THINKING_LEVEL', 'medium')


def gemini_use_vertex() -> bool | None:
    """None = auto-detect from the key prefix; 'true'/'false' force it."""
    raw = os.environ.get('KB_GEMINI_USE_VERTEX', '').strip().lower()
    if raw in ('true', '1', 'yes'):
        return True
    if raw in ('false', '0', 'no'):
        return False
    return None


# --- Auto-run guards (checked only for upload-triggered runs) ----------------

def auto_enabled() -> bool:
    return os.environ.get('KB_AUTO_ENABLED', 'true').strip().lower() \
        not in ('false', '0', 'no')


def max_auto_cost_usd() -> float:
    return float(os.environ.get('KB_MAX_AUTO_COST_USD', '15'))


def max_doc_chars() -> int:
    return int(os.environ.get('KB_MAX_DOC_CHARS', '4000000'))


# --- Paths -------------------------------------------------------------------

def data_dir() -> Path:
    return Path(settings.KB_DATA_DIR)


def output_dir(book_id: str) -> Path:
    return data_dir() / 'output' / book_id


def cache_dir() -> Path:
    return data_dir() / 'cache'


def book_id_for(document) -> str:
    return f"doc_{document.pk}"
