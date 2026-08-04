import type { CorpusSearchMode } from '@/lib/api';
import type { SearchScopeType, SearchTerm } from '@/lib/search/terms';

/** A book selected as a search scope. Canonical home of the type (moved from
 *  `SearchFacetControls`; `NavSearchPopover` re-exports it for old importers). */
export interface SelectedBook {
  id: number;
  title: string;
}

/** A named entity (person or place) selected as a facet. */
export interface SelectedEntity {
  id: number;
  label: string;
}

export type FilterSectionKey =
  | 'presets'
  | 'mode'
  | 'terms'
  | 'scope'
  | 'categories'
  | 'authors'
  | 'books'
  | 'languages'
  | 'countries'
  | 'deathCenturies'
  | 'genres'
  | 'madhhabs'
  | 'eraCenturies'
  | 'physicalClasses'
  | 'persons'
  | 'places'
  | 'dates';

/** One selectable row in a filter section. `id` is the canonical value sent
 *  to the backend (name / code / numeric id); `label` is what renders. */
export interface OptionItem {
  id: string | number;
  label: string;
  count?: number;
}

export interface OptionSearchPage {
  count: number;
  options: OptionItem[];
}

/**
 * Where a section's options come from:
 *  - `search`: paginated server typeahead (authors / books / categories) —
 *    the pane fetches via `useOptionSearch`, empty query = first page.
 *  - `static`: a bounded list (languages / countries / death centuries)
 *    already fetched (and labeled) by `useSearchSections`; the pane filters
 *    it client-side.
 */
export type OptionSource =
  | {
      type: 'search';
      cacheKey: string;
      fetchOptions: (search: string) => Promise<OptionSearchPage>;
    }
  | {
      type: 'static';
      options: OptionItem[];
    };

interface SectionBase {
  key: FilterSectionKey;
  /** Localized section title (rail row / accordion header). */
  label: string;
  /** Selected-count badge; 0 hides the badge. */
  badge: number;
}

export interface OptionsSectionSpec extends SectionBase {
  kind: 'options';
  source: OptionSource;
  /** Current selections, already labeled (pinned on top of the pane). */
  selected: OptionItem[];
  onToggle: (option: OptionItem) => void;
  /** A static source failed to load but selections exist (old preset / deep
   *  link) — the pane shows the selections plus an inline load-error note. */
  degraded?: boolean;
  labels: {
    placeholder: string;
    empty: string;
    /** Footer hint when the server holds more matches than shown. */
    more: string;
  };
}

export interface ModeSectionSpec extends SectionBase {
  kind: 'mode';
  key: 'mode';
  mode: CorpusSearchMode;
  onModeChange: (mode: CorpusSearchMode) => void;
}

export interface DateRangeSectionSpec extends SectionBase {
  kind: 'dateRange';
  key: 'dates';
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
}

/** Presets get a rail entry; the pane itself is wired by the dialog (it needs
 *  the surface-specific apply/save/delete callbacks). */
export interface PresetsSectionSpec extends SectionBase {
  kind: 'presets';
  key: 'presets';
}

/** Multi-term query rows, each with its own match criteria and boolean role
 *  (يجب / أو / بدون). Empty list = plain single-input search. */
export interface TermsSectionSpec extends SectionBase {
  kind: 'terms';
  key: 'terms';
  terms: SearchTerm[];
  onAdd: (partial?: Partial<Omit<SearchTerm, 'id'>>) => void;
  onUpdate: (id: string, patch: Partial<Omit<SearchTerm, 'id'>>) => void;
  onRemove: (id: string) => void;
}

/** Search scope: all books / the user's uploads / an explicit selected set.
 *  The book multi-select (formerly its own `books` section) nests here as a
 *  ready-made options spec, shown only when scope is `selected`. */
export interface ScopeSectionSpec extends SectionBase {
  kind: 'scope';
  key: 'scope';
  scope: SearchScopeType;
  onScopeChange: (scope: SearchScopeType) => void;
  /** Hide the `mine` choice for viewers who can't own uploads. */
  showMine: boolean;
  books: OptionsSectionSpec;
}

export type SectionSpec =
  | OptionsSectionSpec
  | ModeSectionSpec
  | DateRangeSectionSpec
  | PresetsSectionSpec
  | ScopeSectionSpec
  | TermsSectionSpec;
