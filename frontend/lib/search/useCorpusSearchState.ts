'use client';

import { useMemo, useState } from 'react';

import type { CorpusSearchMode } from '@/lib/api';
import type { DocumentFilterValues } from '@/lib/documentsSearchParams';
import type { SelectedBook } from '@/components/search/console/types';

/** Every corpus filter dimension the search console can edit. The `/documents`
 *  page adapts its own useStates onto this shape; landing/reader/map own it
 *  locally via `useLocalCorpusSearchState`. */
export interface CorpusFilterState {
  mode: CorpusSearchMode;
  categories: string[];
  authors: string[];
  books: SelectedBook[];
  languages: string[];
  countries: string[];
  deathCenturies: number[];
  dateFrom: string;
  dateTo: string;
}

export interface CorpusFilterHandlers {
  setMode: (mode: CorpusSearchMode) => void;
  toggleCategory: (name: string) => void;
  toggleAuthor: (name: string) => void;
  toggleBook: (book: SelectedBook) => void;
  toggleLanguage: (code: string) => void;
  toggleCountry: (name: string) => void;
  toggleDeathCentury: (century: number) => void;
  setDateFrom: (value: string) => void;
  setDateTo: (value: string) => void;
  clearAll: () => void;
  /** Ingest a preset / assist / URL blob (replace semantics; missing keys →
   *  empty). Books arrive as ids only — callers that can resolve titles do so
   *  themselves; this local version stores `{id, title: '#id'}` placeholders
   *  only when nothing better is available. */
  applyFilterValues: (values: DocumentFilterValues, books?: SelectedBook[]) => void;
}

export const EMPTY_CORPUS_FILTERS: CorpusFilterState = {
  mode: 'hybrid',
  categories: [],
  authors: [],
  books: [],
  languages: [],
  countries: [],
  deathCenturies: [],
  dateFrom: '',
  dateTo: '',
};

export function toggleIn<T>(list: T[], value: T, equals: (a: T, b: T) => boolean = (a, b) => a === b): T[] {
  return list.some((item) => equals(item, value))
    ? list.filter((item) => !equals(item, value))
    : [...list, value];
}

/** Number of active facet selections (mode counts when non-default; the free
 *  text `q` is not a facet). Drives "any filters engaged?" checks + badges. */
export function countActiveFilters(filters: CorpusFilterState): number {
  return (
    (filters.mode !== 'hybrid' ? 1 : 0) +
    filters.categories.length +
    filters.authors.length +
    filters.books.length +
    filters.languages.length +
    filters.countries.length +
    filters.deathCenturies.length +
    (filters.dateFrom ? 1 : 0) +
    (filters.dateTo ? 1 : 0)
  );
}

/** Serialize the state (+ free-text q/refine) into the persisted/URL shape. */
export function corpusFiltersToValues(
  filters: CorpusFilterState,
  q: string,
  refine = '',
): DocumentFilterValues {
  return {
    q,
    refine,
    mode: filters.mode,
    documents: filters.books.map((b) => b.id),
    authors: filters.authors,
    categories: filters.categories,
    languages: filters.languages,
    countries: filters.countries,
    deathCenturies: filters.deathCenturies,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
  };
}

/** Normalize a persisted blob (old presets may lack newer keys). */
export function corpusFiltersFromValues(
  values: DocumentFilterValues,
  books: SelectedBook[] = [],
): CorpusFilterState {
  const m = values.mode;
  return {
    mode: m === 'exact' || m === 'semantic' || m === 'hybrid' ? m : 'hybrid',
    categories: values.categories ?? [],
    authors: values.authors ?? [],
    books,
    languages: values.languages ?? [],
    countries: values.countries ?? [],
    deathCenturies: (values.deathCenturies ?? []).filter(
      (c) => Number.isInteger(c) && c > 0,
    ),
    dateFrom: values.dateFrom ?? '',
    dateTo: values.dateTo ?? '',
  };
}

/**
 * Self-contained corpus filter state for surfaces without in-place results
 * (landing / reader / map — they serialize to a `/documents` URL on submit).
 * The `/documents` page instead adapts its own lifted state onto the same
 * `{filters, handlers}` contract so the console works identically everywhere.
 */
export default function useLocalCorpusSearchState(): {
  filters: CorpusFilterState;
  handlers: CorpusFilterHandlers;
} {
  const [filters, setFilters] = useState<CorpusFilterState>(EMPTY_CORPUS_FILTERS);

  const handlers = useMemo<CorpusFilterHandlers>(() => ({
    setMode: (mode) => setFilters((f) => ({ ...f, mode })),
    toggleCategory: (name) =>
      setFilters((f) => ({ ...f, categories: toggleIn(f.categories, name) })),
    toggleAuthor: (name) =>
      setFilters((f) => ({ ...f, authors: toggleIn(f.authors, name) })),
    toggleBook: (book) =>
      setFilters((f) => ({
        ...f,
        books: toggleIn(f.books, book, (a, b) => a.id === b.id),
      })),
    toggleLanguage: (code) =>
      setFilters((f) => ({ ...f, languages: toggleIn(f.languages, code) })),
    toggleCountry: (name) =>
      setFilters((f) => ({ ...f, countries: toggleIn(f.countries, name) })),
    toggleDeathCentury: (century) =>
      setFilters((f) => ({ ...f, deathCenturies: toggleIn(f.deathCenturies, century) })),
    setDateFrom: (value) => setFilters((f) => ({ ...f, dateFrom: value })),
    setDateTo: (value) => setFilters((f) => ({ ...f, dateTo: value })),
    clearAll: () => setFilters(EMPTY_CORPUS_FILTERS),
    applyFilterValues: (values, books = []) =>
      setFilters(corpusFiltersFromValues(values, books)),
  }), []);

  return { filters, handlers };
}
