'use client';

import { useState } from 'react';

import { useI18n } from '@/components/i18n/I18nProvider';

export interface PresetSaveFormProps {
  /** Rejects with the backend message (e.g. duplicate name) — shown inline. */
  onSave: (name: string) => Promise<unknown>;
  /** Disable the trigger when there is nothing worth saving. */
  disabled?: boolean;
}

/**
 * The "save current filters as…" affordance shared by the presets pane and
 * the console footer: a trigger that expands into a name input, Enter saves,
 * Escape collapses, and a backend rejection (duplicate name) surfaces inline.
 * Ported from `FilterSidebar`'s `SavedPresetsSection` submit/error logic.
 */
export default function PresetSaveForm({ onSave, disabled = false }: PresetSaveFormProps) {
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
      await onSave(name);
      setDraft('');
      setAdding(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('docs.savedPresets.saveError', 'تعذّر الحفظ'));
    } finally {
      setSaving(false);
    }
  };

  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => {
          setAdding(true);
          setError(null);
        }}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        style={{ color: 'var(--accent, #b07d2b)' }}
      >
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
        </svg>
        {t('docs.savedPresets.saveCurrent', 'احفظ المرشِّحات الحالية…')}
      </button>
    );
  }

  return (
    <div className="min-w-0">
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
              // Claim the Esc — collapse the form, keep the dialog open.
              e.preventDefault();
              setAdding(false);
              setDraft('');
              setError(null);
            }
          }}
          placeholder={t('docs.savedPresets.namePlaceholder', 'اسم المُرشِّح…')}
          aria-label={t('docs.savedPresets.namePlaceholder', 'اسم المُرشِّح…')}
          dir="auto"
          className="w-full min-w-0 rounded-[10px] border px-3 py-1.5 font-fraunces text-[12.5px] outline-none transition-all"
          style={{
            background: 'var(--shell-surface, #fcf8ee)',
            color: 'var(--shell-ink, #2c2620)',
            borderColor: 'var(--shell-line, #e2d5ba)',
          }}
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={saving || !draft.trim()}
          className="shrink-0 rounded-full border px-3 py-1 text-[11.5px] transition-all disabled:opacity-50"
          style={{
            background: 'var(--accent, #b07d2b)',
            borderColor: 'var(--accent, #b07d2b)',
            color: 'var(--shell-on-accent, #fcf8ee)',
          }}
        >
          {t('docs.savedPresets.save', 'حفظ')}
        </button>
      </div>
      {error && (
        <p className="mt-1.5 text-[11px] text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
