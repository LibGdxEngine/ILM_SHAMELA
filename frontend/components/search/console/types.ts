import type { CorpusSearchMode } from '@/lib/api';

/** A book selected as a search scope. Canonical home of the type (moved from
 *  `SearchFacetControls`; `NavSearchPopover` re-exports it for old importers). */
export interface SelectedBook {
  id: number;
  title: string;
}

export type FilterSectionKey =
  | 'presets'
  | 'mode'
  | 'categories'
  | 'authors'
  | 'books'
  | 'languages'
  | 'countries'
  | 'deathCenturies'
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

export type SectionSpec =
  | OptionsSectionSpec
  | ModeSectionSpec
  | DateRangeSectionSpec
  | PresetsSectionSpec;
