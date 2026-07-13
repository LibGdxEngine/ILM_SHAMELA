import type { CorpusSearchMode } from '@/lib/api';

/** Canonical order + Arabic fallback labels for the corpus search-mode
 *  segmented control. Lives standalone so the console panes and any legacy
 *  facet body share one source of truth. */
export const MODE_ORDER: CorpusSearchMode[] = ['exact', 'semantic', 'hybrid'];
export const MODE_FALLBACK: Record<CorpusSearchMode, string> = {
  exact: 'تام',
  semantic: 'دلالي',
  hybrid: 'مزيج',
};
