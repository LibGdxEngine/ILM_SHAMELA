"""Layer-0 document classification: ONE OpenRouter function-call per document
(genre / madhhab / era of composition / register / physical class), modeled on
``search_engine.views.ASSIST_FILTER_TOOL``.

Rules pre-fill what they can deterministically (they also ride as hints in the
prompt); the LLM fills the rest with per-field confidence + evidence quotes.
Failures are LOUD: ``DocumentMeta.status='failed'`` + ``degraded_reason`` — a
dead ``OPENROUTER_API_KEY`` must never look like a successful empty result.
"""
import json
import logging
import os
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

LAYER0_VERSION = '1'
SAMPLE_CHAR_LIMIT = 2500
MAX_SAMPLE_PAGES = 9


def _enum(choices) -> List[str]:
    return [value for value, _label in choices]


def build_layer0_tool() -> Dict:
    from .models import DocumentMeta

    return {
        'type': 'function',
        'function': {
            'name': 'classify_document',
            'description': (
                'Classify this Arabic-library document from the sampled pages. '
                'Call exactly once. Use the hints when they are consistent with '
                'the text; report confidence per field (0..1) and a short '
                'verbatim evidence quote for each non-obvious decision.'
            ),
            'parameters': {
                'type': 'object',
                'properties': {
                    'genre': {'type': 'string', 'enum': _enum(DocumentMeta.GENRES)},
                    'genres_secondary': {
                        'type': 'array',
                        'items': {'type': 'string', 'enum': _enum(DocumentMeta.GENRES)},
                        'description': 'Up to two secondary genres, if clearly present.',
                    },
                    'genre_confidence': {'type': 'number'},
                    'madhhab': {'type': 'string', 'enum': _enum(DocumentMeta.MADHHABS)},
                    'madhhab_confidence': {'type': 'number'},
                    'era_century_hijri': {
                        'type': ['integer', 'null'],
                        'description': (
                            'Hijri century when the work was COMPOSED (1-15), '
                            'null if undeterminable. Not the print/upload date.'
                        ),
                    },
                    'era_confidence': {'type': 'number'},
                    'register': {'type': 'string', 'enum': _enum(DocumentMeta.REGISTERS)},
                    'register_confidence': {'type': 'number'},
                    'physical_class': {'type': 'string', 'enum': _enum(DocumentMeta.PHYSICAL)},
                    'physical_confidence': {'type': 'number'},
                    'evidence': {
                        'type': 'object',
                        'description': 'field → short verbatim quote justifying it.',
                    },
                },
                'required': ['genre', 'genre_confidence', 'madhhab', 'physical_class'],
            },
        },
    }


LAYER0_SYSTEM_PROMPT = (
    'You classify documents for an Arabic-Islamic digital library. You receive '
    'sampled pages (title page, table-of-contents area, interior pages) of ONE '
    'document plus deterministic hints. Call classify_document exactly once.\n'
    'Rules:\n'
    '- genre is the primary discipline of the WORK (فقه، حديث، تفسير، تراجم…), '
    'not of individual quotations inside it.\n'
    '- madhhab: the legal school the work belongs to or argues within; use '
    '"multi" for comparative works, "na" for non-fiqh works, "unknown" when '
    'fiqh but undeterminable.\n'
    '- era_century_hijri is the century of COMPOSITION (author\'s era), never '
    'the printing/upload date. Use the author-death-century hint when '
    'consistent.\n'
    '- physical_class: newspapers/magazines have mastheads, issue numbers, '
    'datelines; theses have جامعة/كلية/رسالة ماجستير front matter; manuscript '
    'scans read as handwritten codices.\n'
    '- Confidences are honest 0..1 estimates; keep evidence quotes short and '
    'verbatim.'
)


def sample_pages(document) -> List[Dict]:
    """Title/TOC-weighted page sample: first 3 pages + up to 2 chapter-start
    pages + 3 evenly spaced interior pages + the last page (≤9 total, each
    truncated to ``SAMPLE_CHAR_LIMIT``). Reads DocumentChunk rows (page store)
    but never anchors to them."""
    from search_engine.models import Chapter, DocumentChunk

    rows = list(
        DocumentChunk.objects.filter(document=document)
        .order_by('page_number')
        .values_list('page_number', 'content')
    )
    if not rows:
        from search_engine.utils import split_document_content_into_pages
        rows = [(p['page_number'], p['content'])
                for p in split_document_content_into_pages(document.content or '')]
    if not rows:
        return []

    by_number = dict(rows)
    numbers = [n for n, _ in rows]
    wanted: List[int] = []

    def add(page_number: Optional[int]):
        if page_number in by_number and page_number not in wanted \
                and len(wanted) < MAX_SAMPLE_PAGES:
            wanted.append(page_number)

    for n in numbers[:3]:
        add(n)
    for start in Chapter.objects.filter(document=document).order_by('order')\
            .values_list('page_start', flat=True)[:2]:
        add(start)
    count = len(numbers)
    for fraction in (0.25, 0.5, 0.75):
        add(numbers[min(count - 1, int(count * fraction))])
    add(numbers[-1])

    return [
        {'page_number': n, 'content': (by_number[n] or '')[:SAMPLE_CHAR_LIMIT]}
        for n in sorted(wanted)
    ]


