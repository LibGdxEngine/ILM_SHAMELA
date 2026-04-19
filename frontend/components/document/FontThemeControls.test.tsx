import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import FontThemeControls from './FontThemeControls';

vi.mock('@/components/i18n/I18nProvider', () => ({
  useI18n: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    locale: 'en',
    direction: 'ltr',
    dictionary: {},
  }),
}));

describe('FontThemeControls', () => {
  const noop = () => {};

  it('renders three font size and three theme options', () => {
    render(
      <FontThemeControls
        fontSize="medium"
        theme="light"
        onFontSizeChange={noop}
        onThemeChange={noop}
      />
    );

    expect(screen.getByRole('button', { name: 'Small' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Medium' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Large' })).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Light' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sepia' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dark' })).toBeInTheDocument();
  });

  it('calls onFontSizeChange("medium") when the medium button is clicked', async () => {
    const onFontSizeChange = vi.fn();
    const user = userEvent.setup();

    render(
      <FontThemeControls
        fontSize="small"
        theme="light"
        onFontSizeChange={onFontSizeChange}
        onThemeChange={noop}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Medium' }));
    expect(onFontSizeChange).toHaveBeenCalledWith('medium');
  });

  it('shows the tashkeel toggle only when language is "ar"', () => {
    const { rerender } = render(
      <FontThemeControls
        fontSize="medium"
        theme="light"
        onFontSizeChange={noop}
        onThemeChange={noop}
        tashkeelEnabled
        onTashkeelChange={noop}
        language="en"
      />
    );

    expect(screen.queryByLabelText('Diacritics')).not.toBeInTheDocument();

    rerender(
      <FontThemeControls
        fontSize="medium"
        theme="light"
        onFontSizeChange={noop}
        onThemeChange={noop}
        tashkeelEnabled
        onTashkeelChange={noop}
        language="ar"
      />
    );

    expect(screen.getByLabelText('Diacritics')).toBeInTheDocument();
  });
});
