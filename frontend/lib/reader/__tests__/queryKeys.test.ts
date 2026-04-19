import { describe, expect, it } from 'vitest';
import { readerKeys } from '../queryKeys';

describe('readerKeys', () => {
  it('returns stable tuples for each resource', () => {
    expect(readerKeys.preferences()).toEqual(['reader', 'preferences']);
    expect(readerKeys.bookmarks(42)).toEqual(['reader', 'bookmarks', 42]);
    expect(readerKeys.notes(7)).toEqual(['reader', 'notes', 7]);
    expect(readerKeys.highlights(99)).toEqual(['reader', 'highlights', 99]);
    expect(readerKeys.progress(3)).toEqual(['reader', 'progress', 3]);
    expect(readerKeys.continueReading()).toEqual(['reader', 'continue']);
  });

  it('namespaces every key under "reader"', () => {
    const samples = [
      readerKeys.preferences(),
      readerKeys.bookmarks(1),
      readerKeys.notes(1),
      readerKeys.highlights(1),
      readerKeys.progress(1),
      readerKeys.continueReading(),
    ];
    for (const key of samples) {
      expect(key[0]).toBe('reader');
    }
  });
});
