import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import DocumentPage from './DocumentPage';
import type { ApiHighlight } from '@/lib/api/reader';

vi.mock('@/components/i18n/I18nProvider', () => ({
  useI18n: () => ({
    t: (_key: string, fallback?: string, values?: Record<string, unknown>) => {
      if (!fallback) return _key;
      if (!values) return fallback;
      return fallback.replace(/\{(\w+)\}/g, (_: string, token: string) =>
        values[token] === undefined ? `{${token}}` : String(values[token])
      );
    },
    locale: 'ar',
    direction: 'rtl',
    dictionary: {},
  }),
}));

const CONTENT = 'فضل العلم ثم العلوم النافعة';

describe('DocumentPage search-token marks', () => {
  it('marks the searched token gold (rr-tok-exact) and near tokens lighter (rr-tok-near)', () => {
    const { container } = render(
      <DocumentPage pageNumber={1} content={CONTENT} searchQuery="العلم" language="ar" />
    );
    const exact = container.querySelector('mark.rr-tok-exact');
    const near = container.querySelector('mark.rr-tok-near');
    expect(exact?.textContent).toBe('العلم');
    expect(near?.textContent).toBe('العلوم');
  });

  it('renders no search marks without a query', () => {
    const { container } = render(
      <DocumentPage pageNumber={1} content={CONTENT} searchQuery="" language="ar" />
    );
    expect(container.querySelector('mark')).toBeNull();
  });

  it('keeps user highlights (mark[data-hid]) alongside search marks', () => {
    const highlight: ApiHighlight = {
      id: 11,
      document: 1,
      page_number: 1,
      paragraph_id: '',
      char_start: CONTENT.indexOf('النافعة'),
      char_end: CONTENT.indexOf('النافعة') + 'النافعة'.length,
      color: 'green',
      note: '',
      created_at: '2026-01-01T00:00:00Z',
    };
    const { container } = render(
      <DocumentPage
        pageNumber={1}
        content={CONTENT}
        searchQuery="العلم"
        language="ar"
        highlights={[highlight]}
      />
    );
    const userMark = container.querySelector('mark[data-hid="11"]');
    expect(userMark).not.toBeNull();
    expect(userMark).toHaveClass('highlight-green');
    expect(container.querySelector('mark.rr-tok-exact')).not.toBeNull();
  });
});
