'use client';

import { useMemo, useState } from 'react';
import { useI18n } from '@/components/i18n/I18nProvider';
import { useLanguageName } from '@/lib/i18n/languageName';
import { toLocaleDigits } from '@/lib/utils';
import { getAuthors, getCategories } from '@/lib/api';
import FacetTypeahead from './FacetTypeahead';
import DatePickerField from './DatePickerField';
import {
  FACET_INPUT_CLASS,
  FilterSection,
  PILL_OFF,
  PILL_ON,
} from './filterTokens';
import type { SavedFilterPreset } from '@/lib/api/documentFilters';

/** Show a search box and a Show more/less toggle once a facet exceeds this. */
const FACET_VISIBLE = 8;

export interface StatusSegmentOption {
  key: string;
  label: string;
  count: number;
}

interface FilterSidebarProps {
  /* status */
  segments: StatusSegmentOption[];
  statusSegment: string;
  onStatusChange: (key: string) => void;
  /* facets (values are pre-sorted by frequency) */
  facetValues: { languages: string[] };
  selectedCategories: string[];
  selectedLanguages: string[];
  selectedAuthors: string[];
  onToggleCategory: (v: string) => void;
  onToggleLanguage: (v: string) => void;
  onToggleAuthor: (v: string) => void;
  /* date */
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  /* clear */
  hasActiveFilters: boolean;
  onClearAll: () => void;
  /* saved presets */
  presets: SavedFilterPreset[];
  onSavePreset: (name: string) => Promise<void> | void;
  onApplyPreset: (preset: SavedFilterPreset) => void;
  onDeletePreset: (id: number) => Promise<void> | void;
}

interface FacetGroupProps {
  heading: string;
  values: string[];
  selected: string[];
  onToggle: (v: string) => void;
  displayFn?: (v: string) => string;
}

function FacetGroup({ heading, values, selected, onToggle, displayFn }: FacetGroupProps) {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);

  const matched = useMemo(() => {
    const q = query.trim().toLocaleLowerCase(locale);
    if (!q) return values;
    return values.filter((v) => (displayFn ? displayFn(v) : v).toLocaleLowerCase(locale).includes(q));
  }, [values, query, displayFn, locale]);

  const shown = useMemo(() => {
    const base = expanded ? matched : matched.slice(0, FACET_VISIBLE);
    const set = new Set(base);
    const out = [...base];
    // Keep selected-but-hidden values visible so they can always be removed.
    for (const s of selected) {
      if (!set.has(s)) {
        out.push(s);
        set.add(s);
      }
    }
    return out;
  }, [matched, expanded, selected]);

  const hiddenCount = matched.length - FACET_VISIBLE;

  if (values.length === 0) return null;
  const showSearch = values.length > FACET_VISIBLE;

  return (
    <FilterSection heading={heading}>
      {showSearch && (
        <div className="relative mb-3">
          <svg
            className="absolute top-1/2 -translate-y-1/2 start-2.5 w-3.5 h-3.5 text-[#9a8b70] pointer-events-none"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('docs.facet.searchPlaceholder', 'ابحث…')}
            dir="auto"
            aria-label={`${heading} — ${t('docs.facet.searchPlaceholder', 'ابحث…')}`}
            className={FACET_INPUT_CLASS}
          />
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {shown.map((v) => {
          const on = selected.includes(v);
          return (
            <button
              key={v}
              type="button"
              onClick={() => onToggle(v)}
              aria-pressed={on}
              className={on ? PILL_ON : PILL_OFF}
              title={displayFn ? displayFn(v) : v}
            >
              <span dir="auto">{displayFn ? displayFn(v) : v}</span>
            </button>
          );
        })}
      </div>

      {!query && hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-2.5 text-[11.5px] text-[#b07d2b] hover:text-[#2c2620] transition-colors"
        >
          {expanded
            ? t('docs.facet.showLess', 'عرض أقل')
            : t('docs.facet.showMore', 'عرض المزيد ({count})', {
                count: toLocaleDigits(hiddenCount, locale),
              })}
        </button>
      )}
    </FilterSection>
  );
}

interface SavedPresetsSectionProps {
  presets: SavedFilterPreset[];
  hasActiveFilters: boolean;
  onSavePreset: (name: string) => Promise<void> | void;
  onApplyPreset: (preset: SavedFilterPreset) => void;
  onDeletePreset: (id: number) => Promise<void> | void;
}

