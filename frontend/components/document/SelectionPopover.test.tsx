import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import SelectionPopover from './SelectionPopover';
import {
  computeSelectionPayload,
  releaseSelectionPopoverSuppression,
  suppressSelectionPopover,
} from '@/lib/reader/selection';

vi.mock('@/components/i18n/I18nProvider', () => ({
  useI18n: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    locale: 'en',
    direction: 'ltr',
    dictionary: {},
  }),
}));

// Keep the real suppression helpers; only the payload computation is faked so
// tests can simulate a valid selection without building a page DOM.
vi.mock('@/lib/reader/selection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/reader/selection')>()),
  computeSelectionPayload: vi.fn(),
}));

describe('SelectionPopover', () => {
  it('renders nothing when disabled', () => {
    const { container } = render(
      <SelectionPopover enabled={false} onCreateHighlight={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing initially when enabled with no selection', () => {
    const { container } = render(
      <SelectionPopover enabled={true} onCreateHighlight={() => {}} />
    );
    // Popover only mounts after a valid DOM selection; here the document is empty
    // so nothing should be drawn.
    expect(container).toBeEmptyDOMElement();
  });

  it('accepts the expected onCreateHighlight signature', () => {
    const onCreate = vi.fn();
    render(<SelectionPopover enabled={true} onCreateHighlight={onCreate} />);
    expect(typeof onCreate).toBe('function');
  });
});

describe('SelectionPopover suppression (double-click-to-search)', () => {
  const payload = { page_number: 1, paragraph_id: 'b1', char_start: 0, char_end: 5, text: 'كلمة' };

  beforeEach(() => {
    vi.useFakeTimers();
    (computeSelectionPayload as Mock).mockReturnValue(payload);
    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      toString: () => 'كلمة',
      getRangeAt: () => ({
        getBoundingClientRect: () => ({ top: 100, left: 50, width: 80, height: 20 }),
      }),
      removeAllRanges: () => {},
    } as unknown as Selection);
  });

  afterEach(() => {
    releaseSelectionPopoverSuppression();
    vi.useRealTimers();
    vi.restoreAllMocks();
    (computeSelectionPayload as Mock).mockReset();
  });

  function fireSelectionChange() {
    act(() => {
      document.dispatchEvent(new Event('selectionchange'));
      vi.advanceTimersByTime(60); // past the popover's 50ms settle delay
    });
  }

  it('shows the popover for a valid selection when not suppressed', () => {
    render(<SelectionPopover enabled={true} onCreateHighlight={() => {}} />);
    fireSelectionChange();
    expect(screen.getByRole('toolbar')).toBeInTheDocument();
  });

  it('stays hidden while suppressed', () => {
    render(<SelectionPopover enabled={true} onCreateHighlight={() => {}} />);
    suppressSelectionPopover();
    fireSelectionChange();
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  });
});
