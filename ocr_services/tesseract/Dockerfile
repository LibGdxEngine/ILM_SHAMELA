# Tesseract OCR sidecar — exposes POST /parse + GET /health.
# Returns {"pages": [{"page_number": N, "content": "..."}]}
# CPU-only, fast, supports Arabic + English + Farsi + Urdu language packs.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        tesseract-ocr \
        tesseract-ocr-ara \
        tesseract-ocr-eng \
        tesseract-ocr-fas \
        tesseract-ocr-urd \
        poppler-utils \
        curl \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --upgrade pip \
    && pip install \
        fastapi==0.115.0 \
        "uvicorn[standard]==0.30.6" \
        python-multipart==0.0.9 \
        pdf2image==1.17.0 \
        pytesseract==0.3.13 \
        Pillow==10.4.0

WORKDIR /opt
COPY service.py /opt/service.py

EXPOSE 7860

CMD ["uvicorn", "service:app", "--host", "0.0.0.0", "--port", "7860", "--app-dir", "/opt"]
