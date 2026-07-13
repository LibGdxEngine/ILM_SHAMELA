'use client';

import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import useDebounce from '@/hooks/useDebounce';
import type { OptionItem, OptionSearchPage } from './types';

export interface OptionSearchState {
  query: string;
  setQuery: (value: string) => void;
  options: OptionItem[];
  count: number;
  isFetching: boolean;
  /** The server holds more matches than returned — "type to narrow". */
  hasMore: boolean;
}

/**
 * The server-backed option-search mechanics shared by `FacetTypeahead` (the
 * sidebar combobox) and the console's `OptionListPane`: 300ms-debounced query
 * against `fetchOptions` (empty string = first page), cached per
 * `[cacheKey, 'search', query]` with `keepPreviousData` so results never
 * flicker between keystrokes. Fetches only while `enabled`.
 */
export default function useOptionSearch(
  cacheKey: string,
  fetchOptions: (search: string) => Promise<OptionSearchPage>,
  enabled: boolean,
): OptionSearchState {
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query.trim(), 300);

  const { data, isFetching } = useQuery<OptionSearchPage, Error>({
    queryKey: [cacheKey, 'search', debounced],
    queryFn: () => fetchOptions(debounced),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    enabled,
  });

  const options = data?.options ?? [];
  const count = data?.count ?? 0;

  return {
    query,
    setQuery,
    options,
    count,
    isFetching,
    hasMore: count > options.length,
  };
}
