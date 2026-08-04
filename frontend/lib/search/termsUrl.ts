/**
 * Compact URL grammar for multi-term rows: repeated `t=` params, each
 *
 *     t=<op><match><flags>:<text>
 *
 *     op:    '+' must (default) | '~' should | '-' must_not
 *     match: 'p' phrase | 'w' word | 'f' fuzzy(AUTO) | 'f1' | 'f2' | 's' stem
 *     flags: 'd' = diacritics-sensitive (absent = ignore)
 *
 * Example: `?t=%2Bpd:فضل العلم&t=~f1:التصوف&t=-w:فلسفة`
 *
 * Human-readable, hand-editable, and each row degrades independently — a
 * malformed row is dropped, never the whole set.
 */
import {
  createSearchTerm,
  type SearchTerm,
  type SerializedSearchTerm,
  type TermFuzziness,
  type TermMatch,
  type TermOp,
} from './terms';

const OP_TO_CHAR: Record<TermOp, string> = {
  must: '+',
  should: '~',
  must_not: '-',
};

const CHAR_TO_OP: Record<string, TermOp> = {
  '+': 'must',
  '~': 'should',
  '-': 'must_not',
};

function matchCode(term: SerializedSearchTerm): string {
  switch (term.match) {
    case 'phrase':
      return 'p';
    case 'stem':
      return 's';
    case 'fuzzy':
      return term.fuzziness === 1 ? 'f1' : term.fuzziness === 2 ? 'f2' : 'f';
    default:
      return 'w';
  }
}

export function serializeTerm(term: SerializedSearchTerm): string {
  const flags = term.match !== 'stem' && term.diacritics === 'sensitive' ? 'd' : '';
  return `${OP_TO_CHAR[term.op]}${matchCode(term)}${flags}:${term.text}`;
}

export function serializeTerms(terms: readonly SerializedSearchTerm[]): string[] {
  return terms.filter((t) => t.text.trim()).map(serializeTerm);
}

/** One `t=` value → a term row, or null when malformed. */
export function parseTerm(raw: string): SearchTerm | null {
  const sep = raw.indexOf(':');
  if (sep <= 0) return null;
  const prefix = raw.slice(0, sep);
  const text = raw.slice(sep + 1).trim();
  if (!text) return null;

  const op = CHAR_TO_OP[prefix[0]];
  if (!op) return null;
  let rest = prefix.slice(1);

  let match: TermMatch;
  let fuzziness: TermFuzziness | undefined;
  if (rest.startsWith('f1')) {
    match = 'fuzzy'; fuzziness = 1; rest = rest.slice(2);
  } else if (rest.startsWith('f2')) {
    match = 'fuzzy'; fuzziness = 2; rest = rest.slice(2);
  } else if (rest.startsWith('f')) {
    match = 'fuzzy'; fuzziness = 'AUTO'; rest = rest.slice(1);
  } else if (rest.startsWith('p')) {
    match = 'phrase'; rest = rest.slice(1);
  } else if (rest.startsWith('w')) {
    match = 'word'; rest = rest.slice(1);
  } else if (rest.startsWith('s')) {
    match = 'stem'; rest = rest.slice(1);
  } else {
    return null;
  }

  let diacritics: 'ignore' | 'sensitive' = 'ignore';
  if (rest === 'd' && match !== 'stem') {
    diacritics = 'sensitive';
  } else if (rest !== '') {
    return null;
  }

  return createSearchTerm({ text, match, fuzziness, diacritics, op });
}

/** All `t=` values of a query string → valid term rows (malformed dropped). */
export function parseTerms(values: readonly string[]): SearchTerm[] {
  return values
    .map(parseTerm)
    .filter((t): t is SearchTerm => t !== null);
}
