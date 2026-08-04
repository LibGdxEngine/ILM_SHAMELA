import { describe, expect, it } from 'vitest';
import { segmentTextWithRanges } from '../segmentTextWithRanges';

describe('segmentTextWithRanges', () => {
  it('returns empty array for empty content', () => {
    expect(segmentTextWithRanges('', [])).toEqual([]);
    expect(segmentTextWithRanges('', [{ start: 0, end: 0 }])).toEqual([]);
  });

  it('returns a single plain segment when no ranges are given', () => {
    const result = segmentTextWithRanges('hello world', []);
    expect(result).toEqual([{ text: 'hello world', activeRangeIndices: [] }]);
  });

  it('marks a single range in the middle', () => {
    // "hello [world] foo"
    const result = segmentTextWithRanges('hello world foo', [{ start: 6, end: 11 }]);
    expect(result).toEqual([
      { text: 'hello ', activeRangeIndices: [] },
      { text: 'world', activeRangeIndices: [0] },
      { text: ' foo', activeRangeIndices: [] },
    ]);
  });

  it('marks a range at the very start', () => {
    const result = segmentTextWithRanges('hello world', [{ start: 0, end: 5 }]);
    expect(result).toEqual([
      { text: 'hello', activeRangeIndices: [0] },
      { text: ' world', activeRangeIndices: [] },
    ]);
  });

  it('marks a range at the very end', () => {
    const result = segmentTextWithRanges('hello world', [{ start: 6, end: 11 }]);
    expect(result).toEqual([
      { text: 'hello ', activeRangeIndices: [] },
      { text: 'world', activeRangeIndices: [0] },
    ]);
  });

  it('marks a range that spans the whole string', () => {
    const result = segmentTextWithRanges('hello', [{ start: 0, end: 5 }]);
    expect(result).toEqual([{ text: 'hello', activeRangeIndices: [0] }]);
  });

  it('handles two non-overlapping ranges', () => {
    // "aa[bb]cc[dd]ee"
    const result = segmentTextWithRanges('aabbccddee', [
      { start: 2, end: 4 },
      { start: 6, end: 8 },
    ]);
    expect(result).toEqual([
      { text: 'aa', activeRangeIndices: [] },
      { text: 'bb', activeRangeIndices: [0] },
      { text: 'cc', activeRangeIndices: [] },
      { text: 'dd', activeRangeIndices: [1] },
      { text: 'ee', activeRangeIndices: [] },
    ]);
  });

  it('attributes overlapping ranges to both segments', () => {
    // Range 0: [0,6), Range 1: [3,9)
    // Boundaries: 0,3,6,9,10
    // [0,3) → range 0; [3,6) → range 0 + range 1; [6,9) → range 1; [9,10) → none
    const result = segmentTextWithRanges('0123456789', [
      { start: 0, end: 6 },
      { start: 3, end: 9 },
    ]);
    expect(result).toEqual([
      { text: '012', activeRangeIndices: [0] },
      { text: '345', activeRangeIndices: [0, 1] },
      { text: '678', activeRangeIndices: [1] },
      { text: '9', activeRangeIndices: [] },
    ]);
  });

  it('clamps start < 0 to 0', () => {
    const result = segmentTextWithRanges('hello', [{ start: -5, end: 3 }]);
    expect(result).toEqual([
      { text: 'hel', activeRangeIndices: [0] },
      { text: 'lo', activeRangeIndices: [] },
    ]);
  });

  it('clamps end > content.length to content.length', () => {
    const result = segmentTextWithRanges('hello', [{ start: 3, end: 999 }]);
    expect(result).toEqual([
      { text: 'hel', activeRangeIndices: [] },
      { text: 'lo', activeRangeIndices: [0] },
    ]);
  });

  it('drops zero-length ranges (start === end after clamping)', () => {
    const result = segmentTextWithRanges('hello', [{ start: 2, end: 2 }]);
    expect(result).toEqual([{ text: 'hello', activeRangeIndices: [] }]);
  });

  it('drops inverted ranges (start > end)', () => {
    const result = segmentTextWithRanges('hello', [{ start: 4, end: 1 }]);
    expect(result).toEqual([{ text: 'hello', activeRangeIndices: [] }]);
  });

  it('drops completely out-of-range intervals', () => {
    // start and end both clamp to len → zero-length after clamping → dropped
    const result = segmentTextWithRanges('hello', [{ start: 10, end: 20 }]);
    expect(result).toEqual([{ text: 'hello', activeRangeIndices: [] }]);
  });

  it('preserves original indices when some ranges are dropped', () => {
    // Range 0 is invalid (zero-length); range 1 is valid.
    const result = segmentTextWithRanges('hello world', [
      { start: 3, end: 3 }, // dropped
      { start: 6, end: 11 }, // valid → index 1
    ]);
    expect(result).toEqual([
      { text: 'hello ', activeRangeIndices: [] },
      { text: 'world', activeRangeIndices: [1] },
    ]);
  });
});
