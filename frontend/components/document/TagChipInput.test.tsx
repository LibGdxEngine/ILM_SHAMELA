import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import TagChipInput from './TagChipInput';

vi.mock('@/components/i18n/I18nProvider', () => ({
  useI18n: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    locale: 'en',
    direction: 'ltr',
    dictionary: {},
  }),
}));

describe('TagChipInput', () => {
  it('adds a tag when Enter is pressed', async () => {
    const onChange = vi.fn();
    render(<TagChipInput value={[]} onChange={onChange} />);

    const input = screen.getByPlaceholderText('Add tag and press Enter');
    const user = userEvent.setup();
    await user.type(input, 'history{Enter}');
    expect(onChange).toHaveBeenLastCalledWith(['history']);
  });

  it('removes a tag when its remove button is clicked', async () => {
    const onChange = vi.fn();
    render(<TagChipInput value={['fiqh', 'history']} onChange={onChange} />);

    const removeButtons = screen.getAllByRole('button', { name: /Remove tag/i });
    const user = userEvent.setup();
    await user.click(removeButtons[0]);
    expect(onChange).toHaveBeenCalledWith(['history']);
  });

  it('dedupes case-insensitively', async () => {
    const onChange = vi.fn();
    render(<TagChipInput value={['fiqh']} onChange={onChange} />);

    const input = screen.getByPlaceholderText('Add tag and press Enter');
    const user = userEvent.setup();
    await user.type(input, 'FIQH{Enter}');
    // The lowercase normalization makes 'FIQH' equal to 'fiqh' which already exists,
    // so onChange should not be called for an add.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('removes the last tag on Backspace when input is empty', async () => {
    const onChange = vi.fn();
    render(<TagChipInput value={['fiqh', 'history']} onChange={onChange} />);

    const input = screen.getByPlaceholderText('Add tag and press Enter');
    const user = userEvent.setup();
    await user.click(input);
    await user.keyboard('{Backspace}');
    expect(onChange).toHaveBeenCalledWith(['fiqh']);
  });
});
