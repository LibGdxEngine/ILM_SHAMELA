/**
 * Multi-term corpus/in-book query model. A search is a list of term rows, each
 * with its own match criteria, combined as flat boolean rows:
 * (all musts) AND (should₁ ∨ …) AND NOT (any must_not) — mirroring the
 * backend's `POST documents/search/query/` contract.
 */

/** How a single term row matches:
 *  - `phrase`: exact phrase (order + adjacency)
 *  - `word`: exact word(s), all required, no fuzziness
 *  - `fuzzy`: edit-distance tolerant (per-term `fuzziness`)
 *  - `stem`: root/derivative matching (تقارب لفظي — stemmed Arabic analyzer)
 */
export type TermMatch = 'phrase' | 'word' | 'fuzzy' | 'stem';

/** Boolean role of the row: must (يجب) / should (أو) / must_not (بدون). */
export type TermOp = 'must' | 'should' | 'must_not';

export type TermFuzziness = 0 | 1 | 2 | 'AUTO';

/** Diacritics handling: `ignore` matches regardless of harakat (default);
 *  `sensitive` requires the vocalization as typed. `stem` rows are always
 *  `ignore` (the stemmed analyzer strips harakat). */
export type TermDiacritics = 'ignore' | 'sensitive';

export interface SearchTerm {
  /** Client-only row identity (never serialized). */
  id: string;
  text: string;
  match: TermMatch;
  /** Only meaningful when `match === 'fuzzy'`. */
  fuzziness?: TermFuzziness;
  diacritics: TermDiacritics;
  op: TermOp;
}

/** Corpus search scope: every book / the user's own uploads / an explicit
 *  selected set (the console's book multi-select). */
export type SearchScopeType = 'all' | 'mine' | 'selected';

export const MAX_SEARCH_TERMS = 8;

let termCounter = 0;

/** New default term row (must / word / diacritics-insensitive). */
export function createSearchTerm(partial: Partial<Omit<SearchTerm, 'id'>> = {}): SearchTerm {
  termCounter += 1;
  const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `term-${Date.now()}-${termCounter}`;
  return {
    id,
    text: '',
    match: 'word',
    diacritics: 'ignore',
    op: 'must',
    ...partial,
  };
}

/** Strip client-only fields for persistence / API payloads. */
export type SerializedSearchTerm = Omit<SearchTerm, 'id'>;

export function serializeSearchTerm(term: SearchTerm): SerializedSearchTerm {
  const { id: _id, ...rest } = term;
  if (rest.match !== 'fuzzy') delete rest.fuzziness;
  if (rest.match === 'stem') rest.diacritics = 'ignore';
  return rest;
}

const MATCHES: readonly TermMatch[] = ['phrase', 'word', 'fuzzy', 'stem'];
const OPS: readonly TermOp[] = ['must', 'should', 'must_not'];

/** Revive a persisted row (unknown/invalid fields default safely). */
export function deserializeSearchTerm(raw: unknown): SearchTerm | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const text = typeof r.text === 'string' ? r.text.trim() : '';
  if (!text) return null;
  const match = MATCHES.includes(r.match as TermMatch) ? (r.match as TermMatch) : 'word';
  const op = OPS.includes(r.op as TermOp) ? (r.op as TermOp) : 'must';
  const fuzziness: TermFuzziness | undefined =
    match === 'fuzzy'
      ? (r.fuzziness === 0 || r.fuzziness === 1 || r.fuzziness === 2 ? r.fuzziness : 'AUTO')
      : undefined;
  const diacritics: TermDiacritics =
    match !== 'stem' && r.diacritics === 'sensitive' ? 'sensitive' : 'ignore';
  return createSearchTerm({ text, match, op, fuzziness, diacritics });
}
