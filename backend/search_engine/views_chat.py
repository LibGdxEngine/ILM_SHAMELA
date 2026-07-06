"""
AI assistant views for the document reader.

Endpoints:
  GET  /documents/<id>/chat/sessions/                       List the user's sessions
  POST /documents/<id>/chat/sessions/                       Create a new session
  GET  /documents/<id>/chat/sessions/<sid>/messages/        Message history
  POST /documents/<id>/chat/sessions/<sid>/messages/        Send a user message;
                                                            streams the assistant
                                                            reply as Server-Sent Events

The LLM call is routed through LangChain (`langchain-openai` pointed at the
OpenRouter base URL) so the project stays provider-agnostic. See memory
`feedback-use-langchain`. Default model: google/gemini-2.5-flash-lite.

Streaming protocol (text/event-stream):
  event: delta     data: {"text": "..."}     (repeated)
  event: done      data: {"message_id": N, "citations": [...]}
  event: error     data: {"error": "..."}
"""
import json
import logging
import os
import re
from typing import List, Tuple

from django.http import StreamingHttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import generics, permissions, status, views
from rest_framework.response import Response

from .models import (
    ChatMessage,
    ChatSession,
    Document,
    DocumentChunk,
    LibraryChatMessage,
    LibraryChatSession,
)
from .serializers_reader import (
    ChatMessageSerializer,
    ChatMessageWriteSerializer,
    ChatSessionSerializer,
    LibraryChatMessageSerializer,
    LibraryChatMessageWriteSerializer,
    LibraryChatSessionSerializer,
)
from .utils import split_document_content_into_pages


logger = logging.getLogger(__name__)

MAX_HISTORY_MESSAGES = 20
# Threshold for full-document vs RAG context. Documents whose total extracted
# text exceeds this are answered via retrieval over DocumentChunk embeddings.
MAX_DOCUMENT_CONTEXT_CHARS = 60_000
# Cap on how many characters of user-pinned passages are injected inline.
MAX_PINNED_INLINE_CHARS = 6000
RAG_TOP_K = 10
DEFAULT_MODEL = os.environ.get('OPENROUTER_CHAT_MODEL', 'google/gemini-2.5-flash-lite')
# The assistant runs as a tool-calling agent (counting, metadata, chapters,
# in-document search). The agent model is separately configurable from the
# plain-chat model so it can be tuned for tool-call reliability. langchain-anthropic
# is already a dependency, so a Claude model id works here too if Gemini misfires.
AGENT_MODEL = os.environ.get('OPENROUTER_AGENT_MODEL', 'google/gemini-3.1-flash-lite')
# Max tool-call rounds before we force a final prose answer (loop termination).
MAX_TOOL_ROUNDS = 3
OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
CITATION_RE = re.compile(r'<cite\s+page="(\d+)">(.*?)</cite>', re.IGNORECASE | re.DOTALL)
# The CopilotKit reader agent cites pages as Markdown links `[label](#p-N)`
# (the `<cite>` tag is stripped by the client Markdown sanitizer). Capture both
# so stored history keeps consistent citation metadata regardless of source.
PAGE_LINK_CITATION_RE = re.compile(r'\[([^\]]*)\]\(#p-(\d+)\)')


def _sse(event: str, payload: dict) -> bytes:
    """Format a Server-Sent Event frame."""
    body = json.dumps(payload, ensure_ascii=False)
    return f'event: {event}\ndata: {body}\n\n'.encode('utf-8')


