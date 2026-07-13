import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import AdvancedSearchPanel from './AdvancedSearchPanel';
import type { Document, DocumentSearchResponse, DocumentsListResponse } from '@/lib/api';

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

const RESULTS: DocumentSearchResponse = {
  query: 'العلم',
  total_matches: 3,
  mode: 'all',
  has_semantic: true,
  matches: [
    { page_number: 4, snippet: 'فضل <mark>العلم</mark>', match_kind: 'exact', score_lexical: 1, score_semantic: 0.6, score_final: 0.84 },
    { page_number: 9, snippet: 'من <mark>العلوم</mark>', match_kind: 'lexical', score_lexical: 0.5, score_semantic: 0.4, score_final: 0.46 },
    { page_number: 15, snippet: 'المعرفة النافعة', match_kind: 'semantic', score_lexical: 0, score_semantic: 0.57, score_final: 0.23 },
  ],
};

const LIBRARY_RESULTS = {
  count: 1,
  next: null,
  previous: null,
  results: [
    {
      id: 7,
      title: 'المنقذ من الضلال',
      authors: [{ id: 1, name: 'الغزالي', photo: null, date_of_birth: null, date_of_death: null }],
      snippet: 'نور يقذفه <mark>الله</mark>',
      score_final: 0.8,
    } as unknown as Document,
  ],
} as DocumentsListResponse;

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    query: 'العلم',
    scope: 'book' as const,
    tab: 'all' as const,
    sort: 'relevance' as const,
    threshold: 0.5,
    ignoreDiacritics: true,
    results: RESULTS,
    libraryResults: null,
    isSearching: false,
    error: null,
    suggestions: ['اليقين'],
    recentTerms: ['تزكية النفس'],
    pinnedTerms: ['العلم النافع'],
    bookTitle: 'إحياء علوم الدين',
    savedKeys: new Set<string>(),
    onQueryChange: vi.fn(),
    onCommitQuery: vi.fn(),
    onScopeChange: vi.fn(),
    onTabChange: vi.fn(),
    onSortChange: vi.fn(),
    onThresholdChange: vi.fn(),
    onDiacriticsChange: vi.fn(),
    onClear: vi.fn(),
    onGoToPage: vi.fn(),
    onOpenLibraryResult: vi.fn(),
    onPinTerm: vi.fn(),
    onToggleSaveResult: vi.fn(),
    onToast: vi.fn(),
    chapterTitleForPage: () => 'كتاب العلم',
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AdvancedSearchPanel — scope & tabs', () => {
  it('always renders the scope control and switches scope', async () => {
    const props = makeProps();
    render(<AdvancedSearchPanel {...props} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'كلّ المكتبة' }));
    expect(props.onScopeChange).toHaveBeenCalledWith('library');
  });

  it('shows kind tabs with counts for an active book-scope query', async () => {
    const props = makeProps();
    render(<AdvancedSearchPanel {...props} />);
    const tablist = screen.getByRole('tablist');
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs).toHaveLength(4);
    // Counts: all=3, exact=1, lexical=1, semantic=1.
    expect(tabs[0]).toHaveTextContent('3');
    const user = userEvent.setup();
    await user.click(within(tablist).getByRole('tab', { name: /لفظي/ }));
    expect(props.onTabChange).toHaveBeenCalledWith('lexical');
  });

  it('hides kind tabs when the query is empty and in library scope', () => {
    const { rerender } = render(<AdvancedSearchPanel {...makeProps({ query: '' })} />);
    expect(screen.queryByRole('tablist')).toBeNull();
    rerender(<AdvancedSearchPanel {...makeProps({ scope: 'library', libraryResults: LIBRARY_RESULTS })} />);
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('filters result cards by the active tab', () => {
    render(<AdvancedSearchPanel {...makeProps({ tab: 'semantic' })} />);
    expect(screen.getByText('المعرفة النافعة')).toBeInTheDocument();
    expect(screen.queryByText(/فضل/)).toBeNull();
  });
});

describe('AdvancedSearchPanel — options accordion', () => {
  it('shows a collapsed summary and expands to the controls', async () => {
    const props = makeProps();
    render(<AdvancedSearchPanel {...props} />);
    const user = userEvent.setup();
    const toggle = screen.getByRole('button', { name: /خيارات الباحث/ });
    expect(toggle).toHaveTextContent('عتبة');
    await user.click(toggle);

    const slider = screen.getByRole('slider');
    expect(slider).toHaveValue('0.5');

    await user.click(screen.getByRole('switch'));
    expect(props.onDiacriticsChange).toHaveBeenCalledWith(false);

    await user.click(screen.getByRole('button', { name: 'ترتيب الصفحات' }));
    expect(props.onSortChange).toHaveBeenCalledWith('page');
  });
});

