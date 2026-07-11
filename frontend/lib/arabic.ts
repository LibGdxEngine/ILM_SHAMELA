/**
 * Arabic text utilities shared by the plain-text reader (tashkeel display
 * toggle) and the PDF-overlay reader (tashkeel-insensitive search marking).
 */

export const TASHKEEL = /[\u064B-\u065F\u0670]/g;
export const TASHKEEL_CHAR = /[\u064B-\u065F\u0670]/;

/**
 * Build a per-character mapping from the original string to its tashkeel-stripped
 * counterpart. `mapping[i]` is the index in the stripped string of the character
 * that was originally at position `i`. `mapping[original.length]` equals the
 * stripped string's length so end-exclusive ranges map correctly.
 */
export function buildTashkeelStripMapping(original: string): { stripped: string; mapping: number[] } {
  const mapping: number[] = new Array(original.length + 1);
  let strippedIdx = 0;
  let stripped = '';
  for (let i = 0; i < original.length; i += 1) {
    mapping[i] = strippedIdx;
    const ch = original[i];
    if (!TASHKEEL_CHAR.test(ch)) {
      stripped += ch;
      strippedIdx += 1;
    }
  }
  mapping[original.length] = strippedIdx;
  return { stripped, mapping };
}

// Match-normalization mirrors Elasticsearch's `arabic_normalization` token
// filter (used by the backend's `content.exact` sub-field) so what the backend
// reports as a hit is what the overlay marks. Output is never displayed, so
// folding letters is safe here (unlike `buildTashkeelStripMapping`).
const REMOVE_CHAR = /[\u064B-\u065F\u0670\u0640]/; // tashkeel + superscript alef + tatweel
const FOLD: Record<string, string> = {
  '\u0622': '\u0627', // آ → ا
  '\u0623': '\u0627', // أ → ا
  '\u0625': '\u0627', // إ → ا
  '\u0671': '\u0627', // ٱ → ا
  '\u0649': '\u064A', // ى → ي
  '\u0629': '\u0647', // ة → ه
};

export interface ArabicNormalization {
  normalized: string;
  /** `toOriginal[i]` = index in the original string of the char that produced `normalized[i]`. */
  toOriginal: number[];
}

/**
 * Normalize text for tashkeel-insensitive matching: drop diacritics/tatweel,
 * fold alef variants / ى / ة, collapse whitespace runs to a single space, and
 * lowercase — keeping an index map back into the original string.
 */
export function normalizeArabicForSearch(original: string): ArabicNormalization {
  const out: string[] = [];
  const toOriginal: number[] = [];
  let lastWasSpace = false;
  for (let i = 0; i < original.length; i += 1) {
    const ch = original[i];
    if (REMOVE_CHAR.test(ch)) continue;
    if (/\s/.test(ch)) {
      if (!lastWasSpace && out.length > 0) {
        out.push(' ');
        toOriginal.push(i);
        lastWasSpace = true;
      }
      continue;
    }
    lastWasSpace = false;
    const lower = (FOLD[ch] ?? ch).toLowerCase();
    // Lowercasing can emit multiple code units (e.g. İ); map each back to `i`.
    for (const unit of lower) {
      out.push(unit);
      toOriginal.push(i);
    }
  }
  return { normalized: out.join(''), toOriginal };
}

/**
 * Find all occurrences of `query` in `text`, insensitive to tashkeel, tatweel,
 * alef/ى/ة variants, case, and whitespace runs (a spaced query matches text
 * broken across lines). Returned ranges are offsets into the ORIGINAL text.
 */
export function findArabicMatches(text: string, query: string): Array<{ start: number; end: number }> {
  const needle = normalizeArabicForSearch(query).normalized.trim();
  if (!needle) return [];
  const { normalized, toOriginal } = normalizeArabicForSearch(text);
  const ranges: Array<{ start: number; end: number }> = [];
  let idx = normalized.indexOf(needle);
  while (idx !== -1) {
    const start = toOriginal[idx];
    // Last matched original char + 1; `toOriginal[idx + needle.length]` would
    // overshoot across a stripped/whitespace run following the match.
    let end = toOriginal[idx + needle.length - 1] + 1;
    while (end < text.length && TASHKEEL_CHAR.test(text[end])) end += 1;
    ranges.push({ start, end });
    idx = normalized.indexOf(needle, idx + 1);
  }
  return ranges;
}

// A token is a maximal run of letters/digits in the normalized text, matching
// ES's standard tokenizer closely enough for this corpus. Known divergences:
// UAX#29 keeps word-internal apostrophes/decimal points in Latin tokens, and
// astral-plane letters act as separators here (per-code-unit scan) — both
// irrelevant for Arabic book text.
const TOKEN_CHAR = /[\p{L}\p{N}]/u;

/**
 * Split `original` into search tokens the way the backend's `content.exact`
 * field does (standard tokenizer + arabic_normalization). Returns the
 * normalized token strings plus each token's range in the ORIGINAL text.
 */
export function tokenizeArabicForSearch(
  original: string
): { tokens: string[]; ranges: Array<{ start: number; end: number }> } {
  const { normalized, toOriginal } = normalizeArabicForSearch(original);
  const tokens: string[] = [];
  const ranges: Array<{ start: number; end: number }> = [];
  let i = 0;
  while (i < normalized.length) {
    if (!TOKEN_CHAR.test(normalized[i])) {
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < normalized.length && TOKEN_CHAR.test(normalized[j])) j += 1;
    const start = toOriginal[i];
    let end = toOriginal[j - 1] + 1;
    while (end < original.length && TASHKEEL_CHAR.test(original[end])) end += 1;
    tokens.push(normalized.slice(i, j));
    ranges.push({ start, end });
    i = j;
  }
  return { tokens, ranges };
}

/**
 * Find occurrences of `query` in `text` as a contiguous whole-token phrase,
 * mirroring the backend's exact mode (`match_phrase` on `content.exact`):
 * tashkeel/variant-insensitive like `findArabicMatches`, but a query token
 * only matches a complete text token (no sub-word hits), and punctuation
 * between phrase words is transparent (`كتاب، الله` matches `كتاب الله`).
 * Returned ranges are offsets into the ORIGINAL text.
 */
export function findArabicPhraseMatches(
  text: string,
  query: string
): Array<{ start: number; end: number }> {
  const needle = tokenizeArabicForSearch(query).tokens;
  if (needle.length === 0) return [];
  const { tokens, ranges } = tokenizeArabicForSearch(text);
  const matches: Array<{ start: number; end: number }> = [];
  for (let i = 0; i + needle.length <= tokens.length; i += 1) {
    let ok = true;
    for (let k = 0; k < needle.length; k += 1) {
      if (tokens[i + k] !== needle[k]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      matches.push({ start: ranges[i].start, end: ranges[i + needle.length - 1].end });
    }
  }
  return matches;
}
