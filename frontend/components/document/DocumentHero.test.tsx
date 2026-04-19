import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import DocumentHero from './DocumentHero';
import type { Document } from '@/lib/api';

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

vi.mock('@/lib/i18n/navigation', () => ({
  useLocalizedPath: () => (path: string) => path,
}));

function buildDocument(overrides: Partial<Document> = {}): Document {
  return {
    id: 1,
    title: 'Test Book',
    file: '/files/book.pdf',
    uploaded_at: '2024-01-01T00:00:00Z',
    processed: true,
    processing_status: 'succeeded',
    language: 'en',
    authors: [
      { id: 1, name: 'Author One', photo: null, date_of_birth: null, date_of_death: null },
    ],
    categories: [
      { id: 10, name: 'History' },
    ],
    description: 'A short description of the book.',
    written_date: '1300',
    cover_photo_url: null,
    thumbnail_url: null,
    ...overrides,
  };
}

describe('DocumentHero', () => {
  const noop = () => {};

  it('renders title, authors, and categories', () => {
    render(
      <DocumentHero
        document={buildDocument()}
        currentPage={1}
        totalPages={50}
        isBookmarked={false}
        onStartReading={noop}
        onToggleBookmark={noop}
        onShare={noop}
        onOpenInfo={noop}
      />
    );

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Test Book');
    expect(screen.getByText('Author One')).toBeInTheDocument();
    expect(screen.getByText('History')).toBeInTheDocument();
  });

  it('shows "Continue from page N" when currentPage > 1', () => {
    render(
      <DocumentHero
        document={buildDocument()}
        currentPage={8}
        totalPages={50}
        isBookmarked={false}
        onStartReading={noop}
        onToggleBookmark={noop}
        onShare={noop}
        onOpenInfo={noop}
      />
    );

    expect(screen.getByRole('button', { name: /Continue from page 8/ })).toBeInTheDocument();
  });

  it('shows "Start reading" when currentPage is 1', () => {
    render(
      <DocumentHero
        document={buildDocument()}
        currentPage={1}
        totalPages={50}
        isBookmarked={false}
        onStartReading={noop}
        onToggleBookmark={noop}
        onShare={noop}
        onOpenInfo={noop}
      />
    );

    expect(screen.getByRole('button', { name: /Start reading/ })).toBeInTheDocument();
  });

  it('hides the Start reading CTA when processing_status is not succeeded', () => {
    render(
      <DocumentHero
        document={buildDocument({ processing_status: 'processing', processed: false })}
        currentPage={1}
        totalPages={0}
        isBookmarked={false}
        onStartReading={noop}
        onToggleBookmark={noop}
        onShare={noop}
        onOpenInfo={noop}
      />
    );

    expect(screen.queryByRole('button', { name: /Start reading/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Processing/)).toBeInTheDocument();
  });

  it('toggles the description on "Read more" click', async () => {
    const longDescription =
      'Long book description that must exceed the collapsed threshold. '.repeat(8);

    render(
      <DocumentHero
        document={buildDocument({ description: longDescription })}
        currentPage={1}
        totalPages={50}
        isBookmarked={false}
        onStartReading={noop}
        onToggleBookmark={noop}
        onShare={noop}
        onOpenInfo={noop}
      />
    );

    const toggle = screen.getByRole('button', { name: 'Read more' });
    expect(toggle).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument();
  });
});
