<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-03 | Updated: 2026-07-03 -->

# monkeyocr

## Purpose
Alternative GPU-optimized OCR service that wraps the open-source MonkeyOCR engine (GitHub: Yuliang-Liu/MonkeyOCR). Intended as a switchable replacement for Tesseract when CUDA hardware is available; provides the same `/parse` + `/health` endpoint contract as the other OCR sidecars. Not included by default in docker-compose; use via explicit Dockerfile override or separate service definition.

## Key Files
| File | Description |
|------|-------------|
| `Dockerfile` | Primary build configuration; intended as a drop-in for the `monkeyocr/` service in docker-compose. Uses Python 3.11-slim, clones MonkeyOCR repo from GitHub, installs dependencies (torch, transformers, huggingface_hub), optionally pre-downloads a 1.2B model. Exposes port 7860. |
| `Dockerfile.monkeyocr` | Same as `Dockerfile` (identical alias). |
| `Dockerfile.tesseract` | Fallback Tesseract build if MonkeyOCR fails or is not available. Identical to `ocr_services/tesseract/Dockerfile`. |
| `service.py` | FastAPI app that wraps Tesseract OCR; mirrors the implementation in `ocr_services/tesseract/service.py`. Returns same `/parse` contract: `{"pages": [{"page_number": N, "content": "..."}]}`. Used as the baseline when MonkeyOCR is not built. |

## For AI Agents

### Working In This Directory
- **Switching to MonkeyOCR**: To enable this service, add a `monkeyocr` service definition to `docker-compose.yml` that builds from `./monkeyocr/Dockerfile`, or override the build context of an existing OCR service.
- **GPU support**: The Dockerfile does not pin CUDA; it uses the system-available GPU if the `nvidia` runtime is configured in Docker. For development, set Docker daemon config to enable GPU (typically `"runtimes": {"nvidia": {...}}` in `daemon.json`).
- **Model pre-download**: The build step attempts to download the MonkeyOCR-pro-1.2B model (~2GB) at build time. This step is non-fatal; if it fails, the model will be downloaded on first `/parse` request (slower first request, but smaller image).
- **Fallback strategy**: If MonkeyOCR is unavailable, you can rename `Dockerfile.tesseract` → `Dockerfile` and rebuild to use Tesseract instead.
- **Port assignment**: If adding to docker-compose, assign an unused port (e.g., 7863 for MonkeyOCR if tesseract=7860, chandra=7861, docling=7862), then set `OCR_MONKEYOCR_URL=http://monkeyocr:7863` in backend env vars.

### Testing Requirements
- **Build validation**: `docker build -f monkeyocr/Dockerfile -t monkeyocr:latest ./monkeyocr/` to verify Dockerfile syntax and dependencies. Build may take 5-10 minutes and require significant disk space (~10GB) due to model weights.
- **Service startup**: After build, `docker run --gpus all -p 7860:7860 monkeyocr:latest` (with GPU) or `docker run -p 7860:7860 monkeyocr:latest` (CPU fallback, will be slow).
- **Health check**: `curl -f http://localhost:7860/health` should return `{"status": "ok", "backend": "tesseract", ...}` (or MonkeyOCR backend name if service.py is updated).
- **Parse endpoint**: `curl -F "file=@test.pdf" http://localhost:7860/parse` should return valid JSON with pages array.

### Common Patterns
- **Lazy initialization**: MonkeyOCR (like Docling) loads model weights on first use; subsequent requests reuse the cached model. Pre-downloading at build time avoids the first-request delay in production.
- **GPU memory management**: MonkeyOCR can consume significant VRAM (2-4GB). If running alongside other GPU services, monitor memory usage and consider memory limits in docker-compose.
- **Fallback to Tesseract**: `Dockerfile.tesseract` provides a guaranteed working OCR if MonkeyOCR build fails. The `service.py` can be adapted to load either backend at runtime (e.g., via an env var like `OCR_ENGINE=monkeyocr|tesseract`).
- **Repository cloning**: The Dockerfile clones MonkeyOCR at build time (`git clone --depth 1 ...`). This means the build is pinned to the main branch tip; consider pinning to a commit hash for reproducibility in production.

## Dependencies

### Internal
- **backend** (Django): Would call `OCR_MONKEYOCR_URL` if configured; not currently wired in docker-compose by default.
- **Tesseract** (via `Dockerfile.tesseract` fallback): System package `tesseract-ocr*` + language packs.

### External
- **MonkeyOCR repository** (GitHub: Yuliang-Liu/MonkeyOCR): Cloned at build time; requires internet access during build.
- **CUDA 12.x** (optional, for GPU acceleration): Dramatically speeds up inference. Without CUDA, MonkeyOCR runs on CPU (much slower).
- **Hugging Face Hub**: Model weights downloaded and cached in `/root/.cache/huggingface/` (inside container).
- **System libraries**: `libgl1`, `libglib2.0-0`, `libsm6`, `libxext6`, `libxrender1` for image processing and ML frameworks.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
