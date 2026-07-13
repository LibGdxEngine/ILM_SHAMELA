import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import OptionListPane from './OptionListPane';
import type { OptionsSectionSpec } from './types';

vi.mock('@/components/i18n/I18nProvider', () => ({
  useI18n: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    locale: 'en',
    direction: 'ltr',
    dictionary: {},
  }),
}));

function renderPane(section: OptionsSectionSpec) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OptionListPane section={section} />
    </QueryClientProvider>,
  );
}

function staticSection(overrides: Partial<OptionsSectionSpec> = {}): OptionsSectionSpec {
  return {
    kind: 'options',
    key: 'languages',
    label: 'Languages',
    badge: 1,
    source: {
      type: 'static',
      options: [
        { id: 'ar', label: 'Arabic', count: 10 },
        { id: 'en', label: 'English', count: 3 },
        { id: 'fa', label: 'Persian', count: 1 },
      ],
    },
    selected: [{ id: 'en', label: 'English' }],
    onToggle: vi.fn(),
    labels: { placeholder: 'search…', empty: 'no matches', more: '' },
    ...overrides,
  };
}

describe('OptionListPane (static source)', () => {
  it('pins selected options on top of the browsable list', () => {
    renderPane(staticSection());
    const options = screen.getAllByRole('option');
    // Selected 'English' first, then the unselected remainder (Arabic, Persian).
    expect(options[0]).toHaveTextContent('English');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(options).toHaveLength(3);
    expect(options[1]).toHaveAttribute('aria-selected', 'false');
  });

  it('renders counts and toggles on click', () => {
    const onToggle = vi.fn();
    renderPane(staticSection({ onToggle }));
    expect(screen.getByText('10')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: /Arabic/ }));
    expect(onToggle).toHaveBeenCalledWith({ id: 'ar', label: 'Arabic', count: 10 });
  });

  it('toggles the active row via ArrowDown + Enter', () => {
    const onToggle = vi.fn();
    renderPane(staticSection({ onToggle }));
    const input = screen.getByRole('combobox');
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // → English (selected row)
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // → Arabic
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onToggle).toHaveBeenCalledWith({ id: 'ar', label: 'Arabic', count: 10 });
  });

  it('narrows client-side while keeping selections visible', () => {
    renderPane(staticSection());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'pers' } });
    const options = screen.getAllByRole('option');
    // English stays (selected/pinned) even though it doesn't match 'pers'.
    expect(options.map((o) => o.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('English'), expect.stringContaining('Persian')]),
    );
    expect(options).toHaveLength(2);
  });

  it('shows the degraded note when options failed to load but selections exist', () => {
    renderPane(
      staticSection({
        degraded: true,
        source: { type: 'static', options: [] },
      }),
    );
    expect(screen.getByText(/تعذّر تحميل الخيارات/)).toBeInTheDocument();
    // The selection is still removable.
    expect(screen.getByRole('option', { name: /English/ })).toBeInTheDocument();
  });
});

describe('OptionListPane (search source)', () => {
  it('fetches from the server and hints when more matches exist', async () => {
    const fetchOptions = vi.fn().mockResolvedValue({
      count: 40,
      options: [
        { id: 1, label: 'ابن تيمية' },
        { id: 2, label: 'ابن القيم' },
      ],
    });
    renderPane(
      staticSection({
        key: 'authors',
        label: 'Authors',
        source: { type: 'search', cacheKey: 'test-authors', fetchOptions },
        selected: [],
        labels: { placeholder: 'search…', empty: 'no matches', more: 'type to narrow' },
      }),
    );
    expect(await screen.findByRole('option', { name: /ابن تيمية/ })).toBeInTheDocument();
    expect(fetchOptions).toHaveBeenCalledWith('');
    expect(screen.getByText('type to narrow')).toBeInTheDocument();
  });
});
