"""HTML QC viewers, written next to the pipeline outputs. Read-only over
segments.json / the normalized text / the LLM cache; zero API calls.

- ``write_segments_view``: one card per segment (RTL, color-coded by detector)
  — eyeball every LLM cut before paying for Stage 2.
- ``write_windows_view``: one card per planned Stage-2 window — context tinted,
  focus highlighted, the verbatim prompts collapsible, and per-pass cache-hit
  chips showing exactly what a run would bill.

Self-contained pages (no JS, no external assets). Nothing opens a browser —
the caller gets the path (``docker compose cp`` it out of the container).
"""
import html as _htmlmod
import logging
from collections import Counter
from pathlib import Path

from . import config, extract, io_utils, split
from .config import (CHARS_PER_TOKEN, STAGE2_PROMPT_VERSION, WINDOW_MAX_CHARS,
                     WINDOW_OVERLAP)
from .normalize import NormalizedDoc
from .schema import SegmentDetector, SegmentType, SegmentedDocument

logger = logging.getLogger(__name__)

VIEW_FULL_TEXT_CHARS = 3_000    # longer segments get their middle collapsed
VIEW_HEAD_CHARS = 1_500         # shown before the collapsed middle
VIEW_TAIL_CHARS = 1_000         # shown after it
PREVIEW_FULL_CHARS = 6_000      # longer focus text gets its middle collapsed
PREVIEW_WITH_INSTRUCTIONS = False   # the instruction block is byte-identical in
                                    # every window; off keeps the page readable

_DET_COLOR = {
    SegmentDetector.MARKUP: "#1a7f37",           # from source markdown — trusted
    SegmentDetector.MODEL: "#b58105",            # LLM cut — the ones to scrutinize
    SegmentDetector.TYPOGRAPHY: "#8250df",
    SegmentDetector.FALLBACK_WINDOW: "#cf222e",  # split detection failed here
}
_TYPE_TINT = {
    SegmentType.VOLUME: "#efe7ff", SegmentType.BOOK_PART: "#efe7ff",
    SegmentType.CHAPTER: "#fff3d6", SegmentType.SECTION: "#e7f3ff",
    SegmentType.BIOGRAPHY: "#e7f7ec", SegmentType.ANNAL: "#e7f7ec",
}
_TOC_INDENT = {SegmentType.VOLUME: 0, SegmentType.BOOK_PART: 0,
               SegmentType.CHAPTER: 1}           # every other type indents to 2

_VIEW_CSS = """
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; background: #f6f4ef; color: #1f2328;
       font-family: "Sakkal Majalla", "Traditional Arabic", "Amiri",
                    "Noto Naskh Arabic", Tahoma, serif; }
.layout { display: flex; align-items: flex-start; }
nav { position: sticky; top: 0; height: 100vh; overflow-y: auto; flex: 0 0 320px;
      background: #fdfcfa; border-left: 1px solid #ddd6c8; padding: 10px 8px;
      font-size: .95rem; }
nav a { display: block; color: #1f2328; text-decoration: none;
        padding: 2px 6px; border-radius: 4px; }
nav a:hover { background: #efe9db; }
nav a small { color: #6e7781; }
nav .i1 { padding-right: 22px; }
nav .i2 { padding-right: 42px; }
nav .paras { color: #6e7781; padding-right: 42px; font-size: .85rem; }
main { flex: 1 1 auto; min-width: 0; max-width: 900px; margin: 0 auto;
       padding: 16px 24px 60vh; }
header.book { background: #fdfcfa; border: 1px solid #ddd6c8; border-radius: 8px;
              padding: 12px 16px; margin-bottom: 18px; }
header.book h1 { margin: 0 0 6px; font-size: 1.2rem; direction: ltr;
                 text-align: left; font-family: Consolas, monospace; }
header.book .stats { direction: ltr; text-align: left; color: #57606a;
                     font-family: Consolas, monospace; font-size: .8rem;
                     white-space: pre-wrap; }
article.card { background: #fff; border: 1px solid #e4ddd0; border-radius: 8px;
               border-right: 5px solid #ccc; margin-bottom: 10px;
               padding: 8px 14px 12px; scroll-margin-top: 8px; }
.meta { direction: ltr; text-align: left; display: flex; flex-wrap: wrap;
        gap: 4px 12px; align-items: baseline; color: #57606a;
        font-family: Consolas, monospace; font-size: .78rem;
        border-bottom: 1px dashed #e4ddd0; padding-bottom: 5px;
        margin-bottom: 8px; }
.chip { color: #fff; border-radius: 10px; padding: 1px 8px; font-weight: 600; }
.title { font-weight: 700; font-size: 1.15rem; margin-bottom: 4px; }
.body { white-space: pre-wrap; line-height: 1.9; font-size: 1.08rem; }
.body::first-line { font-weight: 700; }   /* the cut line under review */
.body details { border: 1px dashed #c9beab; border-radius: 6px; margin: 6px 0;
                padding: 0 8px; background: #faf8f3; }
.body summary { cursor: pointer; direction: ltr; color: #57606a;
                font-family: Consolas, monospace; font-size: .8rem;
                padding: 4px 0; white-space: normal; }
"""


