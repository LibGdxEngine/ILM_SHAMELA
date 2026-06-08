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

from .models import ChatMessage, ChatSession, Document, DocumentChunk
from .serializers_reader import ChatMessageSerializer, ChatSessionSerializer
from .utils import split_document_content_into_pages


logger = logging.getLogger(__name__)

MAX_HISTORY_MESSAGES = 20
# Threshold for full-document vs RAG context. Documents whose total extracted
# text exceeds this are answered via retrieval over DocumentChunk embeddings.
MAX_DOCUMENT_CONTEXT_CHARS = 60_000
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


def _sse(event: str, payload: dict) -> bytes:
    """Format a Server-Sent Event frame."""
    body = json.dumps(payload, ensure_ascii=False)
    return f'event: {event}\ndata: {body}\n\n'.encode('utf-8')


def _build_system_prompt(
    document: Document,
    current_page: int | None,
    available_pages: List[int] | None = None,
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


def _extract_citations(text: str) -> list[dict]:
    return [
        {'page': int(m.group(1)), 'quote': m.group(2).strip()}
        for m in CITATION_RE.finditer(text)
    ]


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
            return ChatOpenAI(
                model=AGENT_MODEL,
                api_key=api_key,
                base_url=OPENROUTER_BASE_URL,
                max_tokens=2048,
                streaming=True,
                default_headers={
                    'HTTP-Referer': os.environ.get('OPENROUTER_REFERER', 'https://ilm-shamela.local'),
                    'X-Title': 'ILM Shamela Reader',
                },
            )

        # Tools are bound for the agent rounds; a plain (un-bound) instance is
        # used to force a final prose answer if rounds are exhausted.
        chat = _make_chat().bind_tools(TOOL_SCHEMAS)
        registry = build_tool_registry(document, session.user)

        document_block, available_pages = _document_context_block(document, user_msg.content)
        system_prompt = _build_system_prompt(document, context_page, available_pages)

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
        citations = _extract_citations(full_text)
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
