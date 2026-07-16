import { describe, expect, it } from 'vitest';
import type { DocumentSearchMatch } from '../../api';
import {
  buildResultsCsv,
  countMatchesByKind,
  extractMarkedTokens,
  filterMatchesByTab,
  formatCitation,
  overlayMarking,
  resolveMatchKind,
  resultKey,
  sortMatches,
  stripHtml,
} from '../searchPanelUtils';

const match = (overrides: Partial<DocumentSearchMatch>): DocumentSearchMatch => ({
  page_number: 1,
  snippet: 'فضل <mark>العلم</mark>',
  ...overrides,
});

describe('resolveMatchKind', () => {
  it('prefers the backend match_kind', () => {
    expect(resolveMatchKind(match({ match_kind: 'semantic', score_lexical: 1 }))).toBe('semantic');
  });

  it('falls back on the score shape for legacy responses', () => {
    expect(resolveMatchKind(match({ score_lexical: 0, score_semantic: 0.7 }))).toBe('semantic');
    expect(resolveMatchKind(match({ score_lexical: 1.0 }))).toBe('exact');
    expect(resolveMatchKind(match({ score_lexical: 0.5 }))).toBe('lexical');
  });
});

describe('countMatchesByKind / filterMatchesByTab', () => {
  const matches = [
    match({ match_kind: 'exact', page_number: 1 }),
    match({ match_kind: 'lexical', page_number: 2 }),
    match({ match_kind: 'lexical', page_number: 3 }),
    match({ match_kind: 'semantic', page_number: 4 }),
  ];

  it('counts every kind plus the total', () => {
    expect(countMatchesByKind(matches)).toEqual({ all: 4, exact: 1, lexical: 2, semantic: 1 });
  });

  it('filters by tab and passes everything through for "all"', () => {
    expect(filterMatchesByTab(matches, 'all')).toHaveLength(4);
    expect(filterMatchesByTab(matches, 'lexical').map((m) => m.page_number)).toEqual([2, 3]);
    expect(filterMatchesByTab(matches, 'semantic').map((m) => m.page_number)).toEqual([4]);
  });
});

describe('sortMatches', () => {
  const matches = [
    match({ page_number: 9, score_final: 0.4 }),
    match({ page_number: 2, score_final: 0.9 }),
    match({ page_number: 5, score_final: 0.4 }),
  ];

  it('sorts by descending score for relevance, keeping input order on ties', () => {
    expect(sortMatches(matches, 'relevance').map((m) => m.page_number)).toEqual([2, 9, 5]);
  });

  it('sorts by ascending page for page order', () => {
    expect(sortMatches(matches, 'page').map((m) => m.page_number)).toEqual([2, 5, 9]);
  });

  it('does not mutate the input', () => {
    const before = matches.map((m) => m.page_number);
    sortMatches(matches, 'page');
    expect(matches.map((m) => m.page_number)).toEqual(before);
  });
});

describe('stripHtml / resultKey', () => {
  it('strips mark tags', () => {
    expect(stripHtml('فضل <mark>العلم</mark> واهله')).toBe('فضل العلم واهله');
  });

  it('distinguishes results by page, kind and snippet prefix', () => {
    const a = match({ page_number: 3, match_kind: 'exact' });
    const b = match({ page_number: 3, match_kind: 'lexical' });
    expect(resultKey(a)).not.toBe(resultKey(b));
    expect(resultKey(a)).toBe(resultKey({ ...a }));
  });
});

describe('formatCitation', () => {
  it('formats «snippet» — book، chapter، ص N.', () => {
    const cite = formatCitation(match({ snippet: 'فضل <mark>العلم</mark>' }), {
      bookTitle: 'إحياء علوم الدين',
      chapter: 'كتاب العلم',
      localizedPage: '٤٢',
    });
    expect(cite).toBe('«فضل العلم» — إحياء علوم الدين، كتاب العلم، ص ٤٢.');
  });

  it('omits the chapter segment when unknown', () => {
    const cite = formatCitation(match({}), {
      bookTitle: 'إحياء علوم الدين',
      chapter: null,
      localizedPage: '٧',
    });
    expect(cite).toBe('«فضل العلم» — إحياء علوم الدين، ص ٧.');
  });
});

