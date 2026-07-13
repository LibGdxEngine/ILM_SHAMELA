'use client';

import { useI18n } from '@/components/i18n/I18nProvider';
import DatePickerField from '@/components/documents/DatePickerField';
import type { DateRangeSectionSpec } from './types';

/** Upload-date bounds — the same two mutually-clamped pickers as the
 *  `/documents` sidebar. */
export default function DateRangePane({ section }: { section: DateRangeSectionSpec }) {
  const { t } = useI18n();

  return (
    <div className="space-y-3">
      <div>
        <span className="mb-1.5 block text-[11px]" style={{ color: 'var(--shell-muted, #9a8b70)' }}>
          {t('docs.from', 'من')}
        </span>
        <DatePickerField
          value={section.dateFrom}
          onChange={section.onDateFromChange}
          max={section.dateTo || undefined}
          placeholder={t('docs.datePlaceholder', 'اختر تاريخًا')}
          ariaLabel={`${section.label} — ${t('docs.from', 'من')}`}
        />
      </div>
      <div>
        <span className="mb-1.5 block text-[11px]" style={{ color: 'var(--shell-muted, #9a8b70)' }}>
          {t('docs.to', 'إلى')}
        </span>
        <DatePickerField
          value={section.dateTo}
          onChange={section.onDateToChange}
          min={section.dateFrom || undefined}
          placeholder={t('docs.datePlaceholder', 'اختر تاريخًا')}
          ariaLabel={`${section.label} — ${t('docs.to', 'إلى')}`}
        />
      </div>
    </div>
  );
}