def _pinned_block(pinned: list | None) -> str:
    """Render user-pinned passages as an authoritative <pinned> block.

    Returns '' when nothing is pinned. Injection stops once the accumulated
    text would exceed MAX_PINNED_INLINE_CHARS, so a long pin list is truncated
    rather than blowing up the prompt.
    """
    if not pinned:
        return ''
    parts: List[str] = []
    used = 0
    for item in pinned:
        page = item.get('page')
        label = item.get('label') or f'page {page}'
        text = item.get('text', '')
        rendered = f'\n[{label} — page {page}]\n{text}'
        if used + len(rendered) > MAX_PINNED_INLINE_CHARS:
            # Skip this oversized pin but keep filling: a large early pin must
            # not starve smaller later pins that still fit under the cap.
            continue
        parts.append(rendered)
        used += len(rendered)
    if not parts:
        return ''
    return (
        '\n\n<pinned>\n'
        'These are passages the user has pinned as authoritative. Always use '
        'them when answering and prefer them over other context.'
        f'{"".join(parts)}\n'
        '</pinned>'
    )


def _build_system_prompt(
    document: Document,
    current_page: int | None,
    available_pages: List[int] | None = None,
    pinned: list | None = None,
) -> str:
    title = document.title
    authors = ', '.join(a.name for a in document.authors.all()) or 'unknown'
    page_hint = f' Current page being read: {current_page}.' if current_page else ''
    coverage_note = ''
    if available_pages:
        # RAG mode: only the most relevant pages are inline. The model can reach
        # the rest of the book through the search_in_document tool.
        pages_str = ', '.join(str(p) for p in available_pages)
        coverage_note = (
            '\n\nNOTE: To keep the context concise, only the most relevant '
            f'pages were included inline for this turn: {pages_str}. The rest of '
            'the book is NOT in your context — to answer about other parts, call '
            'search_in_document rather than guessing.'
        )
    tools_note = (
        '\n\nYou have one tool, search_in_document(query), which searches THIS '
        'book by combining fuzzy keyword matching (exact and near-exact spellings) '
        'with semantic search, and returns ranked page snippets plus total_matches. '
        'Call it to locate specific words/passages and to gather evidence before '
        'answering — do not guess at wording or invent page numbers. When asked '
        'roughly how often a term appears, use total_matches, and say it reflects '
        'matching passages rather than an exact count.'
    )
    return (
        'You are a thoughtful Arabic-literate reading assistant embedded in '
        'a document reader app. The user is reading the document below.\n\n'
        f'Title: {title}\n'
        f'Authors: {authors}\n'
        f'Language: {document.language or "ar"}\n'
        f'{page_hint}\n\n'
        'When you quote or refer to a specific passage, wrap the reference in '
        '<cite page="N">short quote</cite> tags so the UI can render citations '
        'that link back to that page. Prefer concise, direct answers. If the '
        'answer is not in the provided document, say so.'
        f'{tools_note}'
        f'{coverage_note}'
        f'{_pinned_block(pinned)}'
    )


def _full_document_context(document: Document) -> Tuple[str, List[int]]:
    """Return the full document content (up to MAX_DOCUMENT_CONTEXT_CHARS)
    formatted with page markers, plus the list of pages included.
    """
    pages = split_document_content_into_pages(document.content or '')
    parts: List[str] = []
    page_numbers: List[int] = []
    used = 0
    for page in pages:
        chunk = f'\n[page {page["page_number"]}]\n{page["content"]}'
        if used + len(chunk) > MAX_DOCUMENT_CONTEXT_CHARS:
            parts.append(
                f'\n[…document truncated at {MAX_DOCUMENT_CONTEXT_CHARS} chars]'
            )
            break
        parts.append(chunk)
        page_numbers.append(page['page_number'])
        used += len(chunk)
    text = ''.join(parts).strip() or '[document has no extracted content]'
    return text, page_numbers


