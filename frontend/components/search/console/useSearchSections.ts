'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useI18n } from '@/components/i18n/I18nProvider';
import { useLanguageName } from '@/lib/i18n/languageName';
import { formatHijriCentury } from '@/lib/i18n/hijriCentury';
import {
  fetchAuthorOptions,
  fetchBookOptions,
  fetchCategoryOptions,
  fetchFacetOptions,
} from '@/lib/search/optionSources';
import type {
  CorpusFilterHandlers,
  CorpusFilterState,
} from '@/lib/search/useCorpusSearchState';
import type { OptionItem, OptionsSectionSpec, SectionSpec } from './types';

export interface UseSearchSectionsArgs {
  filters: CorpusFilterState;
  handlers: CorpusFilterHandlers;
  isAuthenticated: boolean;
  /** Include the presets rail entry (badge = this count). Pass `null` to omit
   *  the section entirely (surface has no preset wiring). */
  presetCount: number | null;
}

/**
 * Builds the ordered `SectionSpec[]` driving both console presentations
 * (two-pane rail and accordion): presets → mode → categories → authors →
 * books → languages → countries → death centuries → dates.
 *
 * Facet sections require an authenticated API and are omitted when signed
 * out (the mode toggle survives — same gate as the legacy facet body).
 * Static sections (languages / countries / centuries) come from one combined
 * facet-options request; on failure each is omitted unless it carries
 * selections (old preset / deep link), in which case it renders degraded so
 * the selections stay removable.
 */
