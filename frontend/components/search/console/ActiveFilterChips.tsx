'use client';

import { useMemo } from 'react';

import { useI18n } from '@/components/i18n/I18nProvider';
import { useLanguageName } from '@/lib/i18n/languageName';
import { formatHijriCentury } from '@/lib/i18n/hijriCentury';
import { MODE_FALLBACK } from '@/components/search/searchMode';
import { termColor } from '@/lib/search/termColors';
import type {
  CorpusFilterHandlers,
  CorpusFilterState,
} from '@/lib/search/useCorpusSearchState';

const OP_CHIP_FALLBACK: Record<string, string> = {
  must: 'يجب',
  should: 'أو',
  must_not: 'بدون',
};

export interface ActiveFilterChipsProps {
  filters: CorpusFilterState;
  handlers: CorpusFilterHandlers;
  /** Show the trailing "clear all" action (default true). */
  showClearAll?: boolean;
}

/**
 * Every active selection as a removable chip (mode≠hybrid, each facet value,
 * date bounds). Renders nothing when no filter is engaged. Shared by the
 * console footer and the compact NavSearchPopover.
 */
export default function ActiveFilterChips({
  filters,
  handlers,
  showClearAll = true,
}: ActiveFilterChipsProps) {
  const { t, locale } = useI18n();
  const languageName = useLanguageName();

  const chips = useMemo(() => {
    const out: { key: string; label: string; onRemove: () => void; dot?: string }[] = [];
    filters.terms.forEach((term, index) => {
      if (!term.text.trim()) return;
      out.push({
        key: `term-${term.id}`,
        label: `${t(`nav.search.terms.op.${term.op}`, OP_CHIP_FALLBACK[term.op])}: ${term.text}`,
        onRemove: () => handlers.removeTerm(term.id),
        dot: termColor(index),
      });
    });
    if (filters.mode !== 'hybrid') {
      out.push({
        key: `mode-${filters.mode}`,
        label: `${t('nav.search.modeLabel', 'نوع البحث')}: ${t(`nav.search.mode.${filters.mode}`, MODE_FALLBACK[filters.mode])}`,
        onRemove: () => handlers.setMode('hybrid'),
      });
    }
    if (filters.scope === 'mine') {
      out.push({
        key: 'scope-mine',
        label: `${t('nav.search.scope.label', 'نطاق البحث')}: ${t('nav.search.scope.mine', 'كتبي')}`,
        onRemove: () => handlers.setScope('all'),
      });
    }
    for (const name of filters.categories) {
      out.push({ key: `cat-${name}`, label: name, onRemove: () => handlers.toggleCategory(name) });
    }
    for (const name of filters.authors) {
      out.push({ key: `auth-${name}`, label: name, onRemove: () => handlers.toggleAuthor(name) });
    }
    for (const book of filters.books) {
      out.push({ key: `book-${book.id}`, label: book.title, onRemove: () => handlers.toggleBook(book) });
    }
    for (const code of filters.languages) {
      out.push({ key: `lang-${code}`, label: languageName(code), onRemove: () => handlers.toggleLanguage(code) });
    }
    for (const country of filters.countries) {
      out.push({ key: `country-${country}`, label: country, onRemove: () => handlers.toggleCountry(country) });
    }
    for (const century of filters.deathCenturies) {
      out.push({
        key: `century-${century}`,
        label: formatHijriCentury(century, locale),
        onRemove: () => handlers.toggleDeathCentury(century),
      });
    }
    for (const genre of filters.genres) {
      out.push({ key: `genre-${genre}`, label: genre, onRemove: () => handlers.toggleGenre(genre) });
    }
    for (const madhhab of filters.madhhabs) {
      out.push({ key: `madhhab-${madhhab}`, label: madhhab, onRemove: () => handlers.toggleMadhhab(madhhab) });
    }
    for (const century of filters.eraCenturies) {
      out.push({
        key: `era-${century}`,
        label: formatHijriCentury(century, locale),
        onRemove: () => handlers.toggleEraCentury(century),
      });
    }
    for (const cls of filters.physicalClasses) {
      out.push({ key: `physical-${cls}`, label: cls, onRemove: () => handlers.togglePhysicalClass(cls) });
    }
    for (const person of filters.persons) {
      out.push({ key: `person-${person.id}`, label: person.label, onRemove: () => handlers.togglePerson(person) });
    }
    for (const place of filters.places) {
      out.push({ key: `place-${place.id}`, label: place.label, onRemove: () => handlers.togglePlace(place) });
    }
    if (filters.dateFrom) {
      out.push({
        key: 'date-from',
        label: `${t('docs.from', 'من')} ${filters.dateFrom}`,
        onRemove: () => handlers.setDateFrom(''),
      });
    }
    if (filters.dateTo) {
      out.push({
        key: 'date-to',
        label: `${t('docs.to', 'إلى')} ${filters.dateTo}`,
        onRemove: () => handlers.setDateTo(''),
      });
    }
    return out;
  }, [filters, handlers, languageName, locale, t]);

  if (chips.length === 0) return null;

  return (
    <div className="flex max-h-[72px] flex-wrap gap-1.5 overflow-y-auto" aria-live="polite">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={chip.onRemove}
          title={t('docs.categorySearch.remove', 'إزالة')}
          className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[11.5px] transition-colors"
          style={{
            background: 'color-mix(in srgb, var(--accent, #b07d2b) 12%, transparent)',
            borderColor: 'color-mix(in srgb, var(--accent, #b07d2b) 35%, transparent)',
            color: 'var(--shell-ink, #2c2620)',
          }}
        >
          {chip.dot && (
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: chip.dot }}
            />
          )}
          <bdi className="min-w-0 truncate">{chip.label}</bdi>
          <svg className="h-3 w-3 shrink-0 opacity-70" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      ))}
      {showClearAll && (
        <button
          type="button"
          onClick={handlers.clearAll}
          className="inline-flex items-center rounded-full px-2 py-[3px] text-[11.5px] underline-offset-2 hover:underline"
          style={{ color: 'var(--shell-muted, #9a8b70)' }}
        >
          {t('docs.clearAll', 'مسح الكل')}
        </button>
      )}
    </div>
  );
}
