import { describe, expect, it } from 'vitest';
import {
  TASHKEEL_CHAR,
  boundedLevenshtein,
  buildTashkeelStripMapping,
  classifyArabicTokenMatches,
  findArabicMatches,
  findArabicPhraseMatches,
  findArabicTokenSetMatches,
  normalizeArabicForSearch,
  tokenizeArabicForSearch,
} from './arabic';

describe('normalizeArabicForSearch', () => {
  it('strips tashkeel', () => {
    expect(normalizeArabicForSearch('العِلْمُ').normalized).toBe('العلم');
  });

  it('folds alef variants, alef maksura and teh marbuta; drops tatweel', () => {
    expect(normalizeArabicForSearch('أإآٱ').normalized).toBe('اااا');
    expect(normalizeArabicForSearch('هدى').normalized).toBe('هدي');
    expect(normalizeArabicForSearch('الحدة').normalized).toBe('الحده');
    expect(normalizeArabicForSearch('الكـــتاب').normalized).toBe('الكتاب');
  });

  it('keeps Arabic-Indic digits intact', () => {
    expect(normalizeArabicForSearch('صفحة ٥١').normalized).toBe('صفحه ٥١');
  });

  it('collapses whitespace runs and ignores leading whitespace', () => {
    // The trailing ى of على folds to ي in the normalized (never displayed) form.
    expect(normalizeArabicForSearch('  على\n الكبر').normalized).toBe('علي الكبر');
  });

  it('maps every normalized char back to its original index', () => {
    const original = 'عَلَى الكِبَر';
    const { normalized, toOriginal } = normalizeArabicForSearch(original);
    expect(toOriginal).toHaveLength(normalized.length);
    for (let i = 0; i < normalized.length; i += 1) {
      if (normalized[i] === ' ') continue;
      // Each mapped original char normalizes to the same output char.
      expect(normalizeArabicForSearch(original[toOriginal[i]]).normalized).toBe(normalized[i]);
    }
  });
});

describe('findArabicMatches', () => {
  const vocalized = 'وإذا تَطَبَّعَتِ النَّفْسُ على الكِبَرِ، كان أَضَرُّ عَلَيْها مِنْ طَبْعِ الحِدَةِ';

  it('matches a bare query against vocalized text and returns original offsets', () => {
    const ranges = findArabicMatches(vocalized, 'من طبع الحدة');
    expect(ranges).toHaveLength(1);
    const span = vocalized.slice(ranges[0].start, ranges[0].end);
    expect(span.startsWith('مِنْ')).toBe(true);
    expect(span.endsWith('الحِدَةِ')).toBe(true);
  });

  it('matches a vocalized query against bare text', () => {
    const ranges = findArabicMatches('كان أضر عليها من طبع الحدة', 'مِنْ طَبْعِ الحِدَّةِ');
    expect(ranges).toHaveLength(1);
    expect('كان أضر عليها من طبع الحدة'.slice(ranges[0].start, ranges[0].end)).toBe('من طبع الحدة');
  });

  it('matches across a newline inside a block', () => {
    const text = 'على\nالكبر';
    const ranges = findArabicMatches(text, 'على الكبر');
    expect(ranges).toEqual([{ start: 0, end: text.length }]);
  });

  it('finds multiple occurrences', () => {
    const text = 'الكِبَرُ ثم الكبر';
    expect(findArabicMatches(text, 'الكبر')).toHaveLength(2);
  });

  it('does not match different letters', () => {
    expect(findArabicMatches('الكبر', 'الصبر')).toEqual([]);
  });

  it('returns no ranges for empty or whitespace-only queries', () => {
    expect(findArabicMatches('نص', '')).toEqual([]);
    expect(findArabicMatches('نص', '   ')).toEqual([]);
    // A tashkeel-only query normalizes to nothing.
    expect(findArabicMatches('نص', 'ًٌٍ')).toEqual([]);
  });
});

describe('tokenizeArabicForSearch', () => {
  it('splits on whitespace and punctuation, normalizing each token', () => {
    const { tokens } = tokenizeArabicForSearch('قرأ كتاب، الله أكبر');
    expect(tokens).toEqual(['قرا', 'كتاب', 'الله', 'اكبر']);
  });

  it('returns original-offset ranges whose slices normalize back to the token', () => {
    const original = 'وإذا تَطَبَّعَتِ النَّفْسُ، على الكِبَرِ';
    const { tokens, ranges } = tokenizeArabicForSearch(original);
    expect(ranges).toHaveLength(tokens.length);
    for (let i = 0; i < tokens.length; i += 1) {
      const slice = original.slice(ranges[i].start, ranges[i].end);
      expect(normalizeArabicForSearch(slice).normalized).toBe(tokens[i]);
    }
  });
});

