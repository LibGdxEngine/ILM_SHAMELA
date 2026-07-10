import { describe, expect, it } from 'vitest';
import { TASHKEEL_CHAR, buildTashkeelStripMapping, findArabicMatches, normalizeArabicForSearch } from './arabic';

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
