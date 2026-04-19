"""
Semantic embedding utilities for hybrid search reranking.
Uses Google Gemini text-embedding-004. Falls back to [] (disabling semantic
scoring) when GEMINI_API_KEY is absent or the API call fails.
"""
import logging
import math
import os
import time
from typing import List

logger = logging.getLogger(__name__)

VECTOR_DIMENSIONS = 768
GEMINI_MODEL = "models/text-embedding-004"
# Conservative char ceiling to stay under Gemini's 2048-token limit.
# Arabic script ≈ 1–1.5 chars/token; 8 000 chars gives safe headroom.
GEMINI_INPUT_CHAR_LIMIT = 8_000
GEMINI_BATCH_SIZE = 100
GEMINI_BATCH_DELAY = 0.1  # seconds between batch API calls


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


def build_batch_embedding(texts: List[str], task_type: str = "RETRIEVAL_DOCUMENT") -> List[List[float]]:
    """
    Return a list of 768-dim embeddings for a list of texts.
    Sends up to GEMINI_BATCH_SIZE texts per API call.
    Entries are [] for empty/failed texts.
    """
    api_key = os.environ.get("GEMINI_API_KEY") or None
    if not api_key:
        logger.warning("[SEMANTIC] GEMINI_API_KEY not set — batch embedding disabled")
        return [[] for _ in texts]
    if not texts:
        return []

    try:
        import google.generativeai as genai
        genai.configure(api_key=api_key)
    except Exception as exc:
        logger.error("[SEMANTIC] Gemini configure failed: %s", exc, exc_info=True)
        return [[] for _ in texts]

    results: List[List[float]] = []
    for start in range(0, len(texts), GEMINI_BATCH_SIZE):
        batch = texts[start:start + GEMINI_BATCH_SIZE]
        truncated = [t.strip()[:GEMINI_INPUT_CHAR_LIMIT] if t and t.strip() else "" for t in batch]
        non_empty_idx = [i for i, t in enumerate(truncated) if t]
        batch_results: List[List[float]] = [[] for _ in batch]
        if non_empty_idx:
            try:
                resp = genai.embed_content(
                    model=GEMINI_MODEL,
                    content=[truncated[i] for i in non_empty_idx],
                    task_type=task_type,
                )
                embeddings = resp["embedding"]
                # embed_content returns a single list when content is a list
                # but the shape depends on SDK version; normalise to list-of-lists
                if embeddings and isinstance(embeddings[0], (int, float)):
                    # single embedding returned for a single-item batch
                    embeddings = [embeddings]
                for local_idx, orig_idx in enumerate(non_empty_idx):
                    batch_results[orig_idx] = embeddings[local_idx]
            except Exception as exc:
                logger.error(
                    "[SEMANTIC] Gemini batch embed failed (start=%d): %s", start, exc, exc_info=True
                )
        results.extend(batch_results)
        if start + GEMINI_BATCH_SIZE < len(texts):
            time.sleep(GEMINI_BATCH_DELAY)
    return results


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
