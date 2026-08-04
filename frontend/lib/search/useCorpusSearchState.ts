'use client';

import { useMemo, useState } from 'react';

import type { CorpusSearchMode } from '@/lib/api';
import type { DocumentFilterValues } from '@/lib/documentsSearchParams';
import type { SelectedBook, SelectedEntity } from '@/components/search/console/types';

export type { SelectedEntity };
import {
  createSearchTerm,
  deserializeSearchTerm,
  serializeSearchTerm,
  type SearchScopeType,
  type SearchTerm,
} from '@/lib/search/terms';

/** Every corpus filter dimension the search console can edit. The `/documents`
 *  page adapts its own useStates onto this shape; landing/reader/map own it
 *  locally via `useLocalCorpusSearchState`. */
export interface CorpusFilterState {
  mode: CorpusSearchMode;
  /** `selected` is implied by a non-empty `books`; `mine`/`all` never carry
   *  books (the handlers enforce the invariant). */
  scope: SearchScopeType;
  /** Multi-term query rows (empty = plain single-input search). */
  terms: SearchTerm[];
  categories: string[];
  authors: string[];
  books: SelectedBook[];
  languages: string[];
  countries: string[];
  deathCenturies: number[];
  genres: string[];
  madhhabs: string[];
  eraCenturies: number[];
  physicalClasses: string[];
  persons: SelectedEntity[];
  places: SelectedEntity[];
  dateFrom: string;
  dateTo: string;
}

export interface CorpusFilterHandlers {
  setMode: (mode: CorpusSearchMode) => void;
  /** Choosing `mine`/`all` clears the selected books. */
  setScope: (scope: SearchScopeType) => void;
  addTerm: (partial?: Partial<Omit<SearchTerm, 'id'>>) => void;
  updateTerm: (id: string, patch: Partial<Omit<SearchTerm, 'id'>>) => void;
  removeTerm: (id: string) => void;
  setTerms: (terms: SearchTerm[]) => void;
  toggleCategory: (name: string) => void;
  toggleAuthor: (name: string) => void;
  /** Adding the first book flips scope to `selected`; removing the last one
   *  resets it to `all`. */
  toggleBook: (book: SelectedBook) => void;
  toggleLanguage: (code: string) => void;
  toggleCountry: (name: string) => void;
  toggleDeathCentury: (century: number) => void;
  toggleGenre: (value: string) => void;
  toggleMadhhab: (value: string) => void;
  toggleEraCentury: (century: number) => void;
  togglePhysicalClass: (value: string) => void;
  togglePerson: (entity: SelectedEntity) => void;
  togglePlace: (entity: SelectedEntity) => void;
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
  scope: 'all',
  terms: [],
  categories: [],
  authors: [],
  books: [],
  languages: [],
  countries: [],
  deathCenturies: [],
  genres: [],
  madhhabs: [],
  eraCenturies: [],
  physicalClasses: [],
  persons: [],
  places: [],
  dateFrom: '',
  dateTo: '',
};

/** Book-toggle + scope invariant shared by every state owner (the local hook
 *  below and the `/documents` page adapter). */
export function nextBooksAndScope(
  books: SelectedBook[],
  scope: SearchScopeType,
  book: SelectedBook,
): { books: SelectedBook[]; scope: SearchScopeType } {
  const next = toggleIn(books, book, (a, b) => a.id === b.id);
  if (next.length > 0) return { books: next, scope: 'selected' };
  return { books: next, scope: scope === 'selected' ? 'all' : scope };
}

/** Scope-change + books invariant (mine/all never carry selected books). */
export function nextScopeAndBooks(
  scope: SearchScopeType,
  books: SelectedBook[],
): { scope: SearchScopeType; books: SelectedBook[] } {
  return { scope, books: scope === 'selected' ? books : [] };
}

export function toggleIn<T>(list: T[], value: T, equals: (a: T, b: T) => boolean = (a, b) => a === b): T[] {
  return list.some((item) => equals(item, value))
    ? list.filter((item) => !equals(item, value))
    : [...list, value];
}

/** Number of active facet selections (mode counts when non-default; the free
 *  text `q` is not a facet). Drives "any filters engaged?" checks + badges.
 *  `selected` scope counts through its books; `mine` counts as one. */
export function countActiveFilters(filters: CorpusFilterState): number {
  return (
    (filters.mode !== 'hybrid' ? 1 : 0) +
    (filters.scope === 'mine' ? 1 : 0) +
    filters.terms.length +
    filters.categories.length +
    filters.authors.length +
    filters.books.length +
    filters.languages.length +
    filters.countries.length +
    filters.deathCenturies.length +
    filters.genres.length +
    filters.madhhabs.length +
    filters.eraCenturies.length +
    filters.physicalClasses.length +
    filters.persons.length +
    filters.places.length +
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
    version: 2,
    q,
    refine,
    mode: filters.mode,
    scope: filters.scope,
    terms: filters.terms.map(serializeSearchTerm),
    documents: filters.books.map((b) => b.id),
    authors: filters.authors,
    categories: filters.categories,
    languages: filters.languages,
    countries: filters.countries,
    deathCenturies: filters.deathCenturies,
    genres: filters.genres,
    madhhabs: filters.madhhabs,
    eraCenturies: filters.eraCenturies,
    physicalClasses: filters.physicalClasses,
    persons: filters.persons.map((p) => p.id),
    places: filters.places.map((p) => p.id),
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
  };
}

