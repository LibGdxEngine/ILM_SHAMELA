<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-07-03 | Updated: 2026-07-03 -->

# backend/agent_service

## Purpose
FastAPI sidecar (runs on port 8123) that exposes two CopilotKit-connected LangChain deepagents agents over the AG-UI protocol:
1. **Library Agent** (`/`): research assistant for discovering books, manuscripts, and passages across the full ILM Shamela collection. Feeds the `/documents` library discovery page.
2. **Reader Agent** (`/reader`): scoped to a single book, helps users find and understand specific pages/passages within that book. Feeds the in-book assistant drawer in the reader page.

Both agents run ``django.setup()`` on import and call the existing Elasticsearch search layer directly (no HTTP hop), so they share exact ranking/snippet logic with the REST API. The LLM is OpenRouter (configurable model via `OPENROUTER_AGENT_MODEL` env var).

## Key Files
| File | Description |
|------|-------------|
| __init__.py | Package docstring: brief description of the sidecar and its entrypoint (`agent_service.main:app`). |
| main.py | **FastAPI app** (`app = FastAPI(title="ILM Shamela Library Agent")`). Loads `django.setup()` on import. Mounts two AG-UI endpoints via `_mount()`: library agent at `/` and reader agent at `/reader`. Fail-fast on import error (if agents can't build, the process exits non-zero). `POST /{path}` routes to the agent graph. `GET /health` returns OK once both agents mounted. |
| agent.py | **System prompts + graph builder**. Defines two system prompts: `SYSTEM_PROMPT` (library-wide search, multi-attempt strategy with keyword suggestions, snippet presentation as Markdown links) and `READER_SYSTEM_PROMPT` (scoped to current book, page-level focus, pinned passages support, page citations as `[page N](#p-N)` links). `_build_deep_agent()` constructs a compiled LangGraph graph with CopilotKitMiddleware (gracefully degraded if unavailable), OpenRouter LLM, tools, and recursion limit (default 60, configurable via env). `build_agent()` and `build_reader_agent()` entry points. Imports tools from `tools.py` and LLM builder from `search_engine.llm`. |
| tools.py | **LangChain tools** for both agents. **Library tools**: `search_library()` (BM25 + semantic search across corpus), `suggest_alternative_keywords()` (Elasticsearch significant_text over fuzzy/semantic matches), `search_within_book()` (page-level passages in a document). **Reader tools**: `search_within_book()`, `get_book_pages()` (full text of specific page(s), capped at 5 pages per call). All tools return JSON strings; Django/ORM calls happen synchronously inside each tool (safe, runs in LangGraph's threadpool). |

## Subdirectories
(none)

## For AI Agents

### Working In This Directory
- **Build and mount both agents**: `main.py` imports `build_agent()` and `build_reader_agent()` on startup and mounts at `/` and `/reader`. Failure at import time causes the container to exit non-zero.
- **Run the sidecar**: `docker-compose` starts it as the `agent` service; entrypoint is `uvicorn agent_service.main:app --host 0.0.0.0 --port 8123`. Can also run locally: `uvicorn agent_service.main:app`.
- **Django setup on import**: Module runs `django.setup()` at import time (in `agent.py`), so the settings file must be valid and env vars set **before** the agent service starts.
- **OpenRouter model**: Set via `OPENROUTER_AGENT_MODEL` env var; falls back if not set (see `search_engine.llm.make_openrouter_chat()`). The sidecar will fail to start if `OPENROUTER_API_KEY` is not set.
- **Recursion limit**: Cap on LangGraph steps; set to 60 by default (env `AGENT_RECURSION_LIMIT`). Raised from default 25 because deepagents planning steps add overhead.
- **Health probe**: `GET /health` returns `{"status": "ok", "agents": ["libraryAgent", "readerAgent"]}` only after both agents mounted successfully.
- **AG-UI protocol**: Both endpoints accept HTTP POST with `messages` (list of dicts: {role, content}) and optional `state` context. Returns agent output with same shape.

### Testing Requirements
- **No unit tests for this module** in the codebase; it is an integration service
- **Manual testing**: Start the container and curl the agents: `curl -X POST http://localhost:8123/ -H "Content-Type: application/json" -d '{"messages": [{"role": "user", "content": "find books about Islamic law"}]}'`
- **Health check**: `curl http://localhost:8123/health` should return 200 + agent names
- **Verify Django integration**: Agent tools should successfully call `execute_corpus_search()` and other `search_engine` functions; if Elasticsearch or database are down, tool calls fail gracefully with error JSON

### Common Patterns
- **Tool return format**: All tools return JSON strings (via `_dump()`) to work with LangGraph; caller deserializes in agent
- **Library agent workflow**: search_library → suggest_alternative_keywords (on low matches) → search_within_book (for content Q&A)
- **Reader agent workflow**: search_within_book (find passages) or get_book_pages (current page + context)
- **System prompt strategy**: Library agent limits search attempts (4 max) to avoid infinite loops; reader agent stays scoped to one book
- **URL building**: `search_library` results include `"url": f"/documents/{doc.id}"` for Markdown links in agent response
- **Citation format**: Reader agent uses `[page N](#p-N)` for page links; library agent uses `[Book Title](url)` for book links
- **Snippet field**: `search_within_book` returns page-level snippets; agent presents them as-is or summarizes

## Dependencies

### Internal
- **agent.py imports**:
  - `search_engine.llm.make_openrouter_chat()` — LLM builder (OpenRouter model + API key)
  - `tools.LIBRARY_TOOLS, tools.READER_TOOLS` — LangChain tool definitions
- **tools.py imports**:
  - `search_engine.views.execute_corpus_search()` — main library search entry point
  - `search_engine.views.search_within_document()` — page-level search in one book
  - `search_engine.keyword_expansion.suggest_alternative_keywords()` — corpus-grounded keyword suggestions
  - `search_engine.models.Document` — ORM model
  - `search_engine.utils.split_document_content_into_pages()` — page parsing utility
  - Django models/shortcuts: `get_object_or_404()`, User model (via get_user_model if needed)
- **main.py imports**:
  - `agent.build_agent()`, `agent.build_reader_agent()` — graph builders
  - `copilotkit.LangGraphAGUIAgent`, `ag_ui_langgraph.add_langgraph_fastapi_endpoint` — AG-UI protocol wiring

### External
- **FastAPI**: HTTP server framework
- **deepagents >= 0.6.0**: Agentic framework for planning + tool orchestration
- **LangGraph >= 0.2.0**: State graph and recursion management
- **LangChain Core**: Tool definitions, structured output
- **CopilotKit >= 0.1.9**: Middleware for generative UI / tool streaming
- **ag-ui-langgraph >= 0.0.1**: FastAPI endpoint adapter for AG-UI protocol
- **Django 5.x**: ORM, settings, app initialization
- **Elasticsearch (via search_engine)**: Document search backend
- **PostgreSQL (via search_engine.models)**: Document metadata
- **OpenRouter API**: LLM inference (via `OPENROUTER_API_KEY` env var)

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
