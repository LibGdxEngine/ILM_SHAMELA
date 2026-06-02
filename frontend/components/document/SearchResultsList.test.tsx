import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';

import SearchResultsList from './SearchResultsList';
import SearchFindBar from './SearchFindBar';
import type { DocumentSearchMatch, DocumentSearchResponse } from '@/lib/api';

vi.mock('@/components/i18n/I18nProvider', () => ({
  useI18n: () => ({
    t: (_key: string, fallback?: string, values?: Record<string, unknown>) => {
      if (!fallback) return _key;
      if (!values) return fallback;
      return fallback.replace(/\{(\w+)\}/g, (_: string, token: string) =>
        values[token] === undefined ? `{${token}}` : String(values[token])
      );
    },
    locale: 'en',
    direction: 'ltr',
    dictionary: {},
  }),
}));

function makeMatch(page: number, snippet: string): DocumentSearchMatch {
  return {
    page_number: page,
    snippet,
  };
}

describe('SearchResultsList', () => {
  it('calls onActivate with the correct page when clicked', async () => {
    const onActivate = vi.fn();
    const results = [makeMatch(1, 'one'), makeMatch(2, 'two')];

    render(
      <SearchResultsList results={results} activeIndex={0} onActivate={onActivate} />
    );

    const user = userEvent.setup();
    await user.click(screen.getByText('two'));
    expect(onActivate).toHaveBeenCalledWith(2, 1);
  });

  it('marks the active option with aria-selected', () => {
    const results = [makeMatch(5, 'first hit'), makeMatch(9, 'second hit')];

    render(
      <SearchResultsList results={results} activeIndex={1} onActivate={vi.fn()} />
    );

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveAttribute('aria-selected', 'false');
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
  });
});

// Harness around SearchFindBar that gives us keyboard navigation verification.
function SearchHarness({
  matches,
  onGoToPage,
}: {
  matches: DocumentSearchMatch[];
  onGoToPage: (page: number) => void;
}) {
  const [query, setQuery] = useState('test');
  const response: DocumentSearchResponse = {
    matches,
    total_matches: matches.length,
    query,
  };
  return (
    <SearchFindBar
      query={query}
      isSearching={false}
      searchResults={response}
      onQueryChange={setQuery}
      onGoToPage={onGoToPage}
      onClose={() => {}}
    />
  );
}

describe('SearchFindBar keyboard navigation', () => {
  it('ArrowDown moves active index and Enter fires onGoToPage with the right page', async () => {
    const onGoToPage = vi.fn();
    const matches = [makeMatch(1, 'alpha'), makeMatch(4, 'beta'), makeMatch(7, 'gamma')];

    render(<SearchHarness matches={matches} onGoToPage={onGoToPage} />);

    const input = screen.getByRole('textbox') as HTMLInputElement;
    input.focus();

    const user = userEvent.setup();
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');
    expect(onGoToPage).toHaveBeenCalledWith(4);
  });

  it('ArrowUp clamps at zero', async () => {
    const onGoToPage = vi.fn();
    const matches = [makeMatch(2, 'alpha'), makeMatch(8, 'beta')];

    render(<SearchHarness matches={matches} onGoToPage={onGoToPage} />);

    const input = screen.getByRole('textbox') as HTMLInputElement;
    input.focus();

    const user = userEvent.setup();
    await user.keyboard('{ArrowUp}');
    await user.keyboard('{Enter}');
    expect(onGoToPage).toHaveBeenCalledWith(2);
  });
});
