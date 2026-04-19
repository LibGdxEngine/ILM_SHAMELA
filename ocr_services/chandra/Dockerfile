# Chandra OCR sidecar — exposes POST /parse + GET /health.
# Wraps the `chandra` CLI (https://github.com/datalab-to/chandra) to match the
# shared /parse contract: {"pages": [{"page_number": N, "content": "..."}]}
#
# GPU recommended (CUDA 12.x). Runs CPU too but will be slow.
# Model weights downloaded on first run into /root/.cache/huggingface.
FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    DEBIAN_FRONTEND=noninteractive \
    HF_HOME=/root/.cache/huggingface

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        python3-venv \
        poppler-utils \
        curl \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3 /usr/bin/python

RUN pip install --upgrade pip \
    && pip install \
        fastapi==0.115.0 \
        "uvicorn[standard]==0.30.6" \
        python-multipart==0.0.9 \
        chandra-ocr

WORKDIR /opt
COPY service.py /opt/service.py

EXPOSE 7860

CMD ["uvicorn", "service:app", "--host", "0.0.0.0", "--port", "7860", "--app-dir", "/opt"]