function SavedPresetsSection({
  presets,
  hasActiveFilters,
  onSavePreset,
  onApplyPreset,
  onDeletePreset,
}: SavedPresetsSectionProps) {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const name = draft.trim();
    if (!name || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSavePreset(name);
      setDraft('');
      setAdding(false);
    } catch (e) {
      // Surface the backend rejection (e.g. duplicate name) inline.
      setError(e instanceof Error ? e.message : t('docs.savedPresets.saveError', 'تعذّر الحفظ'));
    } finally {
      setSaving(false);
    }
  };

  // Nothing saved and nothing worth saving — hide the whole section.
  if (presets.length === 0 && !hasActiveFilters) return null;

  return (
    <FilterSection heading={t('docs.savedPresets', 'المرشحات المحفوظة')}>
      {presets.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {presets.map((preset) => (
            <span key={preset.id} className={PILL_OFF}>
              <button
                type="button"
                onClick={() => onApplyPreset(preset)}
                className="max-w-[9rem] truncate"
                title={preset.name}
              >
                <span dir="auto">{preset.name}</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void onDeletePreset(preset.id);
                }}
                aria-label={t('docs.savedPresets.delete', 'حذف')}
                title={t('docs.savedPresets.delete', 'حذف')}
                className="-me-1 text-[#9a8b70] hover:text-[#2c2620] transition-colors"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}

      {hasActiveFilters && (
        <div className={presets.length > 0 ? 'mt-3' : ''}>
          {adding ? (
            <div>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={draft}
                  autoFocus
                  onChange={(e) => {
                    setDraft(e.target.value);
                    if (error) setError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void submit();
                    } else if (e.key === 'Escape') {
                      setAdding(false);
                      setDraft('');
                      setError(null);
                    }
                  }}
                  placeholder={t('docs.savedPresets.namePlaceholder', 'اسم المُرشِّح…')}
                  aria-label={t('docs.savedPresets.namePlaceholder', 'اسم المُرشِّح…')}
                  className={`${FACET_INPUT_CLASS} !ps-3`}
                />
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={saving || !draft.trim()}
                  className={`${PILL_ON} disabled:opacity-50`}
                >
                  {t('docs.savedPresets.save', 'حفظ')}
                </button>
              </div>
              {error && <p className="mt-1.5 text-[11px] text-red-700">{error}</p>}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setAdding(true);
                setError(null);
              }}
              className="inline-flex items-center gap-1.5 text-[12px] text-[#b07d2b] hover:text-[#2c2620] transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
              </svg>
              {t('docs.savedPresets.saveCurrent', 'احفظ المرشِّحات الحالية…')}
            </button>
          )}
        </div>
      )}
    </FilterSection>
  );
}

export default function FilterSidebar({
  segments,
  statusSegment,
  onStatusChange,
  facetValues,
  selectedCategories,
  selectedLanguages,
  selectedAuthors,
  onToggleCategory,
  onToggleLanguage,
  onToggleAuthor,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  hasActiveFilters,
  onClearAll,
  presets,
  onSavePreset,
  onApplyPreset,
  onDeletePreset,
}: FilterSidebarProps) {
  const { t, locale } = useI18n();
  const languageName = useLanguageName();
  const formatCount = (n: number) => toLocaleDigits(n, locale);

  return (
    <div className="text-[13px]">
      {/* Saved filter presets */}
      <SavedPresetsSection
        presets={presets}
        hasActiveFilters={hasActiveFilters}
        onSavePreset={onSavePreset}
        onApplyPreset={onApplyPreset}
        onDeletePreset={onDeletePreset}
      />

      {/* Status */}
      <FilterSection heading={t('docs.filter.status', 'الحالة')}>
        <div className="flex flex-wrap gap-1.5">
          {segments.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => onStatusChange(s.key)}
              aria-pressed={statusSegment === s.key}
              className={statusSegment === s.key ? PILL_ON : PILL_OFF}
            >
              {s.label}
              <span className={statusSegment === s.key ? 'text-[#fcf8ee]/80' : 'text-[#9a8b70]'}>{formatCount(s.count)}</span>
            </button>
          ))}
        </div>
      </FilterSection>

      {/* Discipline / Category (server-backed typeahead) */}
      <FacetTypeahead
        cacheKey="categories"
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

      {/* Language */}
      <FacetGroup
        heading={t('docs.language', 'اللغة')}
        values={facetValues.languages}
        selected={selectedLanguages}
        onToggle={onToggleLanguage}
        displayFn={(v) => languageName(v)}
      />

      {/* Authors (server-backed typeahead) */}
      <FacetTypeahead
        cacheKey="authors"
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

      {/* Upload date */}
      <FilterSection heading={t('docs.uploadDate', 'تاريخ الرفع')}>
        <div className="space-y-3">
          <div>
            <span className="mb-1.5 block text-[11px] text-[#9a8b70]">{t('docs.from', 'من')}</span>
            <DatePickerField
              value={dateFrom}
              onChange={onDateFromChange}
              max={dateTo || undefined}
              placeholder={t('docs.datePlaceholder', 'اختر تاريخًا')}
              ariaLabel={`${t('docs.uploadDate', 'تاريخ الرفع')} — ${t('docs.from', 'من')}`}
            />
          </div>
          <div>
            <span className="mb-1.5 block text-[11px] text-[#9a8b70]">{t('docs.to', 'إلى')}</span>
            <DatePickerField
              value={dateTo}
              onChange={onDateToChange}
              min={dateFrom || undefined}
              placeholder={t('docs.datePlaceholder', 'اختر تاريخًا')}
              ariaLabel={`${t('docs.uploadDate', 'تاريخ الرفع')} — ${t('docs.to', 'إلى')}`}
            />
          </div>
        </div>
      </FilterSection>

      {/* Clear all */}
      {hasActiveFilters && (
        <div className="pt-4">
          <button
            type="button"
            onClick={onClearAll}
            className="inline-flex items-center gap-1.5 text-[12px] text-[#b07d2b] hover:text-[#2c2620] transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            {t('docs.clearAll', 'مسح الكل')}
          </button>
        </div>
      )}
    </div>
  );
}
