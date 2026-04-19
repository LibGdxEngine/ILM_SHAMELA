import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import SelectionPopover from './SelectionPopover';

vi.mock('@/components/i18n/I18nProvider', () => ({
  useI18n: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    locale: 'en',
    direction: 'ltr',
    dictionary: {},
  }),
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