def _rag_context_block(document: Document, user_question: str) -> Tuple[str, List[int]]:
    """Select the most relevant pages via hybrid (fuzzy keyword + vector) search,
    then feed those pages' full text to the model. This is the same retrieval the
    `search_in_document` tool uses, so the baseline context already merges exact-word
    and semantic matches. Falls back to a truncated full-document slice when search
    is unavailable or returns nothing.
    """
    from .views import search_within_document  # lazy: avoid import cycle at load

    try:
        result = search_within_document(document, user_question, top_k=RAG_TOP_K)
    except Exception:  # noqa: BLE001
        logger.warning('[CHAT] RAG: hybrid search failed, falling back to full doc', exc_info=True)
        return _full_document_context(document)

    matches = result.get('matches', [])
    if not matches:
        logger.info('[CHAT] RAG: hybrid search found nothing for doc=%s, falling back', document.id)
        return _full_document_context(document)

    # Ranked, de-duplicated pages (search may return several snippets per page).
    ranked_pages: List[int] = []
    for match in matches:
        pn = match['page_number']
        if pn not in ranked_pages:
            ranked_pages.append(pn)

    # Pull each ranked page's full text. DocumentChunk.page_number is the same
    # positional page the search maps snippets to, so these align with the
    # citation pages the model will reference.
    chunk_rows = (
        DocumentChunk.objects
        .filter(document=document, page_number__in=ranked_pages)
        .values('page_number', 'chunk_index', 'content')
    )
    content_by_page: dict = {}
    for row in chunk_rows:
        content_by_page.setdefault(row['page_number'], []).append(
            (row['chunk_index'], row['content'])
        )

    parts: List[str] = []
    page_numbers: List[int] = []
    for pn in ranked_pages:
        rows = sorted(content_by_page.get(pn, []), key=lambda r: r[0])
        if rows:
            body = '\n'.join(content for _idx, content in rows)
        else:
            # Lexical-only page with no stored chunk: fall back to the snippet.
            body = next(
                (re.sub(r'</?mark>', '', m['snippet'])
                 for m in matches if m['page_number'] == pn),
                '',
            )
        parts.append(f"\n[page {pn}]\n{body}\n---")
        page_numbers.append(pn)
    text = ''.join(parts).strip() or '[no relevant passages found]'
    return text, page_numbers


def _document_context_block(
    document: Document, user_question: str
) -> Tuple[str, List[int]]:
    """Hybrid context: send the full document when small enough, otherwise
    fall back to RAG over per-chunk embeddings.

    Returns (context_text, page_numbers_included).
    """
    total_chars = len(document.content or '')
    if total_chars <= MAX_DOCUMENT_CONTEXT_CHARS:
        return _full_document_context(document)

    logger.info(
        '[CHAT] RAG mode: doc=%s chars=%s threshold=%s',
        document.id, total_chars, MAX_DOCUMENT_CONTEXT_CHARS,
    )
    return _rag_context_block(document, user_question)


def _page_context_block(
    document: Document, current_page: int
) -> Tuple[str, List[int]]:
    """Return the current page plus any existing ±1 neighbors as context.

    Returns (context_text, page_numbers_included); the text falls back to a
    "[page has no extracted content]" marker when nothing is available.
    """
    pages = split_document_content_into_pages(document.content or '')
    by_number = {p['page_number']: p['content'] for p in pages}
    parts: List[str] = []
    page_numbers: List[int] = []
    for pn in (current_page - 1, current_page, current_page + 1):
        if pn not in by_number:
            continue
        content = by_number[pn] or '[page has no extracted content]'
        parts.append(f'\n[page {pn}]\n{content}')
        page_numbers.append(pn)
    text = ''.join(parts).strip() or '[page has no extracted content]'
    return text, page_numbers


def _context_for_scope(
    document: Document,
    user_question: str,
    scope: str,
    current_page: int | None,
) -> Tuple[str, List[int], bool]:
    """Resolve the document context for a session's context_scope.

    Returns (context_text, inline_pages, partial). `partial` is True when the
    book has any page NOT inline this turn, which gates the coverage note. It is
    derived by comparing the inline pages against the document's total page
    count rather than raw content length, so it correctly handles a "full"
    document that page-marker overhead silently truncated, and a short book
    whose entire text already fits the page-scope window.
    """
    if scope == 'page' and current_page:
        text, pages = _page_context_block(document, current_page)
    elif scope == 'book':
        if len(document.content or '') <= MAX_DOCUMENT_CONTEXT_CHARS:
            text, pages = _full_document_context(document)
        else:
            text, pages = _rag_context_block(document, user_question)
    else:
        # auto scope, or page scope without a known current page
        text, pages = _document_context_block(document, user_question)

    total_pages = len(split_document_content_into_pages(document.content or ''))
    partial = len(set(pages)) < total_pages
    return text, pages, partial


