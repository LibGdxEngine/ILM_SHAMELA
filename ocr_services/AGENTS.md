<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-03 | Updated: 2026-07-03 -->

# ocr_services

## Purpose
Three pluggable OCR engine sidecars that extract text from PDF documents via a shared `/parse` POST endpoint. Each engine normalizes its output to `{"pages": [{"page_number": N, "content": "..."}]}` so the Django backend uses a single processing code path regardless of which OCR engine is active. The backend calls these services asynchronously (via Celery worker) when uploaded PDFs lack embedded text or require high-quality extraction.

## Key Files
| File | Description |
|------|-------------|
| `tesseract/Dockerfile` | Builds a FastAPI service on Python 3.11; installs Tesseract OCR + language packs (Arabic, English, Farsi, Urdu) + pdf2image + pytesseract. Exposes port 7860. |
| `tesseract/service.py` | FastAPI app: `GET /health` returns engine name + langs; `POST /parse` accepts multipart PDF, renders pages via pdf2image at configurable DPI, runs Tesseract on each page image, returns JSON with per-page text. Configurable via `OCR_LANG` and `OCR_DPI` env vars. |
| `chandra/Dockerfile` | Builds on NVIDIA CUDA 12.4 runtime (GPU recommended but not required); installs the `chandra-ocr` CLI tool and FastAPI wrapper. Exposes port 7860. |
| `chandra/service.py` | FastAPI app: `GET /health` reports backend availability; `POST /parse` writes uploaded PDF to temp file, invokes `chandra` CLI with `--method {hf\|vllm}`, parses output (JSON manifest, per-page markdown, or form-feed-split text), normalizes to shared `/parse` contract. Timeout configurable via `CHANDRA_TIMEOUT` env var. |
| `docling/Dockerfile` | Builds on Python 3.11; installs Docling 2.14.0 + language support (Tesseract for OCR fallback) + layout/table models. Pre-caches models at build time. Exposes port 7860. Memory-limited in `docker-compose.yml` to prevent OOM on oversized PDFs. |
| `docling/service.py` | FastAPI app: `GET /health` reports OCR status + table mode; `POST /parse` uses Docling's DocumentConverter (lazy-initialized on first request) to extract layout-aware content (text, markdown, tables), groups by page number, returns JSON with per-page text + per-page markdown + table list. Configurable via `DOCLING_OCR_ENABLED`, `DOCLING_OCR_LANG`, `DOCLING_TABLE_MODE` env vars. |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `tesseract/` | CPU-friendly, fast, multilingual OCR via Tesseract CLI. |
| `chandra/` | Vision-transformer-based OCR (GitHub: Yuliang-Liu/Chandra); GPU-friendly but works on CPU. Optional profile in docker-compose. |
| `docling/` | Layout-aware PDF understanding with table extraction; preserves structure (headings, columns, tables). Optional `docling` profile in docker-compose. |

## For AI Agents

### Working In This Directory
- **Service contract**: All engines expose the same `/parse` endpoint and `/health` check. To add a new OCR engine, create a new subdirectory with `Dockerfile` + `service.py` adhering to this contract.
- **Port assignment**: Each service gets its own port (Tesseract: 7860, Chandra: 7861, Docling: 7862) in docker-compose. Use the next available port if adding a fourth engine.
- **Environment variables**: Pass engine-specific config via env vars in `docker-compose.yml` (e.g., `OCR_LANG`, `CHANDRA_METHOD`, `DOCLING_OCR_ENABLED`). The backend reads these to choose the default engine or pass them to workers.
- **Health checks**: Each `/health` endpoint should report `{"status": "ok" or "degraded", "backend": "<engine_name>", ...}` so the backend can detect failures and fall back gracefully.
- **Failure handling**: If an OCR service fails (HTTP 5xx), the backend retries with exponential backoff; terminal failures are logged in document state (`processing_error`).

