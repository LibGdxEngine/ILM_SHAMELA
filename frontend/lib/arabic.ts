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

/**
 * Find every whole-token occurrence of any of `tokens` in `text`,
 * tashkeel/variant-insensitive. Used by the PDF overlay to mark the surface
 * tokens a lexical/fuzzy backend hit actually matched (pulled from the ES
 * highlight fragments — e.g. `كتابهم` for the query `كتاب`): the fragments
 * carry the document's own token, so whole-token equality reproduces the
 * backend hit without substring false positives (`علم` inside `العلماء`).
 * Returned ranges are offsets into the ORIGINAL text, in document order.
 */
export function findArabicTokenSetMatches(
  text: string,
  tokens: Iterable<string>
): Array<{ start: number; end: number }> {
  const needles = new Set<string>();
  for (const token of tokens) {
    const normalized = normalizeArabicForSearch(token).normalized.trim();
    if (normalized) needles.add(normalized);
  }
  if (needles.size === 0) return [];
  const { tokens: textTokens, ranges } = tokenizeArabicForSearch(text);
  const matches: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < textTokens.length; i += 1) {
    if (needles.has(textTokens[i])) matches.push(ranges[i]);
  }
  return matches;
}

/**
 * Levenshtein distance with an early exit: returns `maxDist + 1` as soon as the
 * distance provably exceeds `maxDist`, so token classification stays cheap on
 * long pages.
 */
export function boundedLevenshtein(a: string, b: string, maxDist: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let cur = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    cur[0] = i;
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > maxDist) return maxDist + 1;
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/** How a reading-sheet token relates to the active search query:
 *  `exact` (gold — the searched phrase itself) or `near` (lighter — a token
 *  within a small edit distance of a query token). */
export type SheetTokenKind = 'exact' | 'near';

/**
 * Classify the tokens of `text` against `query` for in-sheet search marking
 * (Reader & Search v2). Whole-phrase occurrences are `exact`; individual
 * tokens within a bounded edit distance of a query token are `near` (edit
 * budget: 1 for normalized length ≥ 4, 2 for ≥ 7; tokens shorter than 3 chars
 * never fuzzy-match). For multi-word queries, lone occurrences of a single
 * query word count as `near`, not `exact`. Semantic (meaning-level) relations
 * can't be computed client-side and are deliberately out of scope. Returned
 * ranges are offsets into the ORIGINAL text, sorted and non-overlapping.
 */
export function classifyArabicTokenMatches(
  text: string,
  query: string
): Array<{ start: number; end: number; kind: SheetTokenKind }> {
  const queryTokens = tokenizeArabicForSearch(query).tokens;
  if (queryTokens.length === 0) return [];

  const results: Array<{ start: number; end: number; kind: SheetTokenKind }> = findArabicPhraseMatches(
    text,
    query
  ).map((r) => ({ ...r, kind: 'exact' as SheetTokenKind }));

  const { tokens, ranges } = tokenizeArabicForSearch(text);
  for (let i = 0; i < tokens.length; i += 1) {
    const range = ranges[i];
    if (results.some((r) => range.start < r.end && r.start < range.end)) continue;
    const token = tokens[i];
    if (token.length < 3) continue;
    for (const queryToken of queryTokens) {
      if (queryToken.length < 3) continue;
      if (token === queryToken) {
        // Only reachable for multi-word queries (a single-token query's
        // equality hits are already exact phrase ranges above).
        results.push({ ...range, kind: 'near' });
        break;
      }
      const maxLen = Math.max(token.length, queryToken.length);
      const budget = maxLen >= 7 ? 2 : maxLen >= 4 ? 1 : 0;
      if (budget > 0 && boundedLevenshtein(token, queryToken, budget) <= budget) {
        results.push({ ...range, kind: 'near' });
        break;
      }
    }
  }
  results.sort((a, b) => a.start - b.start);
  return results;
}