def _seg_body_html(text: str) -> str:
    esc = _htmlmod.escape
    if len(text) <= VIEW_FULL_TEXT_CHARS:
        return esc(text)
    mid = text[VIEW_HEAD_CHARS:-VIEW_TAIL_CHARS]
    return (esc(text[:VIEW_HEAD_CHARS])
            + f"<details><summary>… {len(mid):,} chars collapsed — "
              f"click to expand …</summary>"
            + esc(mid) + "</details>" + esc(text[-VIEW_TAIL_CHARS:]))


def render_segments_html(book_id: str, text: str, sdoc: SegmentedDocument,
                         saved: dict) -> str:
    esc = _htmlmod.escape
    segs = sorted(sdoc.segments, key=lambda s: s.order)
    toc: list[str] = []
    cards: list[str] = []
    para_run: list = []

    def _flush_paras() -> None:
        if para_run:
            chars = sum(s.length for s in para_run)
            toc.append(f'<a class="paras" href="#{para_run[0].id}">'
                       f'· {len(para_run)} paragraph(s), {chars:,} chars</a>')
            para_run.clear()

    for s in segs:
        stext = text[s.span.start:s.span.end]
        if s.segment_type is SegmentType.PARAGRAPH:
            para_run.append(s)
        else:
            _flush_paras()
            label = (s.title or stext[:50].replace("\n", " ")).strip()
            ind = _TOC_INDENT.get(s.segment_type, 2)
            toc.append(f'<a class="i{ind}" href="#{s.id}">{esc(label[:60])} '
                       f'<small>#{s.order}</small></a>')
        color = _DET_COLOR.get(s.detector, "#6e7781")
        tint = _TYPE_TINT.get(s.segment_type, "#ffffff")
        title_html = f'<div class="title">{esc(s.title)}</div>' if s.title else ""
        cards.append(
            f'<article class="card" id="{s.id}" '
            f'style="border-right-color:{color};background:{tint}">'
            f'<div class="meta">'
            f'<span class="chip" style="background:{color}">{s.detector.value}</span>'
            f'<span>#{s.order}</span><span>{s.segment_type.value}</span>'
            f'<span>{s.stream.value}</span><span>conf {s.confidence:.2f}</span>'
            f'<span>[{s.span.start:,}–{s.span.end:,}]</span>'
            f'<span>{s.length:,} chars</span><span>{s.id}</span>'
            f'</div>{title_html}<div class="body">{_seg_body_html(stext)}</div>'
            f'</article>')
    _flush_paras()

    types = dict(Counter(s.segment_type.value for s in segs))
    dets = dict(Counter(s.detector.value for s in segs))
    rs = saved.get("resolve_stats", {})
    stats = (f"{len(segs)} segments over {sdoc.text_length:,} chars\n"
             f"types: {types}\ndetectors: {dets}\n"
             f"markers: {rs.get('total', '?')} from LLM, "
             f"{rs.get('resolved', '?')} resolved, "
             f"{len(rs.get('unresolved', []))} unresolved")
    return (f'<!DOCTYPE html><html dir="rtl" lang="ar"><head>'
            f'<meta charset="utf-8"><title>segments — {esc(book_id)}</title>'
            f'<style>{_VIEW_CSS}</style></head><body><div class="layout">'
            f'<nav>{"".join(toc)}</nav><main>'
            f'<header class="book"><h1>{esc(book_id)}</h1>'
            f'<div class="stats">{esc(stats)}</div></header>'
            f'{"".join(cards)}</main></div></body></html>')


