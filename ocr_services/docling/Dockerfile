# Docling extraction sidecar — exposes POST /parse + GET /health.
# Returns {"pages": [{"page_number": N, "content": "...", "markdown": "...", "tables": [...]}]}
# CPU-based, layout-aware: preserves tables, headings, multi-column structure.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/root/.cache/huggingface \
    OMP_NUM_THREADS=4

RUN apt-get update && apt-get install -y --no-install-recommends \
        poppler-utils \
        tesseract-ocr \
        tesseract-ocr-ara \
        tesseract-ocr-eng \
        tesseract-ocr-fas \
        tesseract-ocr-urd \
        libgl1 \
        libglib2.0-0 \
        curl \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --upgrade pip \
    && pip install \
        fastapi==0.115.0 \
        "uvicorn[standard]==0.30.6" \
        python-multipart==0.0.9 \
        docling==2.14.0

# Pre-cache Docling layout/table models so first request doesn't pay the download cost.
RUN python -c "from docling.document_converter import DocumentConverter; DocumentConverter()"

WORKDIR /opt
COPY service.py /opt/service.py

EXPOSE 7860

CMD ["uvicorn", "service:app", "--host", "0.0.0.0", "--port", "7860", "--app-dir", "/opt"]
