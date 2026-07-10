"""Shared OpenRouter chat-model factory.

Both the reader chat view (``views_chat.py``) and the CopilotKit deep-agent
sidecar (``agent_service/``) build their LangChain ``ChatOpenAI`` client through
this helper so the OpenRouter endpoint, model, and attribution headers never
drift between the two call sites. Configuration comes from the same environment
variables used across the project: ``OPENROUTER_API_KEY``,
``OPENROUTER_AGENT_MODEL`` and ``OPENROUTER_REFERER``.
"""
import os

OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
DEFAULT_AGENT_MODEL = 'google/gemini-3.1-flash-lite'


def get_agent_model() -> str:
    """Return the OpenRouter model id the agent/chat should use."""
    return os.environ.get('OPENROUTER_AGENT_MODEL', DEFAULT_AGENT_MODEL)


def make_openrouter_chat(
    *,
    model: str | None = None,
    streaming: bool = True,
    max_tokens: int = 2048,
    x_title: str = 'ILM Shamela',
    **kwargs,
):
    """Return a LangChain ``ChatOpenAI`` pointed at OpenRouter.

    ``langchain_openai`` is imported lazily so importing this module never
    hard-requires the dependency. Raises ``RuntimeError`` when
    ``OPENROUTER_API_KEY`` is unset so callers can surface a clear error.
    """
    from langchain_openai import ChatOpenAI

    api_key = os.environ.get('OPENROUTER_API_KEY')
    if not api_key:
        raise RuntimeError('OPENROUTER_API_KEY is not configured')

    return ChatOpenAI(
        model=model or get_agent_model(),
        api_key=api_key,
        base_url=OPENROUTER_BASE_URL,
        max_tokens=max_tokens,
        streaming=streaming,
        default_headers={
            'HTTP-Referer': os.environ.get('OPENROUTER_REFERER', 'https://ilm-shamela.local'),
            'X-Title': x_title,
        },
        **kwargs,
    )
