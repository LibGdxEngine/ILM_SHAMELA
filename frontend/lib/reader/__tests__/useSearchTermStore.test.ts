import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseReaderPreferencesResult } from '../useReaderPreferences';
import { useSearchTermStore } from '../useSearchTermStore';

const DOC_ID = 42;

function makePrefs(extra?: Record<string, unknown>): UseReaderPreferencesResult {
  return {
    data: {
      font_size: 'medium',
      theme: 'light',
      font_weight: 400,
      letter_spacing: 0,
      line_height: 1.8,
      tashkeel_enabled: true,
      extra,
    },
    isLoading: false,
    update: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('useSearchTermStore — recents (localStorage)', () => {
  it('keeps MRU order, dedupes and caps at 5', () => {
    const { result } = renderHook(() => useSearchTermStore(DOC_ID, makePrefs()));
    act(() => {
      for (const term of ['أ', 'ب', 'ج', 'د', 'هـ', 'و']) result.current.addRecent(term);
    });
    expect(result.current.recents).toEqual(['و', 'هـ', 'د', 'ج', 'ب']);
    act(() => result.current.addRecent('د'));
    expect(result.current.recents).toEqual(['د', 'و', 'هـ', 'ج', 'ب']);
  });

  it('persists to and rehydrates from localStorage per document', () => {
    const first = renderHook(() => useSearchTermStore(DOC_ID, makePrefs()));
    act(() => first.result.current.addRecent('اليقين'));
    first.unmount();

    const second = renderHook(() => useSearchTermStore(DOC_ID, makePrefs()));
    expect(second.result.current.recents).toEqual(['اليقين']);

    const otherDoc = renderHook(() => useSearchTermStore(7, makePrefs()));
    expect(otherDoc.result.current.recents).toEqual([]);
  });

  it('ignores empty terms', () => {
    const { result } = renderHook(() => useSearchTermStore(DOC_ID, makePrefs()));
    act(() => result.current.addRecent('   '));
    expect(result.current.recents).toEqual([]);
  });
});

describe('useSearchTermStore — pins (ReaderPreference.extra)', () => {
  it('reads pins for this document from extra.search_pins', () => {
    const prefs = makePrefs({ search_pins: { [String(DOC_ID)]: ['العلم النافع'], '9': ['غيره'] } });
    const { result } = renderHook(() => useSearchTermStore(DOC_ID, prefs));
    expect(result.current.pinned).toEqual(['العلم النافع']);
  });

  it('pins by PATCHing a merged extra object (other keys preserved)', () => {
    const prefs = makePrefs({ other_setting: true, search_pins: { '9': ['غيره'] } });
    const { result } = renderHook(() => useSearchTermStore(DOC_ID, prefs));
    act(() => result.current.pinTerm('اليقين'));
    expect(prefs.update).toHaveBeenCalledWith({
      extra: {
        other_setting: true,
        search_pins: { '9': ['غيره'], [String(DOC_ID)]: ['اليقين'] },
      },
    });
  });

  it('caps pins at 6 (MRU)', () => {
    const existing = ['١', '٢', '٣', '٤', '٥', '٦'];
    const prefs = makePrefs({ search_pins: { [String(DOC_ID)]: existing } });
    const { result } = renderHook(() => useSearchTermStore(DOC_ID, prefs));
    act(() => result.current.pinTerm('٧'));
    expect(prefs.update).toHaveBeenCalledWith({
      extra: { search_pins: { [String(DOC_ID)]: ['٧', '١', '٢', '٣', '٤', '٥'] } },
    });
  });

  it('unpins and drops the document key when the list empties', () => {
    const prefs = makePrefs({ search_pins: { [String(DOC_ID)]: ['اليقين'] } });
    const { result } = renderHook(() => useSearchTermStore(DOC_ID, prefs));
    act(() => result.current.unpinTerm('اليقين'));
    expect(prefs.update).toHaveBeenCalledWith({ extra: { search_pins: {} } });
  });
});
