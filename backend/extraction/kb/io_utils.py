"""Shared LLM plumbing: content-hash disk cache, crash-safe writes, retries,
lenient JSON parsing. Ported from the notebook (cell: shared plumbing);
``print`` became logging and paths root at ``config.cache_dir()``.

Every cached payload is written BEFORE parsing, so a validation failure never
costs a second billed call for the same prompt.
"""
import hashlib
import json
import logging
import os
import random
import re
import time
from pathlib import Path

from . import config

logger = logging.getLogger(__name__)


def cache_key(*parts: str) -> str:
    h = hashlib.sha256()
    for p in parts:
        h.update(p.encode("utf-8"))
        h.update(b"\x1f")
    return h.hexdigest()[:32]


def cache_path(stage: str, book_id: str, key: str) -> Path:
    d = config.cache_dir() / stage / book_id
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{key}.json"


def atomic_write_text(path: Path, text: str) -> None:
    """Crash-safe write: temp file in the same directory, fsync, then atomic
    os.replace — an interrupt mid-write can never leave a truncated file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def read_json_or_none(p: Path) -> dict | None:
    """None instead of an exception for missing or unreadable JSON files."""
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None


def cache_get(stage: str, book_id: str, key: str) -> dict | None:
    p = cache_path(stage, book_id, key)
    if not p.exists():
        return None
    payload = read_json_or_none(p)
    if payload is None:
        p.unlink(missing_ok=True)   # truncated by an old crash — redo this call
    return payload


def cache_put(stage: str, book_id: str, key: str, payload: dict) -> None:
    atomic_write_text(cache_path(stage, book_id, key),
                      json.dumps(payload, ensure_ascii=False))


def _retry_after_seconds(exc: Exception) -> float | None:
    headers = getattr(getattr(exc, "response", None), "headers", None)
    if headers is not None:
        try:
            return float(headers.get("retry-after") or headers.get("Retry-After"))
        except (TypeError, ValueError):
            pass
    return None


def with_retries(fn, *, max_tries: int = 5, what: str = "llm-call"):
    """Retry on 429/5xx/connection errors with exponential backoff + jitter.
    Non-transient API errors (401, 400...) raise immediately."""
    for attempt in range(1, max_tries + 1):
        try:
            return fn()
        except Exception as exc:
            status = getattr(exc, "status_code", None) or getattr(exc, "code", None)
            transient = status in (429, 500, 502, 503, 504) or status is None
            if not transient or attempt == max_tries:
                raise
            delay = _retry_after_seconds(exc) or min(60.0, 2 ** attempt + random.uniform(0, 2))
            logger.warning("[%s] attempt %d failed (%s); retrying in %.0fs",
                           what, attempt, type(exc).__name__, delay)
            time.sleep(delay)


def parse_json_lenient(s: str) -> dict:
    s = s.strip()
    if s.startswith("```"):
        s = re.sub(r"^```[a-zA-Z]*\s*", "", s)
        s = re.sub(r"\s*```$", "", s)
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        start, end = s.find("{"), s.rfind("}")
        if start != -1 and end > start:
            return json.loads(s[start : end + 1])
        raise