/** Normalize a persisted blob — the single version shim: v1 blobs lack
 *  `scope`/`terms`/`version`, so scope derives from a book selection and
 *  terms default empty. Always read with defaults. */
export function corpusFiltersFromValues(
  values: DocumentFilterValues,
  books: SelectedBook[] = [],
): CorpusFilterState {
  const m = values.mode;
  const hasBooks = books.length > 0 || (values.documents ?? []).length > 0;
  const scope: SearchScopeType =
    values.scope === 'mine' && !hasBooks
      ? 'mine'
      : hasBooks
        ? 'selected'
        : 'all';
  const terms = (values.terms ?? [])
    .map(deserializeSearchTerm)
    .filter((t): t is SearchTerm => t !== null);
  return {
    mode: m === 'exact' || m === 'semantic' || m === 'hybrid' ? m : 'hybrid',
    scope,
    terms,
    categories: values.categories ?? [],
    authors: values.authors ?? [],
    books,
    languages: values.languages ?? [],
    countries: values.countries ?? [],
    deathCenturies: (values.deathCenturies ?? []).filter(
      (c) => Number.isInteger(c) && c > 0,
    ),
    genres: values.genres ?? [],
    madhhabs: values.madhhabs ?? [],
    eraCenturies: (values.eraCenturies ?? []).filter(
      (c) => Number.isInteger(c) && c >= 1 && c <= 15,
    ),
    physicalClasses: values.physicalClasses ?? [],
    persons: (values.persons ?? []).filter((n) => Number.isInteger(n) && n > 0).map((id) => ({ id, label: '#' + id })),
    places: (values.places ?? []).filter((n) => Number.isInteger(n) && n > 0).map((id) => ({ id, label: '#' + id })),
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
    setScope: (scope) =>
      setFilters((f) => ({ ...f, ...nextScopeAndBooks(scope, f.books) })),
    addTerm: (partial) =>
      setFilters((f) => ({ ...f, terms: [...f.terms, createSearchTerm(partial)] })),
    updateTerm: (id, patch) =>
      setFilters((f) => ({
        ...f,
        terms: f.terms.map((term) => (term.id === id ? { ...term, ...patch } : term)),
      })),
    removeTerm: (id) =>
      setFilters((f) => ({ ...f, terms: f.terms.filter((term) => term.id !== id) })),
    setTerms: (terms) => setFilters((f) => ({ ...f, terms })),
    toggleCategory: (name) =>
      setFilters((f) => ({ ...f, categories: toggleIn(f.categories, name) })),
    toggleAuthor: (name) =>
      setFilters((f) => ({ ...f, authors: toggleIn(f.authors, name) })),
    toggleBook: (book) =>
      setFilters((f) => ({
        ...f,
        ...nextBooksAndScope(f.books, f.scope, book),
      })),
    toggleLanguage: (code) =>
      setFilters((f) => ({ ...f, languages: toggleIn(f.languages, code) })),
    toggleCountry: (name) =>
      setFilters((f) => ({ ...f, countries: toggleIn(f.countries, name) })),
    toggleDeathCentury: (century) =>
      setFilters((f) => ({ ...f, deathCenturies: toggleIn(f.deathCenturies, century) })),
    toggleGenre: (value) =>
      setFilters((f) => ({ ...f, genres: toggleIn(f.genres, value) })),
    toggleMadhhab: (value) =>
      setFilters((f) => ({ ...f, madhhabs: toggleIn(f.madhhabs, value) })),
    toggleEraCentury: (century) =>
      setFilters((f) => ({ ...f, eraCenturies: toggleIn(f.eraCenturies, century) })),
    togglePhysicalClass: (value) =>
      setFilters((f) => ({ ...f, physicalClasses: toggleIn(f.physicalClasses, value) })),
    togglePerson: (entity) =>
      setFilters((f) => ({ ...f, persons: toggleIn(f.persons, entity, (a, b) => a.id === b.id) })),
    togglePlace: (entity) =>
      setFilters((f) => ({ ...f, places: toggleIn(f.places, entity, (a, b) => a.id === b.id) })),
    setDateFrom: (value) => setFilters((f) => ({ ...f, dateFrom: value })),
    setDateTo: (value) => setFilters((f) => ({ ...f, dateTo: value })),
    clearAll: () => setFilters(EMPTY_CORPUS_FILTERS),
    applyFilterValues: (values, books = []) =>
      setFilters(corpusFiltersFromValues(values, books)),
  }), []);

  return { filters, handlers };
}
