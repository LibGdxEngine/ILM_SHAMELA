'use client';

import { useI18n } from '@/components/i18n/I18nProvider';
import FacetTypeahead from '@/components/documents/FacetTypeahead';
import { getAuthors, getCategories } from '@/lib/api';
import type { CorpusSearchMode } from '@/lib/api';
import useBooksFacetSource from '@/hooks/useBooksFacetSource';

export interface SelectedBook {
  id: number;
  title: string;
}

export const MODE_ORDER: CorpusSearchMode[] = ['exact', 'semantic', 'hybrid'];
export const MODE_FALLBACK: Record<CorpusSearchMode, string> = {
  exact: 'تام',
  semantic: 'دلالي',
  hybrid: 'مزيج',
};

export interface SearchFacetControlsProps {
  mode: CorpusSearchMode;
  onModeChange: (mode: CorpusSearchMode) => void;
  selectedCategories: string[];
  onToggleCategory: (name: string) => void;
  selectedAuthors: string[];
  onToggleAuthor: (name: string) => void;
  selectedBooks: SelectedBook[];
  onToggleBook: (book: SelectedBook) => void;
  isAuthenticated: boolean;
}

/**
 * The search-mode segmented control + discipline / author / book facet
 * typeaheads, shared by `NavSearchPopover` (navbar/landing/map/reader) and the
 * `/documents` `SearchCommandPalette` so the two never drift. Themes entirely
 * from the ambient `--shell-*`/`--accent` CSS variables (with gold/parchment
 * fallbacks); the caller owns the surrounding surface and its own submit
 * control. Renders a sign-in hint instead of the facets when signed out.
 */
export default function SearchFacetControls({
  mode,
  onModeChange,
  selectedCategories,
  onToggleCategory,
  selectedAuthors,
  onToggleAuthor,
  selectedBooks,
  onToggleBook,
  isAuthenticated,
}: SearchFacetControlsProps) {
  const { t } = useI18n();
  const books = useBooksFacetSource();

  // Bridge FacetTypeahead's name-based selection to the {id, title} book model.
  const selectedBookTitles = selectedBooks.map((b) => b.title);
  const handleToggleBook = (title: string) => {
    const existing = selectedBooks.find((b) => b.title === title);
    if (existing) {
      onToggleBook(existing);
      return;
    }
    const id = books.resolveId(title);
    if (id != null) onToggleBook({ id, title });
  };

  if (!isAuthenticated) {
    return (
      <p className="text-[12.5px] leading-[1.7]" style={{ color: 'var(--shell-muted, #6e6354)' }}>
        {t('nav.search.signInHint', 'سجّل الدخول للتصفية حسب العلم أو المؤلف أو الكتاب.')}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Search type — segmented control */}
      <div>
        <div
          className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em]"
          style={{ color: 'var(--accent, #b07d2b)' }}
        >
          {t('nav.search.modeLabel', 'نوع البحث')}
        </div>
        <div
          className="grid grid-cols-3 gap-[5px] rounded-[11px] p-1"
          style={{ background: 'var(--shell-line, #e6d9bc)' }}
          role="group"
          aria-label={t('nav.search.modeLabel', 'نوع البحث')}
        >
          {MODE_ORDER.map((m) => {
            const on = m === mode;
            return (
              <button
                key={m}
                type="button"
                onClick={() => onModeChange(m)}
                aria-pressed={on}
                className="flex items-center justify-center whitespace-nowrap rounded-[8px] px-0 py-2 text-[12px] font-semibold transition-all"
                style={
                  on
                    ? {
                        background: 'var(--accent, #b07d2b)',
                        color: 'var(--shell-on-accent, #fcf8ee)',
                        boxShadow: '0 2px 6px rgba(44,38,32,.18)',
                      }
                    : { color: 'var(--shell-muted, #7a6f59)' }
                }
              >
                {t(`nav.search.mode.${m}`, MODE_FALLBACK[m])}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] leading-[1.6]" style={{ color: 'var(--shell-muted, #9a8b70)' }}>
          {t(
            'nav.search.mode.hint',
            '«تام» يطابق الألفاظ حرفيًّا، و«دلالي» يطابق المعنى، و«مزيج» يجمع بينهما.',
          )}
        </p>
      </div>

      {/* Discipline / Category */}
      <FacetTypeahead
        cacheKey="facet-categories"
        fetchItems={getCategories}
        selected={selectedCategories}
        onToggle={onToggleCategory}
        labels={{
          heading: t('docs.categories', 'العلم'),
          placeholder: t('docs.categorySearch.placeholder', 'ابحث عن علم…'),
          loading: t('docs.categorySearch.loading', 'جارٍ البحث…'),
          empty: t('docs.categorySearch.empty', 'لا تخصصات مطابقة'),
          more: t('docs.categorySearch.more', 'اكتب لتضييق النتائج'),
          remove: t('docs.categorySearch.remove', 'إزالة'),
        }}
      />

      {/* Authors */}
      <FacetTypeahead
        cacheKey="facet-authors"
        fetchItems={getAuthors}
        selected={selectedAuthors}
        onToggle={onToggleAuthor}
        labels={{
          heading: t('docs.authors', 'المؤلفون'),
          placeholder: t('docs.authorSearch.placeholder', 'ابحث عن مؤلف…'),
          loading: t('docs.authorSearch.loading', 'جارٍ البحث…'),
          empty: t('docs.authorSearch.empty', 'لا مؤلفين مطابقين'),
          more: t('docs.authorSearch.more', 'اكتب لتضييق النتائج'),
          remove: t('docs.authorSearch.remove', 'إزالة'),
        }}
      />

      {/* Books (title → id resolved via useBooksFacetSource) */}
      <FacetTypeahead
        cacheKey="facet-books"
        fetchItems={books.fetchItems}
        selected={selectedBookTitles}
        onToggle={handleToggleBook}
        labels={{
          heading: t('nav.search.books', 'الكتب'),
          placeholder: t('nav.search.booksSearch.placeholder', 'ابحث عن كتاب بالعنوان…'),
          loading: t('docs.categorySearch.loading', 'جارٍ البحث…'),
          empty: t('nav.search.booksSearch.empty', 'لا كتب مطابقة'),
          more: t('docs.categorySearch.more', 'اكتب لتضييق النتائج'),
          remove: t('docs.categorySearch.remove', 'إزالة'),
        }}
      />
    </div>
  );
}
