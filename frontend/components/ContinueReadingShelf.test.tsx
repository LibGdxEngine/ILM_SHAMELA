import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ContinueReadingShelf from './ContinueReadingShelf';

vi.mock('@/components/i18n/I18nProvider', () => ({
  useI18n: () => ({
    t: (_key: string, fallback?: string, values?: Record<string, unknown>) => {
      const text = fallback ?? _key;
      if (!values) return text;
      return text.replace(/\{(\w+)\}/g, (_: string, token: string) =>
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

const useAuthMock = vi.fn();
const useContinueReadingMock = vi.fn();

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('@/lib/reader/useContinueReading', () => ({
  useContinueReading: () => useContinueReadingMock(),
}));

describe('ContinueReadingShelf', () => {
  afterEach(() => {
    useAuthMock.mockReset();
    useContinueReadingMock.mockReset();
  });

  it('returns null when not authenticated', () => {
    useAuthMock.mockReturnValue({ isAuthenticated: false, isLoading: false });
    useContinueReadingMock.mockReturnValue({ data: undefined, isLoading: false });
    const { container } = render(<ContinueReadingShelf />);
    expect(container).toBeEmptyDOMElement();
  });

  it('returns null when authenticated but data is empty', () => {
    useAuthMock.mockReturnValue({ isAuthenticated: true, isLoading: false });
    useContinueReadingMock.mockReturnValue({ data: [], isLoading: false });
    const { container } = render(<ContinueReadingShelf />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders cards when authenticated with data', () => {
    useAuthMock.mockReturnValue({ isAuthenticated: true, isLoading: false });
    useContinueReadingMock.mockReturnValue({
      data: [
        {
          id: 1,
          document: 42,
          last_page: 30,
          last_paragraph_id: '',
          scroll_ratio: 0,
          percent_complete: 0.6,
          updated_at: '2024-01-01T00:00:00Z',
          document_title: 'Muqaddimah',
          cover_photo_url: null,
          thumbnail_url: null,
          total_pages: 50,
        },
      ],
      isLoading: false,
    });
    render(<ContinueReadingShelf />);
    expect(screen.getByText('Continue reading')).toBeInTheDocument();
    // Title appears twice (cover overlay + label below); both must reference Muqaddimah.
    expect(screen.getAllByText('Muqaddimah').length).toBeGreaterThan(0);
    expect(screen.getByText(/60% read/)).toBeInTheDocument();
    expect(screen.getByText(/Page 30 of 50/)).toBeInTheDocument();
  });
});
