import type { CorpusSearchMode } from '@/lib/api';
import type { SearchScopeType, SerializedSearchTerm } from '@/lib/search/terms';
import { serializeTerms } from '@/lib/search/termsUrl';

/**
 * The full set of `/documents` list-page query params, in one place so every
 * surface that links into the library (`/documents` itself, `/map`, landing,
 * the reader) serializes them identically. Mirrors the param names the
 * `/documents` page reads back from the URL (`q`, `refine`, `authors`,
 * `categories`, `languages`, `date_from`, `date_to`, `sort`, `status`, `view`)
 * plus the new corpus-search additions (`mode`, `documents`).
 */
export interface DocumentsSearchState {
  q?: string;
  refine?: string;
  mode?: CorpusSearchMode;
  /** Corpus scope: `mine` restricts to the user's uploads; `selected` is
   *  implied by a non-empty `documents`; `all` (default) is omitted. */
  scope?: SearchScopeType;
  /** Multi-term query rows (serialized, no client row ids). */
  terms?: SerializedSearchTerm[];
  documents?: number[];
  authors?: string[];
  categories?: string[];
  languages?: string[];
  /** Author nationality names (researcher facet). */
  countries?: string[];
  /** Hijri centuries of author death (researcher facet). */
  deathCenturies?: number[];
  /** Genre / discipline slug (corpus facet). */
  genres?: string[];
  /** Madhhab slug (corpus facet). */
  madhhabs?: string[];
  /** Hijri centuries of composition (corpus facet). */
  eraCenturies?: number[];
  /** Physical / material class slug (corpus facet). */
  physicalClasses?: string[];
  /** Person entity ids (extraction facet). */
  persons?: number[];
  /** Place entity ids (extraction facet). */
  places?: number[];
  dateFrom?: string;
  dateTo?: string;
  sort?: string;
  status?: string;
  view?: string;
}

/** The subset of DocumentsSearchState that represents actual filters (not
 *  sort/status/view, which stay purely display prefs) — the shape persisted
 *  as the user's auto-saved filter state and as named saved presets. Old
 *  persisted blobs may lack newer keys: always read with defaults. */
export type DocumentFilterValues = Pick<DocumentsSearchState,
  'q' | 'refine' | 'mode' | 'scope' | 'terms' | 'documents' | 'authors'
  | 'categories' | 'languages' | 'countries' | 'deathCenturies'
  | 'genres' | 'madhhabs' | 'eraCenturies' | 'physicalClasses'
  | 'persons' | 'places'
  | 'dateFrom' | 'dateTo'> & {
  /** Blob schema version; absent = v1 (no scope/terms). */
  version?: number;
};

/**
 * Serialize `DocumentsSearchState` into a `/documents` query string. Empty,
 * undefined and default-valued fields are omitted so URLs stay clean:
 * `mode` is dropped when `'hybrid'` (the backend default) and `sort`/`status`/
 * `view` are dropped at their page defaults (`relevance`/`all`/`grid`), matching
 * the suppression the `/documents` page already applies to its own inline builder.
 */
export function buildDocumentsSearchParams(state: DocumentsSearchState): URLSearchParams {
  const params = new URLSearchParams();

  const q = state.q?.trim();
  if (q) params.set('q', q);

  const refine = state.refine?.trim();
  if (refine) params.set('refine', refine);

  if (state.mode && state.mode !== 'hybrid') {
    params.set('mode', state.mode);
  }
  // `selected` is implied by `documents`; `all` is the default — only `mine`
  // needs an explicit param.
  if (state.scope === 'mine') {
    params.set('scope', 'mine');
  }
  // Multi-term rows as repeated `t=` params (see lib/search/termsUrl.ts for
  // the mini-grammar). Empty rows are dropped by serializeTerms.
  for (const row of serializeTerms(state.terms ?? [])) {
    params.append('t', row);
  }
  if (state.documents && state.documents.length > 0) {
    params.set('documents', state.documents.join(','));
  }
  if (state.authors && state.authors.length > 0) {
    params.set('authors', state.authors.join(','));
  }
  if (state.categories && state.categories.length > 0) {
    params.set('categories', state.categories.join(','));
  }
  if (state.languages && state.languages.length > 0) {
    params.set('languages', state.languages.join(','));
  }
  if (state.countries && state.countries.length > 0) {
    params.set('countries', state.countries.join(','));
  }
  if (state.deathCenturies && state.deathCenturies.length > 0) {
    params.set('death_centuries', state.deathCenturies.join(','));
  }
  if (state.genres && state.genres.length > 0) {
    params.set('genre', state.genres.join(','));
  }
  if (state.madhhabs && state.madhhabs.length > 0) {
    params.set('madhhab', state.madhhabs.join(','));
  }
  if (state.eraCenturies && state.eraCenturies.length > 0) {
    params.set('era_centuries', state.eraCenturies.join(','));
  }
  if (state.physicalClasses && state.physicalClasses.length > 0) {
    params.set('physical_class', state.physicalClasses.join(','));
  }
  if (state.persons && state.persons.length > 0) {
    params.set('persons', state.persons.join(','));
  }
  if (state.places && state.places.length > 0) {
    params.set('places', state.places.join(','));
  }

  const dateFrom = state.dateFrom?.trim();
  if (dateFrom) params.set('date_from', dateFrom);

  const dateTo = state.dateTo?.trim();
  if (dateTo) params.set('date_to', dateTo);

  if (state.sort && state.sort !== 'relevance') params.set('sort', state.sort);
  if (state.status && state.status !== 'all') params.set('status', state.status);
  if (state.view && state.view !== 'grid') params.set('view', state.view);

  return params;
}

export default buildDocumentsSearchParams;
