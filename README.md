# ILM Shamela

ILM Shamela is a full-stack document intelligence platform for uploading, processing, indexing, and searching multilingual texts (including Arabic).  
The system combines Django + Celery + Elasticsearch on the backend and Next.js on the frontend.

## What It Does
- Authenticated document ingestion with metadata (authors, categories, alternate titles, cover photos).
- Asynchronous text extraction and language detection pipeline.
- Full-text and in-document search with hybrid lexical + semantic reranking metadata.
- Paginated reader view with in-document highlighting.
- Operational endpoints for liveness/readiness and Prometheus-style metrics export.

## Architecture
See `docs/architecture.md` for data flow and service responsibilities.

## Quickstart
1. Copy `.env.example` to `.env` and fill required values.
2. Start the stack:
```bash
docker compose up --build
```
3. Open:
- Frontend: `https://localhost`
- Backend API root (via Caddy): `https://localhost/api/`
- Health checks:
  - `https://localhost/api/health/live/`
  - `https://localhost/api/health/ready/`

## Required Environment Variables
Minimum required for backend startup:
- `SECRET_KEY`
- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`

Commonly used:
- `DEBUG`
- `ALLOWED_HOSTS`
- `CORS_ALLOWED_ORIGINS`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

For details, see `docs/security.md` and `docs/operations.md`.

## API Quick Examples
See complete API in `docs/api.md`.

### Login (email/password)
```bash
curl -X POST https://localhost/api/auth/login/ \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"your-password"}' \
  -k -c cookies.txt
```

### Upload a Document
```bash
curl -X POST https://localhost/api/search_engine/documents/ \
  -b cookies.txt \
  -F "title=Sample Manuscript" \
  -F "file=@/path/to/file.pdf" \
  -k
```

### Search Documents
```bash
curl "https://localhost/api/search_engine/documents/search/?q=history" \
  -b cookies.txt \
  -k
```

## Screenshots / Demo
Place screenshots in `docs/assets/` and reference them here, for example:
- `docs/assets/homepage.png`
- `docs/assets/documents-grid.png`
- `docs/assets/reader-view.png`

## Testing
Backend:
```bash
cd backend
SECRET_KEY=test-secret POSTGRES_DB=test POSTGRES_USER=test POSTGRES_PASSWORD=test USE_SQLITE_FOR_TESTS=true python manage.py test
```

Frontend:
```bash
cd frontend
npm install
npm run lint
npm run test
npm run build
```

## CI
GitHub Actions workflow: `.github/workflows/ci.yml`
- Backend checks + tests
- Frontend lint + unit tests + build
- Docker compose smoke build

## Security + Operations
- Security posture: `docs/security.md`
- Operational runbook: `docs/operations.md`