### Testing Requirements
- **Local smoke test**: `docker compose build ocr-tesseract` (and `ocr-chandra`, `ocr-docling`) to validate Dockerfile syntax.
- **Service startup**: `docker compose up ocr-tesseract` (alone) and verify `curl -f http://localhost:7860/health`.
- **Parse endpoint**: Create a minimal PDF, then `curl -F "file=@test.pdf" http://localhost:7860/parse` and verify JSON response with pages array.
- **Integration**: Full `docker compose up -d`, then backend document processing should use the active OCR engine. Monitor `make logs` for "Parsing..." and "Returning N pages..." log lines.

### Common Patterns
- **Lazy initialization**: Docling loads model weights on first `/parse` call (see `_CONVERTER` singleton in `docling/service.py`); subsequent calls reuse the same converter to avoid repeated downloads.
- **Temporary files**: Chandra and Docling write input PDFs to temp files (via `tempfile.TemporaryDirectory()`), which are automatically cleaned up after extraction.
- **Page normalization**: All three engines iterate pages, extract text, and return in ascending page-number order; empty pages are skipped.
- **Error reporting**: Service.py catches exceptions, logs them, and returns HTTP 500 with a brief error message. The backend logs the full error for debugging.
- **Language configuration**: Tesseract uses `OCR_LANG` env var with `+`-separated Tesseract language codes (`ara+eng+fas+urd`). Docling uses ISO 639-1 codes (`ar,en,fa,ur`). Chandra auto-detects.

## Dependencies

### Internal
- All services depend on `backend` for the document ingestion workflow: backend calls `OCR_TESSERACT_URL` (or `OCR_CHANDRA_URL`, `OCR_DOCLING_URL`) when processing a document.
- Services depend on each other only via optional profiles: `--profile gpu` (for Chandra), `--profile docling` (for Docling).

### External
- **pdf2image + Poppler**: Tesseract and Docling both require `poppler-utils` (system package) to convert PDF to images/intermediate format.
- **Tesseract OCR binaries**: Language packs installed at build time; requires `tesseract-ocr*` system packages.
- **Chandra CLI**: Installed via `pip install chandra-ocr`. Downloads vision-transformer models on first use (~multi-GB).
- **Docling library**: `pip install docling==2.14.0`. Downloads layout/table models at build time (pre-cached in the Dockerfile).
- **Hugging Face Hub** (optional, for Docling/Chandra model weights): Respects `HF_HOME` env var for caching; set to a persistent volume if running on-prem.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->

### Word geometry endpoint (tesseract only)
`tesseract/service.py` additionally exposes `POST /words` for the PDF-overlay reader's word-level
text layer (backend: `search_engine/word_geometry.py`, task `extract_word_geometry_task`).
- Request (multipart): `file` = one page image (PNG/WebP); form fields `regions` = JSON
  `[{"id": ..., "bbox": [x0, y0, x1, y1], "psm"?: 6|7}]` in **image pixel** coords (absent → whole
  page), `lang` (default env `OCR_WORDS_LANG`, `ara` — never mix `eng` into Arabic pages), `psm`
  (default 6), `pad` (crop padding px, default 6), `dpi` (forwarded as `--dpi`).
- Response: `{"width", "height", "regions": [{"id", "lines": [{"bbox", "order": [block, par, line],
  "words": [{"text", "bbox", "conf"}]}], "error"?}]}` — coords translated back to full-image
  space; words are in tesseract `word_num` order, which is already logical (RTL reading) order —
  callers must NOT re-sort by x. One failing region yields `"error"` on that region, not HTTP 500.
- `/health` advertises it via `"features": ["parse", "words"]`; the backend checks that before
  enqueuing geometry work. Regions whose median word height is < 20 px are re-run at 2× upscale.
- Smoke test: `curl -F file=@page.png -F 'regions=[{"id":"b","bbox":[100,100,900,300]}]' -F lang=ara http://localhost:7860/words`.