def write_segments_view(book_id: str, ndoc: NormalizedDoc) -> Path | None:
    saved = split.load_segments(book_id)
    if saved is None:
        logger.warning("%s: no segments.json — run stage 1 first", book_id)
        return None
    if (split.norm_sha256(ndoc) != saved.get("norm_sha256")
            or saved.get("normalizer_version") != config.NORMALIZER_VERSION):
        logger.warning("%s: NORMALIZATION DRIFT — segments.json was built from "
                       "different text; rerun stage 1 first", book_id)
        return None
    sdoc = SegmentedDocument.model_validate(saved["doc"])
    page = render_segments_html(book_id, ndoc.text, sdoc, saved)
    vp = config.output_dir(book_id) / "segments_view.html"
    io_utils.atomic_write_text(vp, page)
    logger.info("%s: %d segments -> %s (%.0f KB)",
                book_id, len(sdoc.segments), vp, len(page) / 1024)
    return vp


# ---------------------------------------------------------------------------
# Stage 2 window preview
# ---------------------------------------------------------------------------

_WIN_CSS = """
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; background: #f6f4ef; color: #1f2328;
       font-family: "Sakkal Majalla", "Traditional Arabic", "Amiri",
                    "Noto Naskh Arabic", Tahoma, serif; }
.layout { display: flex; align-items: flex-start; }
nav { position: sticky; top: 0; height: 100vh; overflow-y: auto; flex: 0 0 300px;
      background: #fdfcfa; border-left: 1px solid #ddd6c8; padding: 10px 8px;
      font-size: .95rem; }
nav a { display: block; color: #1f2328; text-decoration: none;
        padding: 3px 6px; border-radius: 4px; }
nav a:hover { background: #efe9db; }
nav a small { color: #6e7781; direction: ltr; font-family: Consolas, monospace; }
main { flex: 1 1 auto; min-width: 0; max-width: 900px; margin: 0 auto;
       padding: 16px 24px 60vh; }
header.book { background: #fdfcfa; border: 1px solid #ddd6c8; border-radius: 8px;
              padding: 12px 16px; margin-bottom: 18px; }
header.book h1 { margin: 0 0 6px; font-size: 1.2rem; direction: ltr;
                 text-align: left; font-family: Consolas, monospace; }
header.book .stats { direction: ltr; text-align: left; color: #57606a;
                     font-family: Consolas, monospace; font-size: .8rem;
                     white-space: pre-wrap; }
article.card { background: #fff; border: 1px solid #e4ddd0; border-radius: 8px;
               border-right: 5px solid #1a7f37; margin-bottom: 12px;
               padding: 8px 14px 12px; scroll-margin-top: 8px; }
article.card.oversized { border-right-color: #cf222e; }
.meta { direction: ltr; text-align: left; display: flex; flex-wrap: wrap;
        gap: 4px 12px; align-items: baseline; color: #57606a;
        font-family: Consolas, monospace; font-size: .78rem;
        border-bottom: 1px dashed #e4ddd0; padding-bottom: 5px;
        margin-bottom: 8px; }
.chip { color: #fff; border-radius: 10px; padding: 1px 8px; font-weight: 600;
        background: #6e7781; }
.chip.hit { background: #1a7f37; }     /* answer already cached — free replay */
.chip.miss { background: #b58105; }    /* this window will be billed */
.chip.over { background: #cf222e; }
.body { white-space: pre-wrap; line-height: 1.9; font-size: 1.08rem; }
.ctx { color: #8c8578; background: #f3f0e8; }        /* read-only context */
.focus { background: #fff8c5; color: #1f2328; }      /* extracted from */
.cut { color: #cf222e; font-family: Consolas, monospace; font-size: .8rem; }
details { border: 1px dashed #c9beab; border-radius: 6px; margin: 6px 0;
          padding: 0 8px; background: #faf8f3; }
summary { cursor: pointer; direction: ltr; color: #57606a;
          font-family: Consolas, monospace; font-size: .8rem;
          padding: 4px 0; white-space: normal; }
pre.prompt { white-space: pre-wrap; unicode-bidi: plaintext; line-height: 1.8;
             font-family: inherit; font-size: 1rem; margin: 4px 0 8px; }
"""


