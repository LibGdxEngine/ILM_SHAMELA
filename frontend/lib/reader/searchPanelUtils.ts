// Pure helpers for the Reader & Search v2 panel: match-kind resolution and
// tab counting/filtering/sorting over ONE `mode=all` response (tab switches
// never re-fetch), plus citation/CSV formatting for the result-card actions.

import type { DocumentSearchMatch, InDocMatchKind } from '../api';
import { normalizeArabicForSearch } from '../arabic';

export type SearchScope = 'book' | 'library';
export type SearchKindTab = 'all' | InDocMatchKind;
export type SearchSort = 'relevance' | 'page';

/**
 * Kind of a match. Prefers the backend's `match_kind`; falls back on the score
 * shape for older responses: no lexical signal → semantic, a saturated lexical
 * score → exact, anything else → lexical.
 */
export function resolveMatchKind(match: DocumentSearchMatch): InDocMatchKind {
  if (match.match_kind) return match.match_kind;
  const lexical = match.score_lexical ?? 0;
  if (lexical <= 0) return 'semantic';
  if (lexical >= 0.999) return 'exact';
  return 'lexical';
}

export function countMatchesByKind(matches: DocumentSearchMatch[]): Record<SearchKindTab, number> {
  const counts: Record<SearchKindTab, number> = { all: matches.length, exact: 0, lexical: 0, semantic: 0 };
  for (const match of matches) {
    counts[resolveMatchKind(match)] += 1;
  }
  return counts;
}

export function filterMatchesByTab(
  matches: DocumentSearchMatch[],
  tab: SearchKindTab
): DocumentSearchMatch[] {
  if (tab === 'all') return matches;
  return matches.filter((m) => resolveMatchKind(m) === tab);
}

/** Client-side slice by term row (multi-term search): matches whose
 *  `matched_terms` includes `index`; `null` = no term filter. Semantic-only
 *  pages (`matched_terms: []`) only survive the `null` filter. */
export function filterMatchesByTerm(
  matches: DocumentSearchMatch[],
  index: number | null
): DocumentSearchMatch[] {
  if (index === null) return matches;
  return matches.filter((m) => (m.matched_terms ?? []).includes(index));
}

/** Stable sort: `relevance` by descending `score_final`, `page` by ascending page number. */
export function sortMatches(matches: DocumentSearchMatch[], sort: SearchSort): DocumentSearchMatch[] {
  const indexed = matches.map((match, index) => ({ match, index }));
  indexed.sort((a, b) => {
    const cmp =
      sort === 'page'
        ? a.match.page_number - b.match.page_number
        : (b.match.score_final ?? 0) - (a.match.score_final ?? 0);
    return cmp !== 0 ? cmp : a.index - b.index;
  });
  return indexed.map((entry) => entry.match);
}

/** Session identity of a result (drives the «محفوظ» saved-note map). */
export function resultKey(match: DocumentSearchMatch): string {
  return `${match.page_number}:${resolveMatchKind(match)}:${match.snippet.slice(0, 40)}`;
}

/** Strip the backend's <mark> highlight tags (and any stray markup) from a snippet. */
export function stripHtml(snippet: string): string {
  return snippet.replace(/<[^>]+>/g, '');
}

/** Tokens per page the overlay will look for — matches arrive relevance-sorted,
 *  so the best-attributed tokens win the slots. */
const MARKED_TOKENS_CAP = 24;

function unescapeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Per-page matched surface tokens pulled from the snippets' `<mark>` runs (the
 * backend highlights the document's own tokens, for exact AND lexical/fuzzy
 * matches — semantic snippets carry no marks and contribute nothing). Tokens
 * are normalized (`normalizeArabicForSearch`) so tashkeel variants of the same
 * word dedupe; the overlay re-normalizes the page text the same way. A mark
 * can span several words (ES merges adjacent phrase terms), so captures are
 * whitespace-split before normalization.
 */
export function extractMarkedTokens(
  matches: DocumentSearchMatch[],
  cap = MARKED_TOKENS_CAP
): Map<number, string[]> {
  const byPage = new Map<number, string[]>();
  for (const match of matches) {
    for (const [, marked] of match.snippet.matchAll(/<mark>([^<]*)<\/mark>/g)) {
      for (const word of unescapeEntities(marked).split(/\s+/)) {
        const normalized = normalizeArabicForSearch(word).normalized.trim();
        if (normalized.length < 2) continue;
        let tokens = byPage.get(match.page_number);
        if (!tokens) {
          tokens = [];
          byPage.set(match.page_number, tokens);
        }
        if (tokens.length >= cap || tokens.includes(normalized)) continue;
        tokens.push(normalized);
      }
    }
  }
  return byPage;
}

export interface OverlayMarking {
  /** Query whose whole-token phrase occurrences get the strong overlay mark;
   *  '' when the active tab excludes exact hits. */
  query: string;
  /** Per-page lexical surface tokens for the lighter `--near` overlay marks;
   *  empty when the active tab excludes them. */
  tokensByPage: Map<number, string[]>;
}

/**
 * What the PDF overlay should mark for the selected kind tab — mirroring the
 * result cards the tab shows: الكل = phrase + lexical tokens, تام = phrase
 * only, لفظي = tokens only, دلالي = nothing (no token-level match exists).
 * Tokens come only from lexical-kind matches: exact-match fragments wrap every
 * query word (stopwords included), which would spray near-marks over words the
 * strong phrase marks already cover.
 */
export function overlayMarking(
  matches: DocumentSearchMatch[],
  tab: SearchKindTab,
  executedQuery: string
): OverlayMarking {
  const query = tab === 'all' || tab === 'exact' ? executedQuery : '';
  const tokensByPage =
    tab === 'all' || tab === 'lexical'
      ? extractMarkedTokens(matches.filter((m) => resolveMatchKind(m) === 'lexical'))
      : new Map<number, string[]>();
  return { query, tokensByPage };
}

export interface CitationParts {
  bookTitle: string;
  chapter: string | null;
  /** Already-localized page label (e.g. Arabic-Indic digits). */
  localizedPage: string;
}

/** «snippet» — book، chapter، ص N. (chapter segment omitted when unknown) */
export function formatCitation(match: DocumentSearchMatch, parts: CitationParts): string {
  const source = [parts.bookTitle, parts.chapter, `ص ${parts.localizedPage}`]
    .filter(Boolean)
    .join('، ');
  return `«${stripHtml(match.snippet).trim()}» — ${source}.`;
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export interface CsvRow {
  page: number;
  kind: string;
  score: number | null;
  snippet: string;
}

/**
 * RFC-4180 CSV of the current result list, prefixed with a UTF-8 BOM so Excel
 * opens the Arabic text correctly. Header + one row per match.
 */
export function buildResultsCsv(rows: CsvRow[], header: { page: string; kind: string; score: string; snippet: string }): string {
  const lines = [
    [header.page, header.kind, header.score, header.snippet].map(csvEscape).join(','),
    ...rows.map((row) =>
      [String(row.page), row.kind, row.score == null ? '' : String(row.score), stripHtml(row.snippet)]
        .map(csvEscape)
        .join(',')
    ),
  ];
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}
