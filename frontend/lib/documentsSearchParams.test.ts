import { describe, expect, it } from 'vitest';

import { buildDocumentsSearchParams, type DocumentFilterValues } from './documentsSearchParams';

describe('buildDocumentsSearchParams', () => {
  it('serializes every filter dimension as CSV params', () => {
    const params = buildDocumentsSearchParams({
      q: 'الفقه',
      mode: 'exact',
      documents: [3, 7],
      authors: ['ابن تيمية', 'ابن القيم'],
      categories: ['فقه'],
      languages: ['ar', 'en'],
      countries: ['مصر', 'الشام'],
      deathCenturies: [7, 8],
      genres: ['fiqh', 'hadith'],
      madhhabs: ['hanbali'],
      eraCenturies: [4, 5],
      physicalClasses: ['book'],
      persons: [101, 202],
      places: [301],
      dateFrom: '2020-01-01',
      dateTo: '2021-01-01',
    });
    expect(params.get('q')).toBe('الفقه');
    expect(params.get('mode')).toBe('exact');
    expect(params.get('documents')).toBe('3,7');
    expect(params.get('authors')).toBe('ابن تيمية,ابن القيم');
    expect(params.get('categories')).toBe('فقه');
    expect(params.get('languages')).toBe('ar,en');
    expect(params.get('countries')).toBe('مصر,الشام');
    expect(params.get('death_centuries')).toBe('7,8');
    expect(params.get('genre')).toBe('fiqh,hadith');
    expect(params.get('madhhab')).toBe('hanbali');
    expect(params.get('era_centuries')).toBe('4,5');
    expect(params.get('physical_class')).toBe('book');
    expect(params.get('persons')).toBe('101,202');
    expect(params.get('places')).toBe('301');
    expect(params.get('date_from')).toBe('2020-01-01');
    expect(params.get('date_to')).toBe('2021-01-01');
  });

  it('omits defaults and empty values', () => {
    const params = buildDocumentsSearchParams({
      q: '  ',
      mode: 'hybrid',
      documents: [],
      authors: [],
      categories: [],
      languages: [],
      countries: [],
      deathCenturies: [],
      genres: [],
      madhhabs: [],
      eraCenturies: [],
      physicalClasses: [],
      persons: [],
      places: [],
      sort: 'relevance',
      status: 'all',
      view: 'grid',
    });
    expect(params.toString()).toBe('');
  });

  it('serializes scope=mine and omits all/selected', () => {
    expect(buildDocumentsSearchParams({ scope: 'mine' }).get('scope')).toBe('mine');
    expect(buildDocumentsSearchParams({ scope: 'all' }).has('scope')).toBe(false);
    // `selected` is implied by `documents`, never serialized itself.
    const selected = buildDocumentsSearchParams({ scope: 'selected', documents: [3] });
    expect(selected.has('scope')).toBe(false);
    expect(selected.get('documents')).toBe('3');
  });

  it('accepts old-shape input without the newer keys', () => {
    // Persisted blobs from before countries/deathCenturies existed.
    const old: DocumentFilterValues = {
      q: 'كتاب',
      authors: ['السيوطي'],
      categories: [],
      languages: ['ar'],
    };
    const params = buildDocumentsSearchParams(old);
    expect(params.get('q')).toBe('كتاب');
    expect(params.get('authors')).toBe('السيوطي');
    expect(params.get('languages')).toBe('ar');
    expect(params.has('countries')).toBe(false);
    expect(params.has('death_centuries')).toBe(false);
  });
});
