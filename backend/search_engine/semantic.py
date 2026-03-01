"""
Semantic embedding utilities for hybrid search reranking.
Uses Google Gemini text-embedding-004. Falls back to [] (disabling semantic
scoring) when GEMINI_API_KEY is absent or the API call fails.
"""
import logging
import math
import os
from typing import List

logger = logging.getLogger(__name__)

VECTOR_DIMENSIONS = 768
GEMINI_MODEL = "models/text-embedding-004"
# Conservative char ceiling to stay under Gemini's 2048-token limit.
# Arabic script ≈ 1–1.5 chars/token; 8 000 chars gives safe headroom.
GEMINI_INPUT_CHAR_LIMIT = 8_000


def build_embedding(text: str, task_type: str = "RETRIEVAL_DOCUMENT") -> List[float]:
    """
    Return a 768-dim Gemini embedding for text.
    task_type: "RETRIEVAL_DOCUMENT" (at index time) or "RETRIEVAL_QUERY" (at search time).
    Returns [] on any error or when GEMINI_API_KEY is unset.
    """
    api_key = os.environ.get("GEMINI_API_KEY") or None
    if not api_key:
        logger.warning("[SEMANTIC] GEMINI_API_KEY is not set — semantic scoring disabled")
        return []

    if not text or not text.strip():
        return []

    try:
        import google.generativeai as genai  # lazy import

        genai.configure(api_key=api_key)
        result = genai.embed_content(
            model=GEMINI_MODEL,
            content=text.strip()[:GEMINI_INPUT_CHAR_LIMIT],
            task_type=task_type,
        )
        return result["embedding"]
    except Exception as exc:
        logger.error("[SEMANTIC] Gemini embed_content failed: %s", str(exc), exc_info=True)
        return []


def normalize_vector(vector: List[float]) -> List[float]:
    norm = math.sqrt(sum(v * v for v in vector))
    if norm == 0:
        return [0.0] * len(vector)
    return [v / norm for v in vector]


def cosine_similarity(left: List[float], right: List[float]) -> float:
    if not left or not right:
        return 0.0
    size = min(len(left), len(right))
    dot = sum(left[i] * right[i] for i in range(size))
    return max(-1.0, min(1.0, dot))
