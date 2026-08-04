'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import ShellHeader from '@/components/ShellHeader';
import SearchCommandPalette from '@/components/documents/SearchCommandPalette';
import useLocalCorpusSearchState, {
  corpusFiltersToValues,
} from '@/lib/search/useCorpusSearchState';
import useFilterPresets from '@/hooks/useFilterPresets';
import { useAuth } from '@/lib/AuthContext';
import { useI18n } from '@/components/i18n/I18nProvider';
import { useLocalizedPath } from '@/lib/i18n/navigation';
import { buildDocumentsSearchParams, type DocumentsSearchState } from '@/lib/documentsSearchParams';
import type { AssistFilters } from '@/lib/api';

/**
 * Landing's persistent header. Composes the shared `ShellHeader` (gold Reading
 * Room accent, inherited from the `.landing-shell` CSS variables) around an
 * inline search box that opens the shared `SearchCommandPalette` — the same
 * research console `/documents` uses. The landing page has no in-place
 * browsing concept, so every submit path (plain, AI, preset apply) navigates
 * to `/documents` with the serialized query + filters.
 */
export default function LandingHeader() {
  const router = useRouter();
  const localizedPath = useLocalizedPath();
  const { t } = useI18n();
  const { isAuthenticated, user } = useAuth();
  const canUpload = !!user?.can_upload;

  const [queryValue, setQueryValue] = useState('');
  const [popoverOpen, setPopoverOpen] = useState(false);
  const { filters, handlers } = useLocalCorpusSearchState();
  const { presets, savePreset, deletePreset } = useFilterPresets(isAuthenticated);

  const goToDocuments = (state: DocumentsSearchState) => {
    const qs = buildDocumentsSearchParams(state).toString();
    router.push(localizedPath(qs ? `/documents?${qs}` : '/documents'));
    setPopoverOpen(false);
  };

  // AI-assisted submit: the assistant parses a natural-language query into
  // structured filters. It can't express a book scope, so preserve the
  // user's existing book selection — mirrors /documents's applyAssistFilters.
  const onAssistApply = (assist: AssistFilters) => {
    goToDocuments({
      q: assist.q,
      mode: assist.mode,
      // Assist `mine` wins; otherwise keep the user's current scope/books.
      scope: assist.scope === 'mine' ? 'mine' : filters.scope,
      terms: assist.terms?.map((row) => ({ ...row, diacritics: 'ignore' as const })),
      documents: filters.books.map((b) => b.id),
      authors: assist.authors,
      categories: assist.categories,
      languages: assist.languages,
      countries: assist.countries ?? [],
      deathCenturies: assist.deathCenturies ?? [],
      dateFrom: assist.dateFrom ?? undefined,
      dateTo: assist.dateTo ?? undefined,
    });
  };

  // Plain-search fallback (AI unavailable, or the outer trigger form submits
  // before the palette steals focus): jump to the catalog with the current
  // query + every selected facet, serialized identically to every other
  // surface that links into /documents.
  const onPlainSubmit = (q: string) => {
    goToDocuments(corpusFiltersToValues(filters, q));
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
        filters={filters}
        handlers={handlers}
        isAuthenticated={isAuthenticated}
        canUpload={canUpload}
        analyticsSurface="landing"
        onAssistApply={onAssistApply}
        onPlainSubmit={onPlainSubmit}
        presets={
          isAuthenticated
            ? {
                list: presets,
                // No in-place state here — applying a preset IS a navigation.
                onApply: (preset) => goToDocuments(preset.filters),
                onSave: (name, values) => savePreset(name, values),
                onDelete: (id) => deletePreset(id),
              }
            : undefined
        }
      />
    </div>
  );

  return <ShellHeader contained search={landingSearchEl} />;
}
