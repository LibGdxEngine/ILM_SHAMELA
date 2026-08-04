import { describe, expect, it } from 'vitest';

import { parseTerm, parseTerms, serializeTerm, serializeTerms } from './termsUrl';
import type { SerializedSearchTerm } from './terms';

const strip = (t: { id: string } & SerializedSearchTerm): SerializedSearchTerm => {
  const { id: _id, ...rest } = t;
  return rest;
};

describe('termsUrl grammar', () => {
  it('serializes every op/match/flag combination', () => {
    expect(serializeTerm({ text: 'فضل العلم', match: 'phrase', diacritics: 'ignore', op: 'must' }))
      .toBe('+p:فضل العلم');
    expect(serializeTerm({ text: 'فَضْل', match: 'phrase', diacritics: 'sensitive', op: 'must' }))
      .toBe('+pd:فَضْل');
    expect(serializeTerm({ text: 'زكاة', match: 'word', diacritics: 'ignore', op: 'should' }))
      .toBe('~w:زكاة');
    expect(serializeTerm({ text: 'التصوف', match: 'fuzzy', fuzziness: 'AUTO', diacritics: 'ignore', op: 'must' }))
      .toBe('+f:التصوف');
    expect(serializeTerm({ text: 'التصوف', match: 'fuzzy', fuzziness: 1, diacritics: 'ignore', op: 'must' }))
      .toBe('+f1:التصوف');
    expect(serializeTerm({ text: 'التصوف', match: 'fuzzy', fuzziness: 2, diacritics: 'ignore', op: 'must' }))
      .toBe('+f2:التصوف');
    expect(serializeTerm({ text: 'الإجماع', match: 'stem', diacritics: 'ignore', op: 'must_not' }))
      .toBe('-s:الإجماع');
  });

  it('round-trips through parse', () => {
    const terms: SerializedSearchTerm[] = [
      { text: 'فضل العلم', match: 'phrase', diacritics: 'sensitive', op: 'must' },
      { text: 'زكاة', match: 'stem', diacritics: 'ignore', op: 'must' },
      { text: 'التصوف', match: 'fuzzy', fuzziness: 1, diacritics: 'ignore', op: 'should' },
      { text: 'فلسفة', match: 'word', diacritics: 'ignore', op: 'must_not' },
    ];
    const parsed = parseTerms(serializeTerms(terms)).map(strip);
    expect(parsed).toEqual(terms);
  });

  it('keeps colons inside the text', () => {
    const row = serializeTerm({ text: 'البقرة: ٢٥٥', match: 'word', diacritics: 'ignore', op: 'must' });
    expect(parseTerm(row)?.text).toBe('البقرة: ٢٥٥');
  });

  it('drops malformed rows without dropping the rest', () => {
    const parsed = parseTerms([
      '+w:صحيح',
      'garbage',        // no op char
      '+z:بلا معنى',    // unknown match code
      '+w:',            // empty text
      '~s:الإجماع',
    ]);
    expect(parsed.map((t) => t.text)).toEqual(['صحيح', 'الإجماع']);
  });

  it('never emits a sensitive flag for stem and ignores it on parse', () => {
    expect(serializeTerm({ text: 'x', match: 'stem', diacritics: 'sensitive', op: 'must' }))
      .toBe('+s:x');
    expect(parseTerm('+sd:x')).toBeNull();
  });

  it('drops empty-text rows on serialize', () => {
    expect(serializeTerms([{ text: '  ', match: 'word', diacritics: 'ignore', op: 'must' }]))
      .toEqual([]);
  });
});
