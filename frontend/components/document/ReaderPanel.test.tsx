import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ReaderPanel from './ReaderPanel';

vi.mock('@/components/i18n/I18nProvider', () => ({
  useI18n: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    locale: 'en',
    direction: 'ltr',
    dictionary: {},
  }),
}));

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

describe('ReaderPanel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders as a bottom sheet on mobile and closes on backdrop click', async () => {
    mockMatchMedia(false);
    const onClose = vi.fn();

    render(
      <ReaderPanel isOpen={true} onClose={onClose} title="Mobile Sheet">
        <p>panel content</p>
      </ReaderPanel>
    );

    const backdrop = await screen.findByTestId('reader-panel-backdrop');
    expect(screen.getByText('panel content')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('delegates to ReaderPopover on desktop (no sheet backdrop)', () => {
    mockMatchMedia(true);

    render(
      <ReaderPanel isOpen={true} onClose={() => {}} title="Desktop">
        <p>desktop content</p>
      </ReaderPanel>
    );

    expect(screen.getByText('desktop content')).toBeInTheDocument();
    expect(screen.queryByTestId('reader-panel-backdrop')).not.toBeInTheDocument();
  });

  it('renders nothing when isOpen is false on mobile', () => {
    mockMatchMedia(false);

    const { container } = render(
      <ReaderPanel isOpen={false} onClose={() => {}} title="Hidden">
        <p>hidden content</p>
      </ReaderPanel>
    );

    expect(container).toBeEmptyDOMElement();
  });
});