export default function useSearchSections({
  filters,
  handlers,
  isAuthenticated,
  presetCount,
}: UseSearchSectionsArgs): SectionSpec[] {
  const { t, locale } = useI18n();
  const languageName = useLanguageName();

  const facetOptionsQuery = useQuery({
    queryKey: ['facet-options'],
    queryFn: fetchFacetOptions,
    enabled: isAuthenticated,
    retry: false,
    staleTime: 300_000,
  });
  const facetData = facetOptionsQuery.data;
  const facetFailed = facetOptionsQuery.isError;

  return useMemo<SectionSpec[]>(() => {
    const sections: SectionSpec[] = [];

    if (isAuthenticated && presetCount !== null) {
      sections.push({
        kind: 'presets',
        key: 'presets',
        label: t('docs.savedPresets', 'المرشحات المحفوظة'),
        badge: presetCount,
      });
    }

    sections.push({
      kind: 'mode',
      key: 'mode',
      label: t('nav.search.modeLabel', 'نوع البحث'),
      badge: filters.mode !== 'hybrid' ? 1 : 0,
      mode: filters.mode,
      onModeChange: handlers.setMode,
    });

    if (!isAuthenticated) return sections;

    const searchLabels = (placeholder: string, empty: string) => ({
      placeholder,
      empty,
      more: t('docs.categorySearch.more', 'اكتب لتضييق النتائج'),
    });

    sections.push({
      kind: 'options',
      key: 'categories',
      label: t('docs.categories', 'العلم'),
      badge: filters.categories.length,
      source: { type: 'search', cacheKey: 'facet-categories', fetchOptions: fetchCategoryOptions },
      selected: filters.categories.map((name) => ({ id: name, label: name })),
      onToggle: (opt) => handlers.toggleCategory(String(opt.id)),
      labels: searchLabels(
        t('docs.categorySearch.placeholder', 'ابحث عن علم…'),
        t('docs.categorySearch.empty', 'لا تخصصات مطابقة'),
      ),
    });

    sections.push({
      kind: 'options',
      key: 'authors',
      label: t('docs.authors', 'المؤلفون'),
      badge: filters.authors.length,
      source: { type: 'search', cacheKey: 'facet-authors', fetchOptions: fetchAuthorOptions },
      selected: filters.authors.map((name) => ({ id: name, label: name })),
      onToggle: (opt) => handlers.toggleAuthor(String(opt.id)),
      labels: searchLabels(
        t('docs.authorSearch.placeholder', 'ابحث عن مؤلف…'),
        t('docs.authorSearch.empty', 'لا مؤلفين مطابقين'),
      ),
    });

    sections.push({
      kind: 'options',
      key: 'books',
      label: t('nav.search.books', 'الكتب'),
      badge: filters.books.length,
      source: { type: 'search', cacheKey: 'facet-books', fetchOptions: fetchBookOptions },
      selected: filters.books.map((b) => ({ id: b.id, label: b.title })),
      onToggle: (opt) => handlers.toggleBook({ id: Number(opt.id), title: opt.label }),
      labels: searchLabels(
        t('nav.search.booksSearch.placeholder', 'ابحث عن كتاب بالعنوان…'),
        t('nav.search.booksSearch.empty', 'لا كتب مطابقة'),
      ),
    });

    // ── Static facets from the combined facet-options payload ──────────────
    const pushStatic = (spec: Omit<OptionsSectionSpec, 'source' | 'degraded'> & {
      options: OptionItem[] | null;
    }) => {
      const { options, ...rest } = spec;
      if (options === null) {
        // Fetch failed (or endpoint absent in this environment): keep the
        // section only when selections must remain removable.
        if (rest.selected.length > 0) {
          sections.push({ ...rest, source: { type: 'static', options: [] }, degraded: true });
        }
        return;
      }
      if (options.length === 0 && rest.selected.length === 0) return;
      sections.push({ ...rest, source: { type: 'static', options } });
    };

    const staticEmpty = (empty: string) => ({
      placeholder: t('docs.facet.searchPlaceholder', 'ابحث…'),
      empty,
      more: '',
    });

    pushStatic({
      kind: 'options',
      key: 'languages',
      label: t('docs.language', 'اللغة'),
      badge: filters.languages.length,
      selected: filters.languages.map((code) => ({ id: code, label: languageName(code) })),
      onToggle: (opt) => handlers.toggleLanguage(String(opt.id)),
      labels: staticEmpty(t('docs.facet.noneMatch', 'لا خيارات مطابقة')),
      options: facetFailed
        ? null
        : facetData
          ? facetData.languages.map((l) => ({
              id: l.value,
              label: languageName(l.value),
              count: l.count,
            }))
          : [],
    });

    pushStatic({
      kind: 'options',
      key: 'countries',
      label: t('docs.country', 'البلد'),
      badge: filters.countries.length,
      selected: filters.countries.map((name) => ({ id: name, label: name })),
      onToggle: (opt) => handlers.toggleCountry(String(opt.id)),
      labels: staticEmpty(t('docs.facet.noneMatch', 'لا خيارات مطابقة')),
      options: facetFailed
        ? null
        : facetData
          ? facetData.countries.map((c) => ({ id: c.value, label: c.value, count: c.count }))
          : [],
    });

    pushStatic({
      kind: 'options',
      key: 'deathCenturies',
      label: t('docs.deathCentury', 'قرن الوفاة'),
      badge: filters.deathCenturies.length,
      selected: filters.deathCenturies.map((c) => ({
        id: c,
        label: formatHijriCentury(c, locale),
      })),
      onToggle: (opt) => handlers.toggleDeathCentury(Number(opt.id)),
      labels: staticEmpty(t('docs.facet.noneMatch', 'لا خيارات مطابقة')),
      options: facetFailed
        ? null
        : facetData
          ? facetData.death_centuries.map((c) => ({
              id: c.value,
              label: formatHijriCentury(c.value, locale),
              count: c.count,
            }))
          : [],
    });

    sections.push({
      kind: 'dateRange',
      key: 'dates',
      label: t('docs.uploadDate', 'تاريخ الرفع'),
      badge: (filters.dateFrom ? 1 : 0) + (filters.dateTo ? 1 : 0),
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      onDateFromChange: handlers.setDateFrom,
      onDateToChange: handlers.setDateTo,
    });

    return sections;
  }, [filters, handlers, isAuthenticated, presetCount, facetData, facetFailed, t, locale, languageName]);
}