describe('AdvancedSearchPanel — empty & no-hits states', () => {
  it('renders recents, pinned and suggestion chips and picks a term', async () => {
    const props = makeProps({ query: '', results: null });
    render(<AdvancedSearchPanel {...props} />);
    expect(screen.getByText('عمليات بحث أخيرة')).toBeInTheDocument();
    expect(screen.getByText('مصطلحات مثبَّتة')).toBeInTheDocument();
    expect(screen.getByText('كلمات من هذا الفصل')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'تزكية النفس' }));
    expect(props.onQueryChange).toHaveBeenCalledWith('تزكية النفس');
    expect(props.onCommitQuery).toHaveBeenCalledWith('تزكية النفس');
  });

  it('shows the widen-to-library CTA on book-scope no-hits only', async () => {
    const empty: DocumentSearchResponse = { query: 'س', total_matches: 0, matches: [], mode: 'all' };
    const props = makeProps({ query: 'س', results: empty });
    const { rerender } = render(<AdvancedSearchPanel {...props} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /البحث في كلّ المكتبة/ }));
    expect(props.onScopeChange).toHaveBeenCalledWith('library');

    rerender(
      <AdvancedSearchPanel
        {...makeProps({
          query: 'س',
          scope: 'library',
          libraryResults: { count: 0, next: null, previous: null, results: [] },
        })}
      />
    );
    expect(screen.queryByText(/البحث في كلّ المكتبة/)).toBeNull();
    expect(screen.getByText('لا نتائج في هذا النطاق')).toBeInTheDocument();
  });
});

describe('AdvancedSearchPanel — results header & cards', () => {
  it('pins the current term from the results header', async () => {
    const props = makeProps();
    render(<AdvancedSearchPanel {...props} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'تثبيت المصطلح' }));
    expect(props.onPinTerm).toHaveBeenCalledWith('العلم');
    expect(props.onToast).toHaveBeenCalled();
  });

  it('exports the visible results as a CSV download', async () => {
    const props = makeProps();
    const createUrl = vi.fn(() => 'blob:x');
    vi.stubGlobal('URL', { ...URL, createObjectURL: createUrl, revokeObjectURL: vi.fn() });
    render(<AdvancedSearchPanel {...props} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'تصدير النتائج' }));
    expect(createUrl).toHaveBeenCalled();
    expect(props.onToast).toHaveBeenCalledWith(expect.stringContaining('CSV'));
    vi.unstubAllGlobals();
  });

  it('jumps, copies a citation and toggles save from a result card', async () => {
    const props = makeProps();
    render(<AdvancedSearchPanel {...props} />);
    const user = userEvent.setup();
    // After setup(): user-event installs its own clipboard stub during setup,
    // which would swallow the component's writeText call.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    await user.click(screen.getByRole('button', { name: 'الانتقال إلى ص 4' }));
    expect(props.onGoToPage).toHaveBeenCalledWith(4);

    await user.click(screen.getAllByRole('button', { name: 'نسخ مع الإحالة' })[0]);
    expect(writeText).toHaveBeenCalledWith('«فضل العلم» — إحياء علوم الدين، كتاب العلم، ص 4.');

    await user.click(screen.getAllByRole('button', { name: 'حفظ' })[0]);
    expect(props.onToggleSaveResult).toHaveBeenCalled();
  });

  it('marks saved results as محفوظ', () => {
    render(
      <AdvancedSearchPanel
        {...makeProps({ savedKeys: new Set(['4:exact:فضل <mark>العلم</mark>']) })}
      />
    );
    expect(screen.getByRole('button', { name: 'محفوظ' })).toBeInTheDocument();
  });
});

describe('AdvancedSearchPanel — library scope', () => {
  it('renders library cards and opens a book', async () => {
    const props = makeProps({ scope: 'library', libraryResults: LIBRARY_RESULTS });
    render(<AdvancedSearchPanel {...props} />);
    expect(screen.getByText('المنقذ من الضلال')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'فتح الكتاب' }));
    expect(props.onOpenLibraryResult).toHaveBeenCalledWith(7);
  });
});
