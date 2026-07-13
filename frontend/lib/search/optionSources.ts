// Adapters turning the existing list/typeahead endpoints into the console's
// `OptionSource` fetch shapes ({count, options: {id, label, count?}[]}).

import { getAuthors, getCategories, getDocuments } from '@/lib/api';
import { getFacetOptions, type FacetOptionsResponse } from '@/lib/api/facetOptions';
import type { OptionSearchPage } from '@/components/search/console/types';

// --- Paginated server-search sources (authors / categories / books) --------

export async function fetchCategoryOptions(search: string): Promise<OptionSearchPage> {
  const res = await getCategories(search || undefined);
  return {
    count: res.count,
    options: res.results.map((c) => ({ id: c.name, label: c.name })),
  };
}

export async function fetchAuthorOptions(search: string): Promise<OptionSearchPage> {
  const res = await getAuthors(search || undefined);
  return {
    count: res.count,
    options: res.results.map((a) => ({ id: a.name, label: a.name })),
  };
}

/** Books select by numeric document id with the title as label, so the
 *  console needs no title→id resolution bridge. */
export async function fetchBookOptions(search: string): Promise<OptionSearchPage> {
  const res = await getDocuments(search ? { search } : {});
  return {
    count: res.count,
    options: res.results.map((d) => ({ id: d.id, label: d.title })),
  };
}

// --- Static sources (combined facet-options endpoint) ----------------------

/** Raw facet-options payload (languages + countries + death centuries with
 *  counts); labeling (language names / century wording) happens in
 *  `useSearchSections` where i18n hooks are available. */
export async function fetchFacetOptions(): Promise<FacetOptionsResponse> {
  return getFacetOptions();
}