describe('buildResultsCsv', () => {
  const header = { page: 'الصفحة', kind: 'النوع', score: 'الدرجة', snippet: 'المقطع' };

  it('starts with a UTF-8 BOM and a header row', () => {
    const csv = buildResultsCsv([], header);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('الصفحة,النوع,الدرجة,المقطع');
  });

  it('escapes quotes, commas and newlines per RFC 4180 and strips marks', () => {
    const csv = buildResultsCsv(
      [
        { page: 3, kind: 'تام', score: 0.8, snippet: 'قال "الغزالي": <mark>العلم</mark>, نور\nوضياء' },
      ],
      header
    );
    expect(csv).toContain('3,تام,0.8,"قال ""الغزالي"": العلم, نور\nوضياء"');
    expect(csv).not.toContain('<mark>');
  });

  it('leaves the score cell empty when null', () => {
    const csv = buildResultsCsv([{ page: 1, kind: 'دلالي', score: null, snippet: 'س' }], header);
    expect(csv).toContain('1,دلالي,,س');
  });
});

describe('extractMarkedTokens', () => {
  it('collects normalized marked tokens per page', () => {
    const tokens = extractMarkedTokens([
      match({ page_number: 3, snippet: 'فضل <mark>العِلْمِ</mark> ثم <mark>كتابهم</mark>' }),
      match({ page_number: 7, snippet: 'ذكر <mark>الحكمة</mark> هنا' }),
    ]);
    expect(tokens.get(3)).toEqual(['العلم', 'كتابهم']);
    expect(tokens.get(7)).toEqual(['الحكمه']);
  });

  it('dedupes tashkeel variants of the same token on a page', () => {
    const tokens = extractMarkedTokens([
      match({ page_number: 1, snippet: '<mark>كِتَاب</mark> ثم <mark>كتاب</mark>' }),
    ]);
    expect(tokens.get(1)).toEqual(['كتاب']);
  });

  it('splits multi-word marks into individual tokens', () => {
    const tokens = extractMarkedTokens([
      match({ page_number: 1, snippet: 'قال <mark>كتاب الله</mark> تعالى' }),
    ]);
    expect(tokens.get(1)).toEqual(['كتاب', 'الله']);
  });

  it('contributes nothing for markless (semantic) snippets', () => {
    const tokens = extractMarkedTokens([match({ page_number: 4, snippet: 'نص دلالي بلا وسم' })]);
    expect(tokens.has(4)).toBe(false);
  });

  it('drops single-character tokens and respects the per-page cap', () => {
    const words = Array.from({ length: 30 }, (_, i) => `<mark>كلمة${i}</mark>`).join(' ');
    const tokens = extractMarkedTokens([match({ page_number: 1, snippet: `<mark>و</mark> ${words}` })]);
    expect(tokens.get(1)).toHaveLength(24);
    // ة folds to ه under normalization.
    expect(tokens.get(1)?.[0]).toBe('كلمه0');
  });

  it('unescapes HTML entities inside marks', () => {
    const tokens = extractMarkedTokens([
      match({ page_number: 1, snippet: '<mark>a&amp;b</mark>' }),
    ]);
    expect(tokens.get(1)).toEqual(['a&b']);
  });
});

describe('overlayMarking', () => {
  const matches = [
    // Exact hit: fragments mark every query word, stopwords included.
    match({ page_number: 2, match_kind: 'exact', snippet: '<mark>في</mark> <mark>هذه</mark> <mark>الصنعة</mark>' }),
    match({ page_number: 5, match_kind: 'lexical', snippet: 'ذكر <mark>مقاصدها</mark> هنا' }),
    match({ page_number: 8, match_kind: 'semantic', snippet: 'نص دلالي بلا وسم' }),
  ];
  const query = 'في هذه الصنعة';

  it('الكل: phrase query plus tokens from lexical matches only', () => {
    const marks = overlayMarking(matches, 'all', query);
    expect(marks.query).toBe(query);
    expect(marks.tokensByPage.get(5)).toEqual(['مقاصدها']);
    // The exact hit's per-word marks (في/هذه/الصنعة) must not spray near-marks.
    expect(marks.tokensByPage.has(2)).toBe(false);
  });

  it('تام: phrase query only, no tokens even when lexical matches exist', () => {
    const marks = overlayMarking(matches, 'exact', query);
    expect(marks.query).toBe(query);
    expect(marks.tokensByPage.size).toBe(0);
  });

  it('لفظي: tokens only, no phrase query', () => {
    const marks = overlayMarking(matches, 'lexical', query);
    expect(marks.query).toBe('');
    expect(marks.tokensByPage.get(5)).toEqual(['مقاصدها']);
  });

  it('دلالي: nothing to mark', () => {
    const marks = overlayMarking(matches, 'semantic', query);
    expect(marks.query).toBe('');
    expect(marks.tokensByPage.size).toBe(0);
  });

  it('falls back on the score shape for legacy responses without match_kind', () => {
    const legacy = [match({ page_number: 3, score_lexical: 0.5, snippet: '<mark>كتابهم</mark>' })];
    expect(overlayMarking(legacy, 'all', query).tokensByPage.get(3)).toEqual(['كتابهم']);
  });
});
