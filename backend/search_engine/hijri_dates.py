"""Parsing of free-text author death dates into hijri years/centuries.

``Author.date_of_death`` is a flexible-format CharField ('728 هـ', '٧٢٨',
'ت 728', '1328 م', 'د.ت', …). The researcher-facing "death century" facet
needs a normalized integer, so this module derives one. It is deliberately
pure (no model or app imports) so the same functions serve ``Author.save()``,
the data-migration backfill, the ``backfill_death_years`` command, and unit
tests without drift.
"""

from __future__ import annotations

import re
from typing import Optional, Tuple

# Values converted from Gregorian or parsed directly must land in this range,
# otherwise the string is treated as unparseable. 1600 AH ≈ 2170 CE.
HIJRI_MAX_PLAUSIBLE = 1600

# A bare, era-less year above this is assumed Gregorian and converted. The
# hijri calendar is currently in the mid-1400s, so bare values up to 1500 are
# plausible hijri death years for contemporary scholars, while bare Gregorian
# years ≤ 1500 essentially never appear in Islamic-library cataloguing (those
# authors are recorded in hijri).
GREGORIAN_CUTOFF = 1500

# Arabic-Indic (U+0660-0669) and Eastern Arabic-Indic (U+06F0-06F9) digits.
ARABIC_INDIC_TRANS = str.maketrans('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789')

# Full-string markers meaning "death date unknown" (matched after removing
# separators/dots/spaces from the normalized string).
_UNKNOWN_MARKERS = {
    'دت',        # د.ت / د ت (دون تاريخ)
    'تغم',       # ت غ م
    'مجهول',
    'غيرمعروف',
    'nd',        # n.d.
    'unknown',
    '',
}

# Approximation tokens / labels that may precede the year. Stripped before
# number extraction so e.g. 'نحو 730 هـ' or 'توفي سنة 728' parse cleanly.
_NOISE_RE = re.compile(
    r'(?:نحو|حوالي|حوالى|تقريبا|تقريبًا|بعد|قبل|سنة|توفي|توفى|المتوفى|'
    r'circa|ca\.|c\.|~)'
)
# A leading standalone ت ("توفي") marker, as in 'ت 728' — only when followed
# by a digit so a name fragment is never eaten.
_DEATH_PREFIX_RE = re.compile(r'(?:^|\s)ت\s*(?=\d)')

# A digit in century-phrased strings ('القرن الخامس', '5th century') is a
# century ordinal, not a year — parsing it as a year would misfile the author
# into century 1, so such strings are treated as unparseable instead.
_CENTURY_PHRASE_RE = re.compile(r'قرن|century', re.IGNORECASE)

# Year ranges ('728-730', '728/729 هـ') collapse to their first year before
# era matching; otherwise the era marker would attach to the second year.
# Dual-era strings ('728 هـ / 1328 م') are unaffected — their separator sits
# between a marker and a digit, not between two digits.
_RANGE_RE = re.compile(r'(\d{1,4})\s*[-–—/\\]\s*\d{1,4}')

# Era-marked years. Normalization strips the tatweel, so هـ arrives as a bare
# ه; the explicit هـ branch stays for robustness if normalization changes.
_HIJRI_YEAR_RE = re.compile(
    r'(\d{1,4})\s*(?:هـ|ﻫ|ه(?!\w)|هجري(?:ة)?|A\.?\s?H\.?(?![A-Za-z])|H(?![A-Za-z]))'
)
_GREGORIAN_YEAR_RE = re.compile(
    r'(\d{1,4})\s*(?:م(?!\w)|ميلادي(?:ة)?|C\.?E\.?(?![A-Za-z])|A\.?D\.?(?![A-Za-z]))'
)
_BARE_YEAR_RE = re.compile(r'\d{1,4}')

_TATWEEL = 'ـ'


def gregorian_to_hijri(gregorian: int) -> int:
    """Approximate CE→AH conversion: round((g - 622) * 33 / 32).

    Within ±1 year of the exact tabular conversion across the historical
    range — immaterial at the century granularity this module feeds.
    """
    return round((gregorian - 622) * 33 / 32)


def hijri_century(year: Optional[int]) -> Optional[int]:
    """Hijri century of a hijri year: 728 → 8, 700 → 7, 1 → 1."""
    if year is None or year < 1:
        return None
    return (year + 99) // 100


def _normalize(raw: str) -> str:
    text = raw.translate(ARABIC_INDIC_TRANS).replace(_TATWEEL, '')
    return ' '.join(text.split())


def parse_death_year_hijri(raw: Optional[str]) -> Optional[int]:
    """Parse a free-text death date into a hijri year, or None."""
    if raw is None:
        return None
    text = _normalize(str(raw))
    if not text:
        return None

    compact = re.sub(r'[\s\.\?،,؛;:_\-–—/\\()\[\]]+', '', text).lower()
    if compact in _UNKNOWN_MARKERS:
        return None
    if _CENTURY_PHRASE_RE.search(text):
        return None

    text = _NOISE_RE.sub(' ', text)
    text = _DEATH_PREFIX_RE.sub(' ', text)
    text = _RANGE_RE.sub(r'\1', text)
    text = ' '.join(text.split())

    year: Optional[int]
    hijri_match = _HIJRI_YEAR_RE.search(text)
    if hijri_match:
        # An explicit hijri marker wins, even in dual strings like
        # '728 هـ / 1328 م'.
        year = int(hijri_match.group(1))
    else:
        gregorian_match = _GREGORIAN_YEAR_RE.search(text)
        if gregorian_match:
            year = gregorian_to_hijri(int(gregorian_match.group(1)))
        else:
            bare = _BARE_YEAR_RE.search(text)
            if not bare:
                return None
            value = int(bare.group(0))
            year = gregorian_to_hijri(value) if value > GREGORIAN_CUTOFF else value

    if year < 1 or year > HIJRI_MAX_PLAUSIBLE:
        return None
    return year


def derive_death_fields(raw: Optional[str]) -> Tuple[Optional[int], Optional[int]]:
    """Single entry point: raw date_of_death → (death_year_hijri, death_century)."""
    year = parse_death_year_hijri(raw)
    return year, hijri_century(year)
