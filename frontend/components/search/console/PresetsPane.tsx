'use client';

import { useI18n } from '@/components/i18n/I18nProvider';
import type { SavedFilterPreset } from '@/lib/api/documentFilters';
import PresetSaveForm from './PresetSaveForm';

export interface PresetsPaneProps {
  presets: SavedFilterPreset[];
  /** Apply is surface-specific: /documents mutates in place, other surfaces
   *  navigate to /documents with the serialized preset. */
  onApply: (preset: SavedFilterPreset) => void;
  onDelete: (id: number) => Promise<unknown> | void;
  /** Rejects with the backend message for the inline form. */
  onSave: (name: string) => Promise<unknown>;
  /** Whether the current console state is worth saving. */
  canSaveCurrent: boolean;
}

/** The saved-presets section pane: save-current form on top, then one row per
 *  preset — click applies, the ✕ deletes. */
export default function PresetsPane({
  presets,
  onApply,
  onDelete,
  onSave,
  canSaveCurrent,
}: PresetsPaneProps) {
  const { t, locale } = useI18n();

  const formatDate = (iso: string) => {
    try {
      return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));
    } catch {
      return '';
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <PresetSaveForm onSave={onSave} disabled={!canSaveCurrent} />

      {presets.length === 0 ? (
        <p className="text-[12.5px] leading-[1.7]" style={{ color: 'var(--shell-muted, #9a8b70)' }}>
          {t(
            'console.presets.empty',
            'لا إعدادات محفوظة بعد — اختر مرشِّحاتك ثم احفظها باسم لتعود إليها بنقرة.',
          )}
        </p>
      ) : (
        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {presets.map((preset) => (
            <li key={preset.id}>
              <div
                className="group flex items-center gap-2 rounded-[10px] border px-3 py-2 transition-colors"
                style={{
                  background: 'var(--shell-surface, #fcf8ee)',
                  borderColor: 'var(--shell-line, #e2d5ba)',
                }}
              >
                <button
                  type="button"
                  onClick={() => onApply(preset)}
                  className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-start"
                  title={preset.name}
                >
                  <bdi
                    className="w-full truncate text-[13px] font-medium"
                    style={{ color: 'var(--shell-ink, #2c2620)' }}
                  >
                    {preset.name}
                  </bdi>
                  <span className="text-[10.5px]" style={{ color: 'var(--shell-muted, #9a8b70)' }}>
                    {formatDate(preset.created_at)}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void onDelete(preset.id)}
                  aria-label={`${t('docs.savedPresets.delete', 'حذف')} — ${preset.name}`}
                  title={t('docs.savedPresets.delete', 'حذف')}
                  className="shrink-0 rounded-md p-1 transition-colors"
                  style={{ color: 'var(--shell-muted, #9a8b70)' }}
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
