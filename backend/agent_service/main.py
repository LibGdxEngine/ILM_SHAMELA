"""FastAPI sidecar exposing the library deep agent over the AG-UI protocol.

Run:  uvicorn agent_service.main:app --host 0.0.0.0 --port 8123

The Next.js CopilotKit runtime route (``/api/copilotkit``) bridges to this
service via an AG-UI ``HttpAgent``. If the agent can't be built or mounted (e.g.
``OPENROUTER_API_KEY`` is unset, or a deepagents/copilotkit version skew), we
FAIL FAST — the import raises and the process exits non-zero so the orchestrator
restarts/alerts, instead of a "healthy" container that 404s every request.
"""
import logging
import os

from fastapi import FastAPI

logger = logging.getLogger(__name__)

app = FastAPI(title="ILM Shamela Library Agent")

AGENT_NAME = "libraryAgent"
# The in-book reading assistant, mounted alongside the library agent. Same
# sidecar, its own AG-UI endpoint (path "/reader") and its own graph/prompt/tools
# so the reader stays hard-scoped to the current book without regressing the
# library flow. The Node CopilotKit route selects it via agent="readerAgent".
READER_AGENT_NAME = "readerAgent"
# LangGraph's default recursion limit is 25 steps. deepagents spends steps on its
# own planning (write_todos) on top of each tool round, so a normal multi-search
# turn can exceed 25 and crash with GraphRecursionError. Raise the ceiling (the
# prompt separately caps actual search attempts so this is only a safety net).
AGENT_RECURSION_LIMIT = int(os.environ.get("AGENT_RECURSION_LIMIT", "60"))


def _mount(*, name: str, description: str, graph, path: str) -> None:
    """Mount a compiled graph as an AG-UI endpoint at ``path``."""
    from copilotkit import LangGraphAGUIAgent
    from ag_ui_langgraph import add_langgraph_fastapi_endpoint

    add_langgraph_fastapi_endpoint(
        app=app,
        agent=LangGraphAGUIAgent(
            name=name,
            description=description,
            graph=graph,
            # Propagates into the graph run config (ag_ui_langgraph agent.py:203).
            config={"recursion_limit": AGENT_RECURSION_LIMIT},
        ),
        path=path,
    )
    logger.info("Mounted AG-UI endpoint for agent '%s' at '%s'", name, path)


def _build_and_mount() -> None:
    """Build and mount both deep agents (library at ``/``, reader at ``/reader``)."""
    from .agent import build_agent, build_reader_agent

    _mount(
        name=AGENT_NAME,
        description="ILM Shamela library research agent",
        graph=build_agent(),
        path="/",
    )
    _mount(
        name=READER_AGENT_NAME,
        description="ILM Shamela in-book reading assistant",
        graph=build_reader_agent(),
        path="/reader",
    )


try:
    _build_and_mount()
except Exception:
    # Fail fast: a mount failure means the service can't serve the agent at all,
    # so crash the process rather than start up and 404 silently.
    logger.exception("Failed to build/mount the agents; exiting")
    raise


@app.get("/health")
def health():
    """Liveness probe. Only reachable once both agents mounted successfully."""
    return {"status": "ok", "agents": [AGENT_NAME, READER_AGENT_NAME]}
