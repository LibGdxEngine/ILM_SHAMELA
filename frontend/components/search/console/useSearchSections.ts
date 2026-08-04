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
import {
  fetchPersonOptions,
  fetchPlaceOptions,
} from '@/lib/api/extraction';
import type {
  CorpusFilterHandlers,
  CorpusFilterState,
} from '@/lib/search/useCorpusSearchState';
import type { OptionItem, OptionsSectionSpec, SectionSpec } from './types';

export interface UseSearchSectionsArgs {
  filters: CorpusFilterState;
  handlers: CorpusFilterHandlers;
  isAuthenticated: boolean;
  /** Show the "my uploads" scope choice (viewers who can't upload never have
   *  owned documents). Defaults to true for authenticated users. */
  canUpload?: boolean;
  /** Include the presets rail entry (badge = this count). Pass `null` to omit
   *  the section entirely (surface has no preset wiring). */
  presetCount: number | null;
}

/**
 * Builds the ordered `SectionSpec[]` driving both console presentations
 * (two-pane rail and accordion): presets → mode → terms (the multi-term
 * builder) → scope (with the book multi-select nested inside) → categories →
 * authors → languages → countries → death centuries → dates.
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
  canUpload = true,
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
      kind: 'terms',
      key: 'terms',
      label: t('nav.search.terms.label', 'شروط البحث'),
      badge: filters.terms.length,
      terms: filters.terms,
      onAdd: handlers.addTerm,
      onUpdate: handlers.updateTerm,
      onRemove: handlers.removeTerm,
    });

    sections.push({
      kind: 'scope',
      key: 'scope',
      label: t('nav.search.scope.label', 'نطاق البحث'),
      badge: filters.scope === 'mine' ? 1 : filters.books.length,
      scope: filters.scope,
      onScopeChange: handlers.setScope,
      showMine: canUpload,
      books: {
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
      },
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

    pushStatic({
      kind: 'options',
      key: 'genres',
      label: t('docs.facet.genre', 'الفن/التخصص'),
      badge: filters.genres.length,
      selected: filters.genres.map((v) => {
        const opt = facetData?.genres.find((r) => r.value === v);
        return { id: v, label: opt?.label ?? v };
      }),
      onToggle: (opt) => handlers.toggleGenre(String(opt.id)),
      labels: staticEmpty(t('docs.facet.noneMatch', 'لا خيارات مطابقة')),
      options: facetFailed
        ? null
        : facetData
          ? facetData.genres.map((r) => ({ id: r.value, label: r.label ?? r.value, count: r.count }))
          : [],
    });

    pushStatic({
      kind: 'options',
      key: 'madhhabs',
      label: t('docs.facet.madhhab', 'المذهب'),
      badge: filters.madhhabs.length,
      selected: filters.madhhabs.map((v) => {
        const opt = facetData?.madhhabs.find((r) => r.value === v);
        return { id: v, label: opt?.label ?? v };
      }),
      onToggle: (opt) => handlers.toggleMadhhab(String(opt.id)),
      labels: staticEmpty(t('docs.facet.noneMatch', 'لا خيارات مطابقة')),
      options: facetFailed
        ? null
        : facetData
          ? facetData.madhhabs.map((r) => ({ id: r.value, label: r.label ?? r.value, count: r.count }))
          : [],
    });

    pushStatic({
      kind: 'options',
      key: 'eraCenturies',
      label: t('docs.facet.eraCentury', 'قرن التأليف'),
      badge: filters.eraCenturies.length,
      selected: filters.eraCenturies.map((c) => ({
        id: c,
        label: formatHijriCentury(c, locale),
      })),
      onToggle: (opt) => handlers.toggleEraCentury(Number(opt.id)),
      labels: staticEmpty(t('docs.facet.noneMatch', 'لا خيارات مطابقة')),
      options: facetFailed
        ? null
        : facetData
          ? facetData.era_centuries.map((c) => ({
              id: c.value,
              label: formatHijriCentury(c.value, locale),
              count: c.count,
            }))
          : [],
    });

    pushStatic({
      kind: 'options',
      key: 'physicalClasses',
      label: t('docs.facet.physicalClass', 'نوع الوعاء'),
      badge: filters.physicalClasses.length,
      selected: filters.physicalClasses.map((v) => {
        const opt = facetData?.physical_classes.find((r) => r.value === v);
        return { id: v, label: opt?.label ?? v };
      }),
      onToggle: (opt) => handlers.togglePhysicalClass(String(opt.id)),
      labels: staticEmpty(t('docs.facet.noneMatch', 'لا خيارات مطابقة')),
      options: facetFailed
        ? null
        : facetData
          ? facetData.physical_classes.map((r) => ({ id: r.value, label: r.label ?? r.value, count: r.count }))
          : [],
    });

    sections.push({
      kind: 'options',
      key: 'persons',
      label: t('docs.facet.persons', 'الأعلام'),
      badge: filters.persons.length,
      source: { type: 'search', cacheKey: 'facet-persons', fetchOptions: fetchPersonOptions },
      selected: filters.persons.map((p) => ({ id: p.id, label: p.label })),
      onToggle: (opt) => handlers.togglePerson({ id: Number(opt.id), label: opt.label }),
      labels: searchLabels(
        t('docs.personSearch.placeholder', 'ابحث عن عَلَم…'),
        t('docs.personSearch.empty', 'لا أعلام مطابقة'),
      ),
    });

    sections.push({
      kind: 'options',
      key: 'places',
      label: t('docs.facet.places', 'المواضع والبلدان'),
      badge: filters.places.length,
      source: { type: 'search', cacheKey: 'facet-places', fetchOptions: fetchPlaceOptions },
      selected: filters.places.map((p) => ({ id: p.id, label: p.label })),
      onToggle: (opt) => handlers.togglePlace({ id: Number(opt.id), label: opt.label }),
      labels: searchLabels(
        t('docs.placeSearch.placeholder', 'ابحث عن موضع…'),
        t('docs.placeSearch.empty', 'لا مواضع مطابقة'),
      ),
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
  }, [filters, handlers, isAuthenticated, canUpload, presetCount, facetData, facetFailed, t, locale, languageName]);
}
