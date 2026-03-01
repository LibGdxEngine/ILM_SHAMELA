# API Reference (Core)

Base path: `/api/`

## Authentication
- `POST /auth/login/`
- `POST /auth/logout/`
- `GET /auth/user/`
- `PATCH /auth/user/` (authenticated user updates own profile fields)
- `POST /auth/registration/`
- `POST /auth/google/`

### Profile update payload (`PATCH /auth/user/`)
- Allowed writable fields:
  - `name` (alias; splits into `first_name` + `last_name`)
  - `first_name`
  - `last_name`
  - `email`
  - `avatar` (URL string)
  - `current_password` + `new_password` + `new_password_confirm` (all three required for password change)
- Read-only fields:
  - `pk`
  - `username`

All `search_engine` endpoints require authenticated users.

## Documents
- `GET /search_engine/documents/`
- `POST /search_engine/documents/` (editor/admin)
- `GET /search_engine/documents/{id}/`
- `PATCH /search_engine/documents/{id}/` (editor/admin)
- `DELETE /search_engine/documents/{id}/` (editor/admin)
- `GET /search_engine/documents/{id}/status/`
- `GET /search_engine/documents/{id}/pages/?page=1&page_size=5`
- `GET /search_engine/documents/{id}/search/?q=...`
- `GET /search_engine/documents/search/?q=...`
- `GET /search_engine/documents/suggest/?q=...`

### Search response additions
Each result can include:
- `score_lexical`
- `score_semantic`
- `score_final`
- `explanations.matched_fields`
- `explanations.weights`

## Authors and Categories
- `GET /search_engine/authors/`
- `GET /search_engine/authors/{id}/`
- `GET /search_engine/categories/`

## Operations
- `GET /health/live/`
- `GET /health/ready/`
- `GET /metrics/` (admin-only)
