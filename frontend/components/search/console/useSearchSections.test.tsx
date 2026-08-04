import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import useSearchSections from './useSearchSections';
import {
  EMPTY_CORPUS_FILTERS,
  type CorpusFilterHandlers,
  type CorpusFilterState,
} from '@/lib/search/useCorpusSearchState';

vi.mock('@/components/i18n/I18nProvider', () => ({
  useI18n: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    locale: 'en',
    direction: 'ltr',
    dictionary: {},
  }),
}));

vi.mock('@/lib/i18n/languageName', () => ({
  useLanguageName: () => (code: string) => `lang:${code}`,
}));

const fetchFacetOptionsMock = vi.fn();
vi.mock('@/lib/search/optionSources', () => ({
  fetchCategoryOptions: vi.fn(),
  fetchAuthorOptions: vi.fn(),
  fetchBookOptions: vi.fn(),
  fetchFacetOptions: () => fetchFacetOptionsMock(),
}));

vi.mock('@/lib/api/extraction', () => ({
  fetchPersonOptions: vi.fn(),
  fetchPlaceOptions: vi.fn(),
}));

const handlers: CorpusFilterHandlers = {
  setMode: vi.fn(),
  setScope: vi.fn(),
  addTerm: vi.fn(),
  updateTerm: vi.fn(),
  removeTerm: vi.fn(),
  setTerms: vi.fn(),
  toggleCategory: vi.fn(),
  toggleAuthor: vi.fn(),
  toggleBook: vi.fn(),
  toggleLanguage: vi.fn(),
  toggleCountry: vi.fn(),
  toggleDeathCentury: vi.fn(),
  toggleGenre: vi.fn(),
  toggleMadhhab: vi.fn(),
  toggleEraCentury: vi.fn(),
  togglePhysicalClass: vi.fn(),
  togglePerson: vi.fn(),
  togglePlace: vi.fn(),
  setDateFrom: vi.fn(),
  setDateTo: vi.fn(),
  clearAll: vi.fn(),
  applyFilterValues: vi.fn(),
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const FACET_PAYLOAD = {
  languages: [{ value: 'ar', count: 12 }],
  death_centuries: [{ value: 8, count: 5 }],
  countries: [{ value: 'مصر', count: 7 }],
  genres: [],
  madhhabs: [],
  era_centuries: [],
  physical_classes: [],
};

describe('useSearchSections', () => {
  it('gates everything but the mode section when signed out', () => {
    const { result } = renderHook(
      () =>
        useSearchSections({
          filters: EMPTY_CORPUS_FILTERS,
          handlers,
          isAuthenticated: false,
          presetCount: 3,
        }),
      { wrapper },
    );
    expect(result.current.map((s) => s.key)).toEqual(['mode']);
  });

  it('builds the full ordered section list with badges when authenticated', async () => {
    fetchFacetOptionsMock.mockResolvedValue(FACET_PAYLOAD);
    const filters: CorpusFilterState = {
      ...EMPTY_CORPUS_FILTERS,
      mode: 'exact',
      categories: ['فقه', 'حديث'],
      deathCenturies: [8],
    };
    const { result } = renderHook(
      () =>
        useSearchSections({ filters, handlers, isAuthenticated: true, presetCount: 2 }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.map((s) => s.key)).toEqual([
        'presets', 'mode', 'terms', 'scope', 'categories', 'authors',
        'languages', 'countries', 'deathCenturies', 'persons', 'places', 'dates',
      ]);
    });

    const byKey = Object.fromEntries(result.current.map((s) => [s.key, s]));
    expect(byKey.presets.badge).toBe(2);
    expect(byKey.mode.badge).toBe(1); // exact ≠ hybrid
    expect(byKey.categories.badge).toBe(2);
    expect(byKey.deathCenturies.badge).toBe(1);

    // The book multi-select nests inside the scope section.
    const scope = byKey.scope;
    if (scope.kind !== 'scope') throw new Error('bad scope spec');
    expect(scope.scope).toBe('all');
    expect(scope.showMine).toBe(true);
    expect(scope.books.key).toBe('books');

    // Static options got labeled + counted.
    const langs = byKey.languages;
    if (langs.kind !== 'options' || langs.source.type !== 'static') throw new Error('bad spec');
    expect(langs.source.options).toEqual([{ id: 'ar', label: 'lang:ar', count: 12 }]);
    const centuries = byKey.deathCenturies;
    if (centuries.kind !== 'options' || centuries.source.type !== 'static') throw new Error('bad spec');
    expect(centuries.source.options[0].label).toMatch(/8th century AH/);
  });

  it('hides failed static sections unless they carry selections (degraded)', async () => {
    fetchFacetOptionsMock.mockRejectedValue(new Error('503'));
    const filters: CorpusFilterState = {
      ...EMPTY_CORPUS_FILTERS,
      countries: ['مصر'],
    };
    const { result } = renderHook(
      () =>
        useSearchSections({ filters, handlers, isAuthenticated: true, presetCount: 0 }),
      { wrapper },
    );

    // Once the fetch settles as failed, countries survives (it has a
    // selection) flagged degraded, while the other static sections vanish.
    await waitFor(() => {
      const countries = result.current.find((s) => s.key === 'countries');
      expect(countries?.kind === 'options' && countries.degraded).toBe(true);
    });
    const keys = result.current.map((s) => s.key);
    expect(keys).not.toContain('languages');
    expect(keys).not.toContain('deathCenturies');
  });
});
