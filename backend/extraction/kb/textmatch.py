"""Fuzzy text matching for the KB pipeline, built on the project's shared
Arabic normalization (``extraction.extractors.textnorm``).

The notebook shipped a diacritics-only shadow; this module replaces it with
the textnorm folding the whole project standardizes on (hamza variants -> ا,
ى -> ي, ة -> ه, tashkeel/tatweel/ZW stripped, Arabic-Indic digits -> ASCII,
lowercase), which bridges strictly more OCR/LLM orthography drift at zero risk
to spans: the shadow is used ONLY for finding, every span translates back to
the original text through the index map, and surface forms are always sliced
from the canonical text. Canonical text is never mutated.
"""
import re

from extraction.extractors import textnorm


def shadow_with_map(s: str) -> tuple[str, list[int]]:
    """Folded shadow string (whitespace collapsed) + map from shadow index
    back to the original index. The map stays strictly increasing, so the
    ``bisect``-based forward-cursor logic in marker resolution keeps working;
    whitespace runs collapse to a single ' ' keeping the first char's index,
    matching the pre-collapsed needles (`" ".join(needle.split())`)."""
    norm, imap = textnorm.normalize_with_map(s)
    out: list[str] = []
    idx: list[int] = []
    prev_space = False
    for ch, oi in zip(norm, imap):
        if ch.isspace():
            if prev_space:
                continue
            ch, prev_space = " ", True
        else:
            prev_space = False
        out.append(ch)
        idx.append(oi)
    return "".join(out), idx


def shadow(s: str) -> str:
    return shadow_with_map(s)[0]


def _find_nth(hay: str, needle: str, n: int) -> int:
    start, found = 0, 0
    while True:
        pos = hay.find(needle, start)
        if pos == -1:
            return -1
        found += 1
        if found == n:
            return pos
        start = pos + 1


def locate_in_focus(focus: str, focus_shadow: str, focus_map: list[int],
                    needle: str, occurrence: int) -> tuple[int, int] | None:
    """(start, end) relative to the focus text, or None. Tier 1: exact
    nth-occurrence; tier 2: folded shadow. If the model miscounted
    occurrences, fall back to the first occurrence."""
    needle = " ".join(needle.split())
    if not needle:
        return None
    n = max(1, occurrence)
    pos = _find_nth(focus, needle, n)
    if pos == -1 and n > 1:
        pos = focus.find(needle)
    if pos != -1:
        return pos, pos + len(needle)
    sh = shadow(needle)
    if not sh:
        return None
    sp = _find_nth(focus_shadow, sh, n)
    if sp == -1 and n > 1:
        sp = focus_shadow.find(sh)
    if sp == -1:
        return None
    return focus_map[sp], focus_map[sp + len(sh) - 1] + 1


# --- name_components -> {name, kunya, shuhra} --------------------------------
# NOTE: this pattern is written in SHADOW orthography on purpose — textnorm
# folds أ to ا, so the hamza form the notebook matched can never appear in the
# shadow. All three case forms stay three characters, so the substitution is
# length-preserving and safe to run on a string carrying an index map.
_ABU_CASES = re.compile("اب[واي]")


def _fold_abu(s: str) -> str:
    """ابو/ابي/ابا (shadow forms of أبو/أبي/أبا) -> ابو."""
    return _ABU_CASES.sub("ابو", s)


def name_without_kunya(surface_form: str, kunya: str | None) -> str:
    """surface_form with the kunya cut out.

    Matched through the same folded shadow the span locator uses, with the
    three case forms of أبو folded together — the model reports the nominative
    even where the text carries the genitive («أبي عبد الله» is reported as
    «أبو عبد الله»). A kunya that is not literally present leaves the surface
    form whole rather than guessing."""
    if not kunya:
        return surface_form.strip()
    sh, imap = shadow_with_map(surface_form)
    needle = _fold_abu(shadow(kunya))
    i = _fold_abu(sh).find(needle)
    if i == -1 or not needle:
        return surface_form.strip()
    cut = surface_form[:imap[i]] + surface_form[imap[i + len(needle) - 1] + 1:]
    return re.sub(r"\s+", " ", cut).strip()


def collapse_name_components(surface_form: str, nc: dict) -> dict:
    return {"name": name_without_kunya(surface_form, nc.get("kunya")),
            "kunya": nc.get("kunya"),
            "shuhra": nc.get("shuhra")}