def _collapse_html(text: str, limit: int = PREVIEW_FULL_CHARS) -> str:
    """Escaped text, with the middle of long passages folded into <details>."""
    esc = _htmlmod.escape
    if len(text) <= limit:
        return esc(text)
    head, tail = text[: limit // 2], text[-(limit // 4):]
    mid = text[len(head): len(text) - len(tail)]
    return (esc(head)
            + f"<details><summary>… {len(mid):,} chars collapsed — "
              f"click to expand …</summary>" + esc(mid) + "</details>"
            + esc(tail))


def _prompt_panel(title: str, prompt: str, strip: str | None) -> str:
    """One collapsible raw-prompt panel. `strip` is the instruction block to cut
    from the head when PREVIEW_WITH_INSTRUCTIONS is off — it is byte-identical in
    every window and would otherwise dominate the page."""
    esc = _htmlmod.escape
    shown = prompt if PREVIEW_WITH_INSTRUCTIONS or strip is None else prompt[len(strip):]
    return (f'<details><summary>{esc(title)} — {len(prompt):,} chars'
            f'{"" if PREVIEW_WITH_INSTRUCTIONS else " (instructions hidden)"}'
            f'</summary><pre class="prompt">{esc(shown)}</pre></details>')


def render_windows_html(book_id: str, text: str, windows: list,
                        statuses: list, windows_total: int,
                        limit: int | None = None) -> str:
    esc = _htmlmod.escape
    model = config.extract_model()
    toc, cards = [], []
    _B_CHIP = {"cached": ("hit", "B cached"), "pending": ("miss", "B will bill"),
               "skipped": ("", "B skipped (&lt;2 mentions)"),
               "unknown": ("miss", "B will bill")}
    for i, (w, st) in enumerate(zip(windows, statuses)):
        fs, fe = w.focus_span.start, w.focus_span.end
        cs, ce = w.context_span.start, w.context_span.end
        sent, dropped = st.focus, st.focus_dropped
        b_cls, b_txt = _B_CHIP[st.links_state]
        total_chars = len(st.mentions_prompt) + len(st.links_prompt or "")
        label = (sent[:60].replace("\n", " ")).strip()
        toc.append(f'<a href="#w{i}">{esc(label)} '
                   f'<small>#{i} · {fe - fs:,}c · {st.to_bill} call'
                   f'{"" if st.to_bill == 1 else "s"}</small></a>')
        cards.append(
            f'<article class="card{" oversized" if w.oversized else ""}" id="w{i}">'
            f'<div class="meta">'
            f'<span class="chip {"hit" if st.mentions_cached else "miss"}">'
            f'{"A cached" if st.mentions_cached else "A will bill"}</span>'
            f'<span class="chip {b_cls}">{b_txt}</span>'
            f'<span>#{i}</span>'
            + ('<span class="chip over">oversized</span>' if w.oversized else "")
            + f'<span>focus {len(sent):,}c [{fs:,}–{fe:,}]</span>'
              f'<span>ctx {ce - cs:,}c</span>'
              f'<span>prompts {total_chars:,}c ~{total_chars / CHARS_PER_TOKEN:,.0f} tok</span>'
            + (f'<span>{st.n_mentions} mentions found</span>'
               if st.n_mentions is not None else "")
            + f'<span>{len(w.segment_ids)} seg: {esc(", ".join(w.segment_ids[:3]))}'
              f'{"…" if len(w.segment_ids) > 3 else ""}</span>'
              f'</div><div class="body">'
              f'<span class="ctx">{esc(text[cs:fs])}</span>'
              f'<span class="focus">{_collapse_html(sent)}</span>'
            + (f'<span class="cut"> ⟨{dropped:,} chars over OVERSIZED_FOCUS_CAP — '
               f'not sent⟩</span>' if dropped else "")
            + f'<span class="ctx">{esc(text[fe:ce])}</span></div>'
            + _prompt_panel(f"pass A prompt (mentions) sent to {model}",
                            st.mentions_prompt, extract.MENTIONS_INSTRUCTIONS)
            + (_prompt_panel(f"pass B prompt (links) sent to {model}",
                             st.links_prompt, extract.LINKS_INSTRUCTIONS)
               if st.links_prompt else
               '<details><summary>pass B prompt — not computable until pass A is '
               'answered (it is built from A\'s mention list)</summary>'
               '<pre class="prompt">—</pre></details>')
            + '</article>')

    n_free = sum(1 for s in statuses if s.free)
    n_bill = sum(s.to_bill for s in statuses)
    stats = (f"{len(windows)} of {windows_total} planned windows shown"
             f"{'' if limit is None else f' (limit={limit})'}\n"
             f"window_max_chars={WINDOW_MAX_CHARS}, overlap={WINDOW_OVERLAP}, "
             f"oversized={sum(1 for w in windows if w.oversized)}\n"
             f"cache: {n_free} windows fully answered, {n_bill} calls would bill "
             f"({model}, {STAGE2_PROMPT_VERSION}; instructions "
             f"A {len(extract.MENTIONS_INSTRUCTIONS):,} + "
             f"B {len(extract.LINKS_INSTRUCTIONS):,} chars)")
    return (f'<!DOCTYPE html><html dir="rtl" lang="ar"><head>'
            f'<meta charset="utf-8"><title>windows — {esc(book_id)}</title>'
            f'<style>{_WIN_CSS}</style></head><body><div class="layout">'
            f'<nav>{"".join(toc)}</nav><main>'
            f'<header class="book"><h1>{esc(book_id)}</h1>'
            f'<div class="stats">{esc(stats)}</div></header>'
            f'{"".join(cards)}</main></div></body></html>')


def write_windows_view(book_id: str, ndoc: NormalizedDoc,
                       limit: int | None = None) -> Path | None:
    from .runner import plan_book_windows, segments_drifted

    saved = split.load_segments(book_id)
    if saved is None:
        logger.warning("%s: no segments.json — run stage 1 first", book_id)
        return None
    if segments_drifted(saved, ndoc):
        logger.warning("%s: NORMALIZATION DRIFT — segments.json was built from "
                       "different text; rerun stage 1 first", book_id)
        return None
    sdoc = SegmentedDocument.model_validate(saved["doc"])
    wins_all = plan_book_windows(sdoc, ndoc)
    wins = wins_all if limit is None else wins_all[:limit]
    # Same cache keys the run will compute, so a window shown as fully answered
    # replays for free — the preview itself never calls the API.
    st = [extract.window_call_status(book_id, ndoc.text, w) for w in wins]
    page = render_windows_html(book_id, ndoc.text, wins, st, len(wins_all),
                               limit=limit)
    vp = config.output_dir(book_id) / "windows_view.html"
    io_utils.atomic_write_text(vp, page)
    logger.info("%s: %d/%d windows, %d fully cached, %d calls would bill -> %s "
                "(%.0f KB)", book_id, len(wins), len(wins_all),
                sum(1 for s in st if s.free), sum(s.to_bill for s in st),
                vp, len(page) / 1024)
    return vp