TITLE_MAX = 60


def _derive_title(text: str) -> str:
    """Collapse whitespace and clip to TITLE_MAX chars for a session title."""
    flat = ' '.join((text or '').split())
    return flat if len(flat) <= TITLE_MAX else flat[:TITLE_MAX - 1].rstrip() + '…'


def _extract_citations(text: str) -> list[dict]:
    """Pull page citations from either the legacy `<cite>` tags (reader SSE agent)
    or the CopilotKit `[label](#p-N)` Markdown links (reader deep agent).
    """
    text = text or ''
    citations = [
        {'page': int(m.group(1)), 'quote': m.group(2).strip()}
        for m in CITATION_RE.finditer(text)
    ]
    citations += [
        {'page': int(m.group(2)), 'quote': m.group(1).strip()}
        for m in PAGE_LINK_CITATION_RE.finditer(text)
    ]
    return citations


def _enrich_citations(document, citations: list[dict]) -> list[dict]:
    """Attach the printed-edition reference to each citation (موافقة المطبوع).

    The digital ``page`` stays the canonical anchor (it drives page jumps); when
    the document has an Edition with a page_map, each citation additionally gets
    ``volume``/``printed_page`` so the UI can render an academically citable
    label like "ج2 ص143". Citations without a mapped page pass through unchanged.
    """
    if not citations:
        return citations
    edition = document.primary_edition
    if edition is None:
        return citations
    enriched = []
    for citation in citations:
        page = citation.get('page') if isinstance(citation, dict) else None
        ref = edition.printed_ref(page) if isinstance(page, int) else None
        if ref:
            citation = {
                **citation,
                'volume': ref['volume'],
                'printed_page': ref['printed_page'],
            }
        enriched.append(citation)
    return enriched


class ChatSessionListCreateView(generics.ListCreateAPIView):
    """List sessions for the current user+document, or create a new one."""
    serializer_class = ChatSessionSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        document_id = self.kwargs['pk']
        return ChatSession.objects.filter(
            user=self.request.user, document_id=document_id,
        ).order_by('-updated_at')

    def perform_create(self, serializer):
        document = get_object_or_404(Document, pk=self.kwargs['pk'])
        serializer.save(user=self.request.user, document=document)


class ChatSessionDetailView(generics.RetrieveUpdateDestroyAPIView):
    """Retrieve, patch (title / context_scope / pinned_context), or delete a
    single session. DELETE cascades to messages via the FK on_delete=CASCADE.
    """
    serializer_class = ChatSessionSerializer
    permission_classes = [permissions.IsAuthenticated]
    lookup_url_kwarg = 'session_id'
    http_method_names = ['get', 'patch', 'delete', 'head', 'options']

    def get_queryset(self):
        return ChatSession.objects.filter(
            user=self.request.user, document_id=self.kwargs['pk'],
        )


