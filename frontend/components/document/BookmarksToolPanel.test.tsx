import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import BookmarksToolPanel from './BookmarksToolPanel';
import type { Bookmark } from './readerToolsTypes';

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

describe('BookmarksToolPanel', () => {
  const noop = () => {};

  it('renders empty state when there are no bookmarks', () => {
    render(
      <BookmarksToolPanel
        bookmarks={[]}
        currentPage={5}
        selectedTags={[]}
        onSelectedTagsChange={noop}
        onToggleCurrentBookmark={noop}
        onRemoveBookmark={noop}
        onGoToPage={noop}
      />
    );

    expect(screen.getByText('No saved pages')).toBeInTheDocument();
  });

  it('renders the current page number and a bookmark entry', () => {
    const bookmarks: Bookmark[] = [
      { id: 1, page: 12, createdAt: Date.now(), tags: [], label: '' },
    ];

    render(
      <BookmarksToolPanel
        bookmarks={bookmarks}
        currentPage={7}
        selectedTags={[]}
        onSelectedTagsChange={noop}
        onToggleCurrentBookmark={noop}
        onRemoveBookmark={noop}
        onGoToPage={noop}
      />
    );

    expect(screen.getByText('Page 7')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Page 12')).toBeInTheDocument();
  });

  it('calls onToggleCurrentBookmark when the toggle button is clicked', async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();

    render(
      <BookmarksToolPanel
        bookmarks={[]}
        currentPage={3}
        selectedTags={[]}
        onSelectedTagsChange={noop}
        onToggleCurrentBookmark={onToggle}
        onRemoveBookmark={noop}
        onGoToPage={noop}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Bookmarks' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