def rule_hints(document) -> Dict:
    """Deterministic pre-fill: cheap, high-precision signals passed to the LLM
    and used as fallbacks for their fields."""
    import re

    hints: Dict = {}
    title = document.title or ''
    if document.language and document.language != 'ar':
        hints['register'] = 'non_arabic'
    if re.search(r'جريدة|مجلة|صحيفة', title):
        hints['physical_class'] = 'newspaper'
    elif re.search(r'رسالة ماجستير|رسالة دكتوراه|أطروحة|اطروحة', title):
        hints['physical_class'] = 'thesis'
    centuries = [
        c for c in document.authors.values_list('death_century', flat=True)
        if c is not None
    ]
    if centuries:
        hints['era_century_max'] = min(centuries)
    return hints


def classify_document(document) -> Dict:
    """Run the one-call classification. Returns the parsed tool args.
    Raises on config/transport errors — the caller (task) records loud
    failure state."""
    from langchain_core.messages import HumanMessage, SystemMessage

    from search_engine.llm import make_openrouter_chat

    if not os.environ.get('OPENROUTER_API_KEY'):
        raise RuntimeError('OPENROUTER_API_KEY is not configured')

    pages = sample_pages(document)
    if not pages:
        raise RuntimeError('document has no page content to classify')

    hints = rule_hints(document)
    payload_parts = [f'TITLE: {document.title}']
    if document.description:
        payload_parts.append(f'DESCRIPTION: {document.description[:500]}')
    authors = ', '.join(document.authors.values_list('name', flat=True))
    if authors:
        payload_parts.append(f'AUTHORS: {authors}')
    if hints:
        payload_parts.append(f'HINTS: {json.dumps(hints, ensure_ascii=False)}')
    for page in pages:
        payload_parts.append(f'--- PAGE {page["page_number"]} ---\n{page["content"]}')

    chat = make_openrouter_chat(
        streaming=False, max_tokens=1024, x_title='ILM Shamela Extraction',
    ).bind_tools([build_layer0_tool()], tool_choice='classify_document')
    response = chat.invoke([
        SystemMessage(content=LAYER0_SYSTEM_PROMPT),
        HumanMessage(content='\n\n'.join(payload_parts)),
    ])
    calls = getattr(response, 'tool_calls', None) or []
    if not calls:
        raise RuntimeError('model returned no classify_document call')
    args = calls[0].get('args')
    if not isinstance(args, dict) or not args:
        raise RuntimeError('model returned malformed classify_document args')
    return args


def apply_classification(meta, args: Dict, model_id: str) -> None:
    """Write validated args onto a DocumentMeta row. Human-verified metas are
    never overwritten (the task guards before calling)."""
    from .models import DocumentMeta

    genres = {v for v, _ in DocumentMeta.GENRES}
    madhhabs = {v for v, _ in DocumentMeta.MADHHABS}
    registers = {v for v, _ in DocumentMeta.REGISTERS}
    physical = {v for v, _ in DocumentMeta.PHYSICAL}

    def conf(key) -> Optional[float]:
        value = args.get(key)
        if isinstance(value, (int, float)):
            return max(0.0, min(1.0, float(value)))
        return None

    if args.get('genre') in genres:
        meta.genre = args['genre']
        meta.genre_confidence = conf('genre_confidence')
    meta.genres_secondary = [
        g for g in (args.get('genres_secondary') or [])
        if g in genres and g != meta.genre
    ][:2]
    if args.get('madhhab') in madhhabs:
        meta.madhhab = args['madhhab']
        meta.madhhab_confidence = conf('madhhab_confidence')
    era = args.get('era_century_hijri')
    if isinstance(era, int) and 1 <= era <= 15:
        meta.era_century = era
        meta.era_confidence = conf('era_confidence')
    if args.get('register') in registers:
        meta.register = args['register']
        meta.register_confidence = conf('register_confidence')
    if args.get('physical_class') in physical:
        meta.physical_class = args['physical_class']
        meta.physical_confidence = conf('physical_confidence')
    evidence = args.get('evidence')
    meta.evidence = evidence if isinstance(evidence, dict) else {}
    meta.extractor_version = LAYER0_VERSION
    meta.model_id = model_id
    meta.status = meta.Status.SUCCEEDED
    meta.degraded_reason = ''