class ChatMessageListCreateView(views.APIView):
    """List messages for a session, or post a user message and stream the reply."""
    permission_classes = [permissions.IsAuthenticated]

    def _get_session(self, request, document_id, session_id):
        return get_object_or_404(
            ChatSession,
            pk=session_id,
            document_id=document_id,
            user=request.user,
        )

    def get(self, request, pk, session_id):
        session = self._get_session(request, pk, session_id)
        messages = session.messages.all().order_by('created_at')
        return Response(
            ChatMessageSerializer(messages, many=True).data,
            status=status.HTTP_200_OK,
        )

    def post(self, request, pk, session_id):
        session = self._get_session(request, pk, session_id)
        body = request.data.get('content', '').strip()
        if not body:
            return Response(
                {'error': 'content is required'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        context_page = request.data.get('context_page')
        try:
            context_page_int = int(context_page) if context_page else None
        except (TypeError, ValueError):
            context_page_int = None

        # Persist the user message immediately so the UI can echo it.
        user_msg = ChatMessage.objects.create(
            session=session, role='user', content=body, context_page=context_page_int,
        )

        # Auto-title a fresh session from its first user message.
        if not session.title:
            session.title = _derive_title(body)
            session.save(update_fields=['title'])

        document = session.document
        history = list(
            session.messages.exclude(pk=user_msg.pk)
            .order_by('-created_at')[:MAX_HISTORY_MESSAGES]
        )
        history.reverse()  # chronological

        response = StreamingHttpResponse(
            self._stream_assistant_reply(
                session=session,
                user_msg=user_msg,
                document=document,
                history=history,
                context_page=context_page_int,
            ),
            content_type='text/event-stream',
        )
        response['Cache-Control'] = 'no-cache'
        response['X-Accel-Buffering'] = 'no'  # Nginx/Caddy: don't buffer SSE
        return response

    def _stream_assistant_reply(self, *, session, user_msg, document, history, context_page):
        """Generator yielding SSE bytes; persists the assistant message at end."""
        try:
            from langchain_openai import ChatOpenAI
            from langchain_core.messages import (
                AIMessage,
                HumanMessage,
                SystemMessage,
                ToolMessage,
            )
            from .agent_tools import TOOL_SCHEMAS, build_tool_registry
        except ImportError as exc:
            yield _sse('error', {
                'error': f'langchain-openai not installed on server: {exc}'
            })
            return

        api_key = os.environ.get('OPENROUTER_API_KEY')
        if not api_key:
            yield _sse('error', {'error': 'OPENROUTER_API_KEY is not configured'})
            return

        def _make_chat():
            # Shared factory so the reader chat and the CopilotKit deep-agent
            # sidecar build the OpenRouter client identically. See llm.py.
            from .llm import make_openrouter_chat
            return make_openrouter_chat(model=AGENT_MODEL, x_title='ILM Shamela Reader')

        # Tools are bound for the agent rounds; a plain (un-bound) instance is
        # used to force a final prose answer if rounds are exhausted.
        chat = _make_chat().bind_tools(TOOL_SCHEMAS)
        registry = build_tool_registry(document, session.user)

        document_block, inline_pages, partial = _context_for_scope(
            document, user_msg.content, session.context_scope, context_page,
        )
        system_prompt = _build_system_prompt(
            document,
            context_page,
            available_pages=inline_pages if partial else None,
            pinned=session.pinned_context,
        )

        # Build LangChain messages. The first HumanMessage carries the document
        # context as a plain text prefix; Gemini handles implicit prompt caching
        # server-side, so no explicit cache_control block is needed.
        messages = [SystemMessage(content=system_prompt)]
        all_msgs = history + [user_msg]
        first_user_done = False
        for msg in all_msgs:
            if msg.role == 'user' and not first_user_done:
                messages.append(HumanMessage(
                    content=(
                        f'<document>\n{document_block}\n</document>\n\n'
                        f'{msg.content}'
                    ),
                ))
                first_user_done = True
            elif msg.role == 'user':
                messages.append(HumanMessage(content=msg.content))
            else:  # assistant
                messages.append(AIMessage(content=msg.content))

        # Agentic loop: stream each round; if the model asked for tools, run them,
        # append the results, and loop. A round that streams prose with no tool
        # call is the final answer. The model streams text tokens as `delta`
        # events exactly as before; tool activity is surfaced via `tool` events
        # (which older clients safely ignore).
        full_text_parts: List[str] = []
        answered = False
        try:
            for _round in range(MAX_TOOL_ROUNDS):
                gathered = None
                for chunk in chat.stream(messages):
                    text = self._chunk_text(chunk)
                    if text:
                        full_text_parts.append(text)
                        yield _sse('delta', {'text': text})
                    gathered = chunk if gathered is None else gathered + chunk

                tool_calls = getattr(gathered, 'tool_calls', None) or []
                if not tool_calls:
                    answered = True
                    break

                # This round was a tool-decision round: discard any prose it may
                # have emitted from the persisted answer, run the tools, and loop.
                full_text_parts.clear()
                messages.append(gathered)
                for call in tool_calls:
                    name = call.get('name', '')
                    yield _sse('tool', {'name': name, 'status': 'running'})
                    fn = registry.get(name)
                    try:
                        result = fn(**(call.get('args') or {})) if fn else {
                            'error': f'unknown tool: {name}'
                        }
                    except Exception as exc:  # noqa: BLE001
                        logger.exception('[CHAT] tool %s failed', name)
                        result = {'error': str(exc)}
                    messages.append(ToolMessage(
                        content=json.dumps(result, ensure_ascii=False),
                        tool_call_id=call.get('id', ''),
                    ))
                    yield _sse('tool', {'name': name, 'status': 'done'})

            if not answered:
                # Rounds exhausted while still wanting tools — force a final,
                # tool-free answer so the loop always terminates with prose.
                messages.append(SystemMessage(content=(
                    'Answer the user now using the information gathered above. '
                    'Do not call any more tools.'
                )))
                full_text_parts.clear()
                for chunk in _make_chat().stream(messages):
                    text = self._chunk_text(chunk)
                    if text:
                        full_text_parts.append(text)
                        yield _sse('delta', {'text': text})
        except Exception as exc:  # noqa: BLE001
            logger.exception('LangChain stream failed')
            yield _sse('error', {'error': str(exc)})
            return

        full_text = ''.join(full_text_parts)
        citations = _enrich_citations(session.document, _extract_citations(full_text))
        assistant_msg = ChatMessage.objects.create(
            session=session,
            role='assistant',
            content=full_text,
            citations=citations,
            context_page=context_page,
        )
        session.save(update_fields=['updated_at'])

        yield _sse('done', {'message_id': assistant_msg.id, 'citations': citations})

    @staticmethod
    def _chunk_text(chunk) -> str:
        """Extract text from a LangChain streaming chunk regardless of shape."""
        content = getattr(chunk, 'content', None)
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts = []
            for block in content:
                if isinstance(block, dict) and block.get('type') == 'text':
                    parts.append(block.get('text', ''))
                elif isinstance(block, str):
                    parts.append(block)
            return ''.join(parts)
        return ''


class ChatMessageStoreView(views.APIView):
    """Persist a single, already-produced chat message — no LLM call.

    The CopilotKit reader assistant streams its reply through the deep-agent
    sidecar, so Django never sees the turn. The authenticated client posts each
    completed message (user turn on send, assistant turn on completion) here so
    the durable per-user history — the session list and its transcript — stays
    the source of truth that hydrates the CopilotKit thread on reload.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk, session_id):
        session = get_object_or_404(
            ChatSession, pk=session_id, document_id=pk, user=request.user,
        )
        serializer = ChatMessageWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        role = data['role']
        content = data['content']
        citations = data.get('citations') or []
        # Server-authoritative citations for assistant turns when the client
        # didn't compute them: parse the page links out of the rendered content.
        if role == 'assistant' and not citations:
            citations = _extract_citations(content)
        # Enrichment is unconditional for assistant turns: client-sent citations
        # never carry printed-edition refs, so derive them server-side.
        if role == 'assistant' and citations:
            citations = _enrich_citations(session.document, citations)

        message = ChatMessage.objects.create(
            session=session,
            role=role,
            content=content,
            citations=citations,
            context_page=data.get('context_page'),
        )

        # Auto-title a fresh session from its first user message; always bump
        # updated_at so the session list re-orders to most-recent-first.
        if role == 'user' and not session.title:
            session.title = _derive_title(content)
            session.save(update_fields=['title', 'updated_at'])
        else:
            session.save(update_fields=['updated_at'])

        return Response(
            ChatMessageSerializer(message).data,
            status=status.HTTP_201_CREATED,
        )


# ─────────────────────────── Library assistant chat ───────────────────────────
# Document-less sessions for the library-wide CopilotKit assistant. The deep-agent
# sidecar owns the LLM turn (over AG-UI), so these endpoints never call a model —
# they only persist the durable transcript that hydrates the CopilotKit thread on
# reload. Create (by user+thread_id) and append (by client_id) are idempotent.


class LibraryChatSessionListCreateView(generics.ListCreateAPIView):
    """List the current user's library sessions, or idempotently create one."""
    serializer_class = LibraryChatSessionSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        return LibraryChatSession.objects.filter(
            user=self.request.user,
        ).order_by('-updated_at')

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        thread_id = serializer.validated_data['thread_id']
        # Idempotent: reuse the row for this (user, thread_id) if it exists so a
        # StrictMode double-invoke or a retried create can't duplicate sessions.
        session, created = LibraryChatSession.objects.get_or_create(
            user=request.user,
            thread_id=thread_id,
            defaults={'title': serializer.validated_data.get('title', '')},
        )
        return Response(
            LibraryChatSessionSerializer(session).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class LibraryChatSessionDetailView(generics.RetrieveUpdateDestroyAPIView):
    """Retrieve, patch (title), or delete a library session. DELETE cascades to
    messages via the FK on_delete=CASCADE."""
    serializer_class = LibraryChatSessionSerializer
    permission_classes = [permissions.IsAuthenticated]
    lookup_url_kwarg = 'session_id'
    http_method_names = ['get', 'patch', 'delete', 'head', 'options']

    def get_queryset(self):
        return LibraryChatSession.objects.filter(user=self.request.user)


class LibraryChatMessageListCreateView(views.APIView):
    """List a library session's messages, or bulk-persist already-produced turns.

    POST body: {"messages": [{"client_id", "role", "content"}, ...]}. Each message
    is upserted by (session, client_id) so repeated syncs are no-ops. Derives the
    session title from the first user message and bumps updated_at. No LLM call.
    """
    permission_classes = [permissions.IsAuthenticated]

    def _get_session(self, request, session_id):
        return get_object_or_404(
            LibraryChatSession, pk=session_id, user=request.user,
        )

    def get(self, request, session_id):
        session = self._get_session(request, session_id)
        messages = session.messages.all().order_by('created_at')
        return Response(
            LibraryChatMessageSerializer(messages, many=True).data,
            status=status.HTTP_200_OK,
        )

    def post(self, request, session_id):
        session = self._get_session(request, session_id)
        raw = request.data.get('messages', [])
        if not isinstance(raw, list):
            return Response(
                {'error': 'messages must be a list.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer = LibraryChatMessageWriteSerializer(data=raw, many=True)
        serializer.is_valid(raise_exception=True)

        stored = []
        for item in serializer.validated_data:
            message, _created = LibraryChatMessage.objects.get_or_create(
                session=session,
                client_id=item['client_id'],
                defaults={'role': item['role'], 'content': item['content']},
            )
            stored.append(message)
            # Auto-title a fresh session from its first user message.
            if item['role'] == 'user' and not session.title:
                session.title = _derive_title(item['content'])

        session.save()  # bump updated_at (and persist a freshly-derived title)

        return Response(
            {
                'title': session.title,
                'messages': LibraryChatMessageSerializer(stored, many=True).data,
            },
            status=status.HTTP_201_CREATED,
        )
