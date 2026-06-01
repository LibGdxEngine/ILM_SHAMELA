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
from .semantic import build_embedding, cosine_similarity
from .serializers_reader import ChatMessageSerializer, ChatSessionSerializer
from .utils import split_document_content_into_pages


logger = logging.getLogger(__name__)

MAX_HISTORY_MESSAGES = 20
# Threshold for full-document vs RAG context. Documents whose total extracted
# text exceeds this are answered via retrieval over DocumentChunk embeddings.
MAX_DOCUMENT_CONTEXT_CHARS = 60_000
RAG_TOP_K = 10
DEFAULT_MODEL = os.environ.get('OPENROUTER_CHAT_MODEL', 'google/gemini-2.5-flash-lite')
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
        # RAG mode: only a subset of pages is in the model's context.
        pages_str = ', '.join(str(p) for p in available_pages)
        coverage_note = (
            '\n\nNOTE: To keep the context concise, only the most relevant '
            f'pages were included for this turn: {pages_str}. If the answer '
            'requires other pages, say so and ask the user to point to a '
            'page. Cite only pages from the list above.'
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
    """Retrieve the top-K DocumentChunks by cosine similarity to the user
    question and format them as the model's context. Falls back to a truncated
    full-document slice when no embedding is available.
    """
    query_vec = build_embedding(user_question, task_type="RETRIEVAL_QUERY")
    if not query_vec:
        logger.warning('[CHAT] RAG: query embedding unavailable, falling back to truncated full doc')
        return _full_document_context(document)

    chunks = list(
        DocumentChunk.objects
        .filter(document=document)
        .values('chunk_index', 'page_number', 'content', 'embedding')
    )
    scored = []
    for chunk in chunks:
        emb = chunk.get('embedding') or []
        if not emb:
            continue
        score = cosine_similarity(query_vec, emb)
        scored.append((score, chunk))

    if not scored:
        logger.warning('[CHAT] RAG: no chunk embeddings for doc=%s, falling back', document.id)
        return _full_document_context(document)

    scored.sort(key=lambda item: item[0], reverse=True)
    top = [chunk for _score, chunk in scored[:RAG_TOP_K]]
    top.sort(key=lambda c: (c['page_number'], c['chunk_index']))

    parts: List[str] = []
    page_numbers: List[int] = []
    for chunk in top:
        page_numbers.append(chunk['page_number'])
        parts.append(f"\n[page {chunk['page_number']}]\n{chunk['content']}\n---")
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
            )
        except ImportError as exc:
            yield _sse('error', {
                'error': f'langchain-openai not installed on server: {exc}'
            })
            return

        api_key = os.environ.get('OPENROUTER_API_KEY')
        if not api_key:
            yield _sse('error', {'error': 'OPENROUTER_API_KEY is not configured'})
            return

        chat = ChatOpenAI(
            model=DEFAULT_MODEL,
            api_key=api_key,
            base_url=OPENROUTER_BASE_URL,
            max_tokens=2048,
            streaming=True,
            default_headers={
                'HTTP-Referer': os.environ.get('OPENROUTER_REFERER', 'https://ilm-shamela.local'),
                'X-Title': 'ILM Shamela Reader',
            },
        )

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

        full_text_parts = []
        try:
            for chunk in chat.stream(messages):
                # chunk.content may be a string or a list of content blocks
                # depending on the provider; normalize to text.
                text = self._chunk_text(chunk)
                if not text:
                    continue
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