describe('findArabicPhraseMatches', () => {
  it('rejects sub-word occurrences', () => {
    expect(findArabicPhraseMatches('ذهب إلى المكتبة', 'كتب')).toEqual([]);
    expect(findArabicPhraseMatches('الكتاب والكتابة', 'الكتاب')).toHaveLength(1);
  });

  it('matches whole words only, at original offsets', () => {
    const text = 'طلب العلم فريضة والعلم نور';
    const ranges = findArabicPhraseMatches(text, 'العلم');
    expect(ranges).toHaveLength(1);
    expect(text.slice(ranges[0].start, ranges[0].end)).toBe('العلم');
  });

  it('treats punctuation between phrase words as transparent, like ES match_phrase', () => {
    const text = 'قرأ كتاب، الله أكبر';
    const ranges = findArabicPhraseMatches(text, 'كتاب الله');
    expect(ranges).toHaveLength(1);
    const span = text.slice(ranges[0].start, ranges[0].end);
    expect(span.startsWith('كتاب')).toBe(true);
    expect(span.endsWith('الله')).toBe(true);
  });

  it('does not match when an extra token sits between phrase words', () => {
    expect(findArabicPhraseMatches('كتاب عظيم لله', 'كتاب الله')).toEqual([]);
  });

  it('matches a bare query against vocalized text, including trailing tashkeel', () => {
    const vocalized = 'كان أَضَرُّ عَلَيْها مِنْ طَبْعِ الحِدَةِ';
    const ranges = findArabicPhraseMatches(vocalized, 'من طبع الحدة');
    expect(ranges).toHaveLength(1);
    const span = vocalized.slice(ranges[0].start, ranges[0].end);
    expect(span.startsWith('مِنْ')).toBe(true);
    expect(span.endsWith('الحِدَةِ')).toBe(true);
  });

  it('matches a vocalized query against bare text', () => {
    const text = 'كان أضر عليها من طبع الحدة';
    const ranges = findArabicPhraseMatches(text, 'مِنْ طَبْعِ الحِدَّةِ');
    expect(ranges).toHaveLength(1);
    expect(text.slice(ranges[0].start, ranges[0].end)).toBe('من طبع الحدة');
  });

  it('returns no ranges for queries that normalize to no tokens', () => {
    expect(findArabicPhraseMatches('نص', '')).toEqual([]);
    expect(findArabicPhraseMatches('نص', '   ')).toEqual([]);
    expect(findArabicPhraseMatches('نص', 'ًٌٍ')).toEqual([]);
    expect(findArabicPhraseMatches('نص', '،؟!')).toEqual([]);
  });

  it('matches a phrase across a newline', () => {
    const text = 'على\nالكبر';
    expect(findArabicPhraseMatches(text, 'على الكبر')).toEqual([{ start: 0, end: text.length }]);
  });

  it('reports overlapping repeated-phrase occurrences', () => {
    expect(findArabicPhraseMatches('الله الله الله', 'الله الله')).toHaveLength(2);
  });

  it('handles digits and Latin tokens', () => {
    expect(findArabicPhraseMatches('صفحة ٥١', '٥١')).toHaveLength(1);
    expect(findArabicPhraseMatches('test الكتاب', 'tes')).toEqual([]);
    expect(findArabicPhraseMatches('test الكتاب', 'test')).toHaveLength(1);
  });

  it('gives the same matches on the tashkeel-stripped display variant', () => {
    const original = 'كان أَضَرُّ عَلَيْها مِنْ طَبْعِ الحِدَةِ ثم من طبع الحدة';
    const { stripped } = buildTashkeelStripMapping(original);
    const query = 'من طبع الحدة';
    expect(findArabicPhraseMatches(stripped, query)).toHaveLength(
      findArabicPhraseMatches(original, query).length
    );
  });
});

describe('buildTashkeelStripMapping', () => {
  it('strips tashkeel and maps original indices to stripped indices', () => {
    const original = 'العِلْمُ نورٌ';
    const { stripped, mapping } = buildTashkeelStripMapping(original);
    expect(stripped).toBe('العلم نور');
    expect(mapping).toHaveLength(original.length + 1);
    expect(mapping[original.length]).toBe(stripped.length);
    for (let i = 0; i < original.length; i += 1) {
      if (!TASHKEEL_CHAR.test(original[i])) {
        expect(stripped[mapping[i]]).toBe(original[i]);
      }
    }
  });
});

