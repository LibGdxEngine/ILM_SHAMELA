"""
The reading assistant's single tool: hybrid in-book search.

The chat view binds `TOOL_SCHEMAS` to the LLM and, when the model emits a tool
call, dispatches it through a per-request registry built by
`build_tool_registry(document, user)`. The registry closes the document over the
callable so the **LLM never supplies a document id** — it only passes the query.

`search_in_document` runs Elasticsearch fuzzy keyword matching merged with
per-chunk vector similarity (0.60*lexical + 0.40*semantic) via
`views.search_within_document`, returning ranked page snippets plus a
`total_matches` count.
"""
import logging
from typing import Callable, Dict

logger = logging.getLogger(__name__)

# Default number of ranked passages the search tool returns.
DEFAULT_TOP_K = 5


def _search_in_document(document, query: str, top_k: int = DEFAULT_TOP_K) -> Dict:
    query = (query or '').strip()
    if not query:
        return {'error': 'query is required'}
    # Imported lazily to avoid a circular import (views imports models/semantic,
    # not agent_tools).
    from .views import search_within_document
    result = search_within_document(document, query, top_k=top_k)
    return {
        'query': query,
        'total_matches': result.get('total_matches', 0),
        'matches': [
            {'page': m['page_number'], 'snippet': m['snippet']}
            for m in result.get('matches', [])
        ],
    }


# Schema the model sees (OpenAI function-calling format; LangChain `bind_tools`
# accepts these dicts directly). Note: NO document_id parameter.
TOOL_SCHEMAS = [
    {
        'type': 'function',
        'function': {
            'name': 'search_in_document',
            'description': (
                'Search INSIDE this book for passages relevant to a query. '
                'Combines fuzzy keyword matching (catches exact and near-exact / '
                'variant spellings) with semantic vector search, so it finds both '
                'the specific words the user mentions and related ideas. Use it to '
                'locate where something is discussed, to gather evidence before '
                'answering, and — via total_matches — to gauge roughly how often a '
                'term appears. Returns ranked page snippets.'
            ),
            'parameters': {
                'type': 'object',
                'properties': {
                    'query': {
                        'type': 'string',
                        'description': 'The word, phrase, or topic to search for.',
                    },
                    'top_k': {
                        'type': 'integer',
                        'description': f'Max passages to return (default {DEFAULT_TOP_K}).',
                    },
                },
                'required': ['query'],
            },
        },
    },
]


def build_tool_registry(document, user=None) -> Dict[str, Callable[..., Dict]]:
    """Return ``{tool_name: callable(**llm_args) -> dict}`` with `document` bound.
    The dispatcher in the chat view looks tools up here by the name the model
    emitted and calls them with the model-supplied args."""
    return {
        'search_in_document': lambda query, top_k=DEFAULT_TOP_K: _search_in_document(
            document, query, top_k
        ),
    }
