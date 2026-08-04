import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import SearchCommandPalette from './SearchCommandPalette';
import { EMPTY_CORPUS_FILTERS, type CorpusFilterHandlers } from '@/lib/search/useCorpusSearchState';

vi.mock('@/components/i18n/I18nProvider', () => ({
  useI18n: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    locale: 'ar',
    direction: 'rtl',
    dictionary: {},
  }),
}));

vi.mock('@/lib/i18n/languageName', () => ({
  useLanguageName: () => (code: string) => `lang:${code}`,
}));

const useMediaQueryMock = vi.fn(() => true);
vi.mock('@/hooks/useMediaQuery', () => ({
  default: (..._args: unknown[]) => useMediaQueryMock(),
}));

const assistSearchMock = vi.fn();
vi.mock('@/lib/api', () => ({
  assistSearch: (...args: unknown[]) => assistSearchMock(...args),
  getSearchSuggestions: vi.fn().mockResolvedValue({ query: '', suggestions: [] }),
}));

vi.mock('@/lib/search/optionSources', () => ({
  fetchCategoryOptions: vi.fn().mockResolvedValue({ count: 0, options: [] }),
  fetchAuthorOptions: vi.fn().mockResolvedValue({ count: 0, options: [] }),
  fetchBookOptions: vi.fn().mockResolvedValue({ count: 0, options: [] }),
  fetchFacetOptions: vi.fn().mockResolvedValue({
    languages: [],
    death_centuries: [],
    countries: [],
    genres: [],
    madhhabs: [],
    era_centuries: [],
    physical_classes: [],
  }),
}));

vi.mock('@/lib/api/extraction', () => ({
  fetchPersonOptions: vi.fn().mockResolvedValue({ count: 0, options: [] }),
  fetchPlaceOptions: vi.fn().mockResolvedValue({ count: 0, options: [] }),
}));

const handlers: CorpusFilterHandlers = {
  setMode: vi.fn(),
  setScope: vi.fn(),
  addTerm: vi.fn(),
  updateTerm: vi.fn(),
  removeTerm: vi.fn(),
  setTerms: vi.fn(),
  toggleCategory: vi.fn(),
  toggleAuthor: vi.fn(),
  toggleBook: vi.fn(),
  toggleLanguage: vi.fn(),
  toggleCountry: vi.fn(),
  toggleDeathCentury: vi.fn(),
  toggleGenre: vi.fn(),
  toggleMadhhab: vi.fn(),
  toggleEraCentury: vi.fn(),
  togglePhysicalClass: vi.fn(),
  togglePerson: vi.fn(),
  togglePlace: vi.fn(),
  setDateFrom: vi.fn(),
  setDateTo: vi.fn(),
  clearAll: vi.fn(),
  applyFilterValues: vi.fn(),
};

function renderPalette(overrides: Partial<Parameters<typeof SearchCommandPalette>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    initialQuery: 'الفقه المقارن',
    filters: EMPTY_CORPUS_FILTERS,
    handlers,
    isAuthenticated: true,
    onAssistApply: vi.fn(),
    onPlainSubmit: vi.fn(),
    ...overrides,
  };
  render(
    <QueryClientProvider client={client}>
      <SearchCommandPalette {...props} />
    </QueryClientProvider>,
  );
  return props;
}

describe('SearchCommandPalette', () => {
  beforeEach(() => {
    assistSearchMock.mockReset();
    useMediaQueryMock.mockReturnValue(true);
  });

  it('falls back to a plain search when the AI is degraded', async () => {
    assistSearchMock.mockResolvedValue({
      filters: {},
      interpretation: null,
      degraded_reason: 'ai_unavailable',
    });
    const props = renderPalette();
    fireEvent.click(screen.getByRole('button', { name: 'ابحث بالذكاء الاصطناعي' }));
    await waitFor(() => {
      expect(props.onPlainSubmit).toHaveBeenCalledWith('الفقه المقارن');
      expect(props.onAssistApply).not.toHaveBeenCalled();
      expect(props.onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('applies AI filters on success', async () => {
    const aiFilters = { q: 'x', mode: 'hybrid', authors: [], categories: [], languages: [], dateFrom: null, dateTo: null };
    assistSearchMock.mockResolvedValue({ filters: aiFilters, interpretation: 'تفسير' });
    const props = renderPalette();
    fireEvent.click(screen.getByRole('button', { name: 'ابحث بالذكاء الاصطناعي' }));
    await waitFor(() => {
      expect(props.onAssistApply).toHaveBeenCalledWith(aiFilters, 'تفسير');
    });
  });

  it('plain submit forwards the draft and closes', () => {
    const props = renderPalette();
    fireEvent.click(screen.getByRole('button', { name: 'بحث' }));
    expect(props.onPlainSubmit).toHaveBeenCalledWith('الفقه المقارن');
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes on Escape unless an inner consumer claimed it', async () => {
    const props = renderPalette();
    const claimed = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    claimed.preventDefault();
    document.dispatchEvent(claimed);
    const plain = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    document.dispatchEvent(plain);
    await waitFor(() => {
      expect(props.onOpenChange).toHaveBeenCalledTimes(1);
      expect(props.onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('renders the accordion presentation on mobile', () => {
    useMediaQueryMock.mockReturnValue(false);
    renderPalette();
    // Accordion section headers expose aria-expanded (rail tabs do not exist).
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /نوع البحث/ })[0]).toHaveAttribute('aria-expanded');
  });

  it('shows the sign-in gate for anonymous users', () => {
    renderPalette({ isAuthenticated: false });
    expect(screen.getByText(/سجّل الدخول للتصفية/)).toBeInTheDocument();
    expect(screen.queryByText('المرشحات المحفوظة')).not.toBeInTheDocument();
  });
});
