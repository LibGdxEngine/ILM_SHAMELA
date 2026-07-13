"""
Semantic embedding utilities for hybrid search reranking.

Uses `google/gemini-embedding-2` via OpenRouter, wrapped through LangChain's
OpenAI-compatible `OpenAIEmbeddings` client (OpenRouter exposes an
OpenAI-shaped `/embeddings` endpoint). Falls back to [] (disabling semantic
scoring) when OPENROUTER_API_KEY is absent or the API call fails.

Switching the underlying model changes vector dimensions, so any code that
persists embeddings (DocumentChunk.embedding, Document.semantic_vector) must
be regenerated via `python manage.py reembed_documents` and the Elasticsearch
index must be rebuilt after a code change to VECTOR_DIMENSIONS.
"""
import logging
import math
import os
import time
from typing import List, Optional

logger = logging.getLogger(__name__)

VECTOR_DIMENSIONS = 3072
EMBEDDING_MODEL = os.environ.get(
    "OPENROUTER_EMBEDDING_MODEL", "google/gemini-embedding-2"
)
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
# Conservative char ceiling. Gemini embedding models accept ~2048 tokens;
# 8 000 chars gives safe headroom for Arabic (≈ 1–1.5 chars/token).
EMBEDDING_INPUT_CHAR_LIMIT = 8_000
EMBEDDING_BATCH_SIZE = 100
EMBEDDING_BATCH_DELAY = 0.1  # seconds between batch API calls

_embedder: Optional[object] = None


def _get_embedder() -> Optional[object]:
    """Return a cached LangChain `OpenAIEmbeddings` client pointed at OpenRouter.

    Returns None when OPENROUTER_API_KEY is unset or the langchain-openai
    package isn't importable. Callers must treat None as "skip embedding".
    """
    global _embedder
    if _embedder is not None:
        return _embedder

    api_key = os.environ.get("OPENROUTER_API_KEY") or None
    if not api_key:
        return None

    try:
        from langchain_openai import OpenAIEmbeddings  # lazy import
    except ImportError as exc:
        logger.error("[SEMANTIC] langchain-openai not installed: %s", exc)
        return None

    try:
        _embedder = OpenAIEmbeddings(
            model=EMBEDDING_MODEL,
            api_key=api_key,
            base_url=OPENROUTER_BASE_URL,
            # Disable client-side automatic dim check; OpenRouter returns 3072
            # but doesn't always echo the model's dim in its metadata.
            check_embedding_ctx_length=False,
            # OpenAI SDK 2.x auto-sets encoding_format="base64", but OpenRouter's
            # Google AI Studio backend rejects that. Force "float" so the SDK
            # treats it as caller-provided and skips the override.
            model_kwargs={"encoding_format": "float"},
        )
    except Exception as exc:
        logger.error("[SEMANTIC] failed to construct embedder: %s", exc, exc_info=True)
        return None

    return _embedder


def build_embedding(text: str, task_type: str = "RETRIEVAL_DOCUMENT") -> List[float]:
    """
    Return a 3072-dim embedding for text.

    The `task_type` argument is accepted for backwards compatibility with the
    previous Google-direct implementation but ignored — OpenRouter's embeddings
    endpoint follows the OpenAI shape, which has no task_type parameter.

    Returns [] on any error or when OPENROUTER_API_KEY is unset.
    """
    if not text or not text.strip():
        return []

    embedder = _get_embedder()
    if embedder is None:
        logger.warning(
            "[SEMANTIC] embedder unavailable (no OPENROUTER_API_KEY?) — semantic scoring disabled"
        )
        return []

    try:
        return embedder.embed_query(text.strip()[:EMBEDDING_INPUT_CHAR_LIMIT])
    except Exception as exc:
        logger.error("[SEMANTIC] embed_query failed: %s", str(exc), exc_info=True)
        return []


def build_batch_embedding(
    texts: List[str], task_type: str = "RETRIEVAL_DOCUMENT"
) -> List[List[float]]:
    """
    Return a list of 3072-dim embeddings for a list of texts.

    Sends up to EMBEDDING_BATCH_SIZE texts per API call. Entries are [] for
    empty/failed texts. `task_type` is accepted but ignored (see build_embedding).
    """
    if not texts:
        return []

    embedder = _get_embedder()
    if embedder is None:
        logger.warning("[SEMANTIC] embedder unavailable — batch embedding disabled")
        return [[] for _ in texts]

    results: List[List[float]] = []
    for start in range(0, len(texts), EMBEDDING_BATCH_SIZE):
        batch = texts[start:start + EMBEDDING_BATCH_SIZE]
        truncated = [
            t.strip()[:EMBEDDING_INPUT_CHAR_LIMIT] if t and t.strip() else ""
            for t in batch
        ]
        non_empty_idx = [i for i, t in enumerate(truncated) if t]
        batch_results: List[List[float]] = [[] for _ in batch]
        if non_empty_idx:
            try:
                inputs = [truncated[i] for i in non_empty_idx]
                vectors = embedder.embed_documents(inputs)
                for local_idx, orig_idx in enumerate(non_empty_idx):
                    if local_idx < len(vectors):
                        batch_results[orig_idx] = vectors[local_idx]
            except Exception as exc:
                logger.error(
                    "[SEMANTIC] batch embed_documents failed (start=%d): %s",
                    start, exc, exc_info=True,
                )
        results.extend(batch_results)
        if start + EMBEDDING_BATCH_SIZE < len(texts):
            time.sleep(EMBEDDING_BATCH_DELAY)
    return results


def normalize_vector(vector: List[float]) -> List[float]:
    norm = math.sqrt(sum(v * v for v in vector))
    if norm == 0:
        return [0.0] * len(vector)
    return [v / norm for v in vector]


def cosine_similarity(left: List[float], right: List[float]) -> float:
    """True cosine (scale-invariant): dot product divided by the L2 norms of
    both vectors, computed over the same min-length slice so truncation stays
    self-consistent. Provider embeddings are stored un-normalized, so dividing
    here is what makes the fixed 0.5/0.3 semantic thresholds meaningful."""
    if not left or not right:
        return 0.0
    size = min(len(left), len(right))
    dot = sum(left[i] * right[i] for i in range(size))
    norm_left = math.sqrt(sum(left[i] * left[i] for i in range(size)))
    norm_right = math.sqrt(sum(right[i] * right[i] for i in range(size)))
    if norm_left == 0.0 or norm_right == 0.0:
        return 0.0
    return max(-1.0, min(1.0, dot / (norm_left * norm_right)))
