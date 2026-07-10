"""LangChain tools for the CopilotKit library deep agent.

These wrap the existing Django/Elasticsearch search layer directly (the sidecar
runs ``django.setup()`` before these tools are ever called), so there is no HTTP
hop and the agent shares the exact ranking logic used by the REST API. Tools are
synchronous; LangGraph runs them in a threadpool, which is safe for the Django
ORM. Django-dependent imports are done inside each function so importing this
module never requires a configured Django before ``django.setup()`` has run.
"""
import json
import logging

from langchain_core.tools import tool

logger = logging.getLogger(__name__)

MAX_LIBRARY_RESULTS = 8
# Cap on how many pages get_book_pages will inline in one call, to keep the
# reader agent's context bounded even if the model asks for a wide window.
MAX_BOOK_PAGES = 5


def _dump(payload) -> str:
    return json.dumps(payload, ensure_ascii=False)


@tool
def search_library(
    query: str,
    authors: str = "",
    categories: str = "",
    language: str = "",
) -> str:
    """Search the whole ILM Shamela library for books/manuscripts matching a query.

    Combines BM25 keyword matching (with fuzziness for spelling variants) and
    semantic vector search. This is the primary tool for finding which books
    discuss a topic, term, or author. Returns the top matches with title,
    authors, why they matched, a short snippet, a relevance score, and a `url`
    to open the book, plus the total number of matches. To answer what a book
    actually SAYS (not just that it exists), follow up with search_within_book.

    Args:
        query: The word, phrase, author, or topic to search for (Arabic or otherwise).
        authors: Optional comma-separated author names to filter by.
        categories: Optional comma-separated category names to filter by.
        language: Optional language code filter (e.g. "ar").
    """
    from search_engine.views import execute_corpus_search

    query = (query or "").strip()
    if not query:
        return _dump({"error": "query is required"})

    filters = {}
    if authors.strip():
        filters["authors"] = authors.strip()
    if categories.strip():
        filters["categories"] = categories.strip()
    if language.strip():
        filters["language"] = language.strip()

    try:
        ordered_docs, metadata = execute_corpus_search(
            query, filters=filters or None, include_snippets=True
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("[AGENT] search_library failed")
        return _dump({"error": str(exc)})

    results = []
    for doc in ordered_docs[:MAX_LIBRARY_RESULTS]:
        meta = metadata.get(doc.id, {})
        results.append({
            "id": doc.id,
            "title": doc.title,
            # In-app path to open this book. Present it to the user as a Markdown
            # link [title](url) so it's clickable.
            "url": f"/documents/{doc.id}",
            "authors": ", ".join(a.name for a in doc.authors.all()) or "unknown",
            "score": meta.get("score_final"),
            "matched_fields": meta.get("explanations", {}).get("matched_fields", []),
            "snippet": meta.get("snippet", ""),
        })
    return _dump({
        "query": query,
        "total_matches": len(ordered_docs),
        "results": results,
    })


@tool
def suggest_alternative_keywords(query: str) -> str:
    """Find alternative/related search keywords when an exact term or meaning isn't found.

    Returns vocabulary drawn from the ACTUAL corpus (Elasticsearch significant_text
    over documents that match the term fuzzily or semantically), NOT invented
    synonyms. Call this whenever search_library returns few or zero matches, then
    retry search_library with the most promising suggested terms.

    Args:
        query: The term or phrase that returned too few results.
    """
    from search_engine.keyword_expansion import suggest_alternative_keywords as _suggest

    try:
        return _dump(_suggest(query))
    except Exception as exc:  # noqa: BLE001
        logger.exception("[AGENT] suggest_alternative_keywords failed")
        return _dump({"error": str(exc)})


@tool
def search_within_book(document_id: int, query: str, mode: str = "mix") -> str:
    """Search inside ONE specific book (by its library id) for relevant passages.

    Use after search_library to pull page-level snippets from a chosen book.

    Args:
        document_id: The library document id (from search_library results).
        query: The word, phrase, or topic to find inside that book.
        mode: One of "exact", "similar", "semantic", "mix" (default "mix").
    """
    from django.shortcuts import get_object_or_404
    from search_engine.models import Document
    from search_engine.views import search_within_document

    try:
        document = get_object_or_404(Document, pk=document_id)
        result = search_within_document(document, query, mode=mode, top_k=5)
        edition = document.primary_edition
    except Exception as exc:  # noqa: BLE001
        logger.exception("[AGENT] search_within_book failed")
        return _dump({"error": str(exc)})

    return _dump({
        "document_id": document_id,
        "query": query,
        "total_matches": result.get("total_matches", 0),
        "matches": [
            {
                "page": m["page_number"],
                "snippet": m["snippet"],
                # Printed-edition reference (volume + printed page) when the
                # document has an edition page_map — cite it in visible labels.
                "printed_ref": (
                    edition.printed_ref(m["page_number"]) if edition else None
                ),
            }
            for m in result.get("matches", [])
        ],
    })


@tool
def get_book_pages(document_id: int, pages: str) -> str:
    """Read the FULL text of specific page(s) of one book (by its library id).

    Use this for questions about what is on the page the user is currently
    reading (and its immediate neighbours), where a keyword search is not the
    right tool. For example, if the user is on page 42 and asks "explain this
    page", call get_book_pages(document_id, "41,42,43"). Prefer
    search_within_book when the user is looking for where a term/topic appears.

    Args:
        document_id: The library document id (from the reader context).
        pages: Comma-separated page numbers to fetch, e.g. "42" or "41,42,43".
    """
    from django.shortcuts import get_object_or_404
    from search_engine.models import Document
    from search_engine.utils import split_document_content_into_pages

    try:
        requested: list[int] = []
        for token in str(pages or "").replace(" ", "").split(","):
            if not token:
                continue
            try:
                pn = int(token)
            except ValueError:
                continue
            if pn not in requested:
                requested.append(pn)
        if not requested:
            return _dump({"error": "pages is required (e.g. \"42\" or \"41,42,43\")"})
        requested = requested[:MAX_BOOK_PAGES]

        document = get_object_or_404(Document, pk=document_id)
        by_number = {
            p["page_number"]: p["content"]
            for p in split_document_content_into_pages(document.content or "")
        }
        edition = document.primary_edition
    except Exception as exc:  # noqa: BLE001
        logger.exception("[AGENT] get_book_pages failed")
        return _dump({"error": str(exc)})

    result_pages = [
        {
            "page": pn,
            "content": by_number[pn] or "[page has no extracted content]",
            "printed_ref": edition.printed_ref(pn) if edition else None,
        }
        for pn in requested
        if pn in by_number
    ]
    return _dump({
        "document_id": document_id,
        "pages": result_pages,
        "missing": [pn for pn in requested if pn not in by_number],
    })


LIBRARY_TOOLS = [search_library, suggest_alternative_keywords, search_within_book]
# The reader agent works inside ONE book: page-level search + full-page reads.
# It deliberately omits search_library so it stays scoped to the current book.
READER_TOOLS = [search_within_book, get_book_pages]