describe('boundedLevenshtein', () => {
  it('computes exact distances within the budget', () => {
    expect(boundedLevenshtein('العلم', 'العلم', 2)).toBe(0);
    expect(boundedLevenshtein('العلم', 'العلوم', 2)).toBe(1);
    expect(boundedLevenshtein('كتاب', 'كتب', 2)).toBe(1);
  });

  it('early-exits past the budget with maxDist + 1', () => {
    expect(boundedLevenshtein('العلم', 'المعرفه', 1)).toBe(2);
    expect(boundedLevenshtein('اب', 'كتابكبير', 2)).toBe(3); // length gap alone busts the budget
  });
});

describe('classifyArabicTokenMatches', () => {
  it('returns nothing for an empty or tokenless query', () => {
    expect(classifyArabicTokenMatches('فضل العلم', '')).toEqual([]);
    expect(classifyArabicTokenMatches('فضل العلم', ' ، ')).toEqual([]);
  });

  it('marks exact token hits insensitive to tashkeel with original offsets', () => {
    const text = 'فَضْلُ العِلْمِ ونوره';
    const matches = classifyArabicTokenMatches(text, 'العلم');
    expect(matches).toHaveLength(1);
    expect(matches[0].kind).toBe('exact');
    expect(text.slice(matches[0].start, matches[0].end)).toBe('العِلْمِ');
  });

  it('marks near tokens at edit distance 1 for length >= 4', () => {
    const matches = classifyArabicTokenMatches('في العلوم فوائد', 'العلم');
    expect(matches).toHaveLength(1);
    expect(matches[0].kind).toBe('near');
  });

  it('never fuzzy-matches short tokens', () => {
    // "في" (2 chars) is within distance 1 of "فيه" but is below the length guard.
    expect(classifyArabicTokenMatches('في الدار', 'فيه')).toEqual([]);
  });

  it('marks a multi-word phrase occurrence as a single exact range', () => {
    const text = 'ذكر فضل العلم مرارا ثم فضل آخر';
    const matches = classifyArabicTokenMatches(text, 'فضل العلم');
    const exact = matches.filter((m) => m.kind === 'exact');
    expect(exact).toHaveLength(1);
    expect(text.slice(exact[0].start, exact[0].end)).toBe('فضل العلم');
    // The lone "فضل" later in the sentence is a near hit, not exact.
    const near = matches.filter((m) => m.kind === 'near');
    expect(near.length).toBeGreaterThanOrEqual(1);
    expect(near.every((m) => m.start > exact[0].end)).toBe(true);
  });

  it('returns sorted, non-overlapping ranges', () => {
    const text = 'العلم ثم العلوم ثم العلم';
    const matches = classifyArabicTokenMatches(text, 'العلم');
    for (let i = 1; i < matches.length; i += 1) {
      expect(matches[i].start).toBeGreaterThanOrEqual(matches[i - 1].end);
    }
  });
});

describe('findArabicTokenSetMatches', () => {
  it('marks whole-token occurrences of any token in the set', () => {
    const text = 'قرأت كتابهم ثم كتابكم مرة أخرى';
    const matches = findArabicTokenSetMatches(text, ['كتابهم', 'كتابكم']);
    expect(matches).toHaveLength(2);
    expect(text.slice(matches[0].start, matches[0].end)).toBe('كتابهم');
    expect(text.slice(matches[1].start, matches[1].end)).toBe('كتابكم');
  });

  it('never matches inside a longer word', () => {
    expect(findArabicTokenSetMatches('جاء العلماء جميعا', ['علم'])).toEqual([]);
  });

  it('is tashkeel/variant-insensitive with original offsets', () => {
    const text = 'فَضْلُ العِلْمِ ونوره';
    const matches = findArabicTokenSetMatches(text, ['العلم']);
    expect(matches).toHaveLength(1);
    expect(text.slice(matches[0].start, matches[0].end)).toBe('العِلْمِ');
  });

  it('returns nothing for empty or whitespace-only token sets', () => {
    expect(findArabicTokenSetMatches('نص ما', [])).toEqual([]);
    expect(findArabicTokenSetMatches('نص ما', ['  '])).toEqual([]);
  });
});
