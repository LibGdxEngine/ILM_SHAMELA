'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import ShellHeader from '@/components/ShellHeader';
import SearchCommandPalette from '@/components/documents/SearchCommandPalette';
import type { SelectedBook } from '@/components/search/SearchFacetControls';
import { useAuth } from '@/lib/AuthContext';
import { useI18n } from '@/components/i18n/I18nProvider';
import { useLocalizedPath } from '@/lib/i18n/navigation';
import { buildDocumentsSearchParams } from '@/lib/documentsSearchParams';
import type { AssistFilters, CorpusSearchMode } from '@/lib/api';

/**
 * Landing's persistent header. Composes the shared `ShellHeader` (gold Reading
 * Room accent, inherited from the `.landing-shell` CSS variables) around an
 * inline search box that opens the shared `SearchCommandPalette` — the same
 * AI-assisted search modal `/documents` uses. The landing page has no
 * in-place browsing concept, so both submit paths always navigate to
 * `/documents` with the serialized query + filters instead of setting local
 * page state.
 */
export default function LandingHeader() {
  const router = useRouter();
  const localizedPath = useLocalizedPath();
  const { t } = useI18n();
  const { isAuthenticated } = useAuth();

  const [queryValue, setQueryValue] = useState('');
  const [searchMode, setSearchMode] = useState<CorpusSearchMode>('hybrid');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedAuthors, setSelectedAuthors] = useState<string[]>([]);
  const [selectedBooks, setSelectedBooks] = useState<SelectedBook[]>([]);
  const [popoverOpen, setPopoverOpen] = useState(false);

  // AI-assisted submit: the assistant parses a natural-language query into
  // structured filters. It can't express a book scope, so preserve the
  // user's existing book selection — mirrors /documents's applyAssistFilters.
  const onAssistApply = (filters: AssistFilters) => {
    const params = buildDocumentsSearchParams({
      q: filters.q,
      mode: filters.mode,
      documents: selectedBooks.map((b) => b.id),
      authors: filters.authors,
      categories: filters.categories,
      languages: filters.languages,
      dateFrom: filters.dateFrom ?? undefined,
      dateTo: filters.dateTo ?? undefined,
    });
    const qs = params.toString();
    router.push(localizedPath(qs ? `/documents?${qs}` : '/documents'));
    setPopoverOpen(false);
  };

  // Plain-search fallback (AI unavailable, or the outer trigger form submits
  // before the palette steals focus): jump to the catalog with the current
  // query + filters, serialized identically to every other surface that
  // links into /documents.
  const onPlainSubmit = (q: string) => {
    const params = buildDocumentsSearchParams({
      q,
      mode: searchMode,
      documents: selectedBooks.map((b) => b.id),
      authors: selectedAuthors,
      categories: selectedCategories,
    });
    const qs = params.toString();
    router.push(localizedPath(qs ? `/documents?${qs}` : '/documents'));
    setPopoverOpen(false);
  };

  const landingSearchEl = (
    <div className="relative w-full max-w-[540px]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onPlainSubmit(queryValue);
        }}
      >
        <div
          className="flex items-center gap-[11px] rounded-[12px] border px-4 py-[11px]"
          style={{ background: 'var(--paper-card)', borderColor: 'var(--paper-line)' }}
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#9a8b70"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden
          >
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.5" y2="16.5" />
          </svg>
          <input
            type="text"
            value={queryValue}
            onChange={(e) => setQueryValue(e.target.value)}
            onFocus={() => setPopoverOpen(true)}
            placeholder={t('nav.search.placeholder', 'ابحث في الكتب والمؤلفين والموضوعات…')}
            aria-label={t('nav.search.openLabel', 'ابحث في المكتبة')}
            dir="auto"
            className="min-w-0 flex-1 bg-transparent text-[14.5px] outline-none placeholder:text-[#9a8b70]"
            style={{ color: 'var(--ink-deep)' }}
          />
        </div>
      </form>

      <SearchCommandPalette
        open={popoverOpen}
        onOpenChange={setPopoverOpen}
        initialQuery={queryValue}
        mode={searchMode}
        onModeChange={setSearchMode}
        selectedCategories={selectedCategories}
        onToggleCategory={(name) =>
          setSelectedCategories((prev) =>
            prev.includes(name) ? prev.filter((c) => c !== name) : [...prev, name],
          )
        }
        selectedAuthors={selectedAuthors}
        onToggleAuthor={(name) =>
          setSelectedAuthors((prev) =>
            prev.includes(name) ? prev.filter((a) => a !== name) : [...prev, name],
          )
        }
        selectedBooks={selectedBooks}
        onToggleBook={(book) =>
          setSelectedBooks((prev) =>
            prev.some((b) => b.id === book.id)
              ? prev.filter((b) => b.id !== book.id)
              : [...prev, book],
          )
        }
        isAuthenticated={isAuthenticated}
        onAssistApply={onAssistApply}
        onPlainSubmit={onPlainSubmit}
      />
    </div>
  );

  return <ShellHeader contained search={landingSearchEl} />;
}
