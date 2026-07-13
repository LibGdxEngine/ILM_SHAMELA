'use client';

import { useI18n } from '@/components/i18n/I18nProvider';
import type {
  CorpusFilterHandlers,
  CorpusFilterState,
} from '@/lib/search/useCorpusSearchState';
import ActiveFilterChips from './ActiveFilterChips';
import PresetSaveForm from './PresetSaveForm';

export interface ActiveFiltersFooterProps {
  filters: CorpusFilterState;
  handlers: CorpusFilterHandlers;
  /** Present only when the surface has preset wiring (signed-in). */
  onSavePreset?: (name: string) => Promise<unknown>;
  canSaveCurrent: boolean;
  /** Plain (non-AI) search — enabled whenever q or any filter is active. */
  onPlainSubmit: () => void;
  plainDisabled: boolean;
  /** AI search — needs a query; shows the pending treatment. */
  onAiSubmit: () => void;
  aiDisabled: boolean;
  aiPending: boolean;
}

/**
 * The console's sticky footer: every active selection as a removable chip
 * (the header input owns `q`), the save-as-preset affordance, and the two
 * submit buttons.
 */
export default function ActiveFiltersFooter({
  filters,
  handlers,
  onSavePreset,
  canSaveCurrent,
  onPlainSubmit,
  plainDisabled,
  onAiSubmit,
  aiDisabled,
  aiPending,
}: ActiveFiltersFooterProps) {
  const { t } = useI18n();

  return (
    <div
      className="border-t px-4 py-3"
      style={{ borderColor: 'var(--shell-line, #e2d5ba)', background: 'var(--shell-surface, #fcf8ee)' }}
    >
      <div className="empty:hidden [&:not(:empty)]:mb-3">
        <ActiveFilterChips filters={filters} handlers={handlers} />
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        {onSavePreset && (
          <div className="min-w-0 flex-1">
            <PresetSaveForm onSave={onSavePreset} disabled={!canSaveCurrent} />
          </div>
        )}
        <div className="ms-auto flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onPlainSubmit}
            disabled={plainDisabled}
            className="rounded-[10px] border px-4 py-2 text-[13px] font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              borderColor: 'var(--accent, #b07d2b)',
              color: 'var(--accent, #b07d2b)',
              background: 'transparent',
            }}
          >
            {t('nav.search.submit', 'بحث')}
          </button>
          <button
            type="button"
            onClick={onAiSubmit}
            disabled={aiDisabled}
            className="rounded-[10px] px-4 py-2 text-[13px] font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50"
            style={{ background: 'var(--accent, #b07d2b)', color: 'var(--shell-on-accent, #fcf8ee)' }}
          >
            {aiPending
              ? t('docs.palette.interpreting', 'يفسّر الذكاء الاصطناعي طلبك…')
              : t('docs.palette.submit', 'ابحث بالذكاء الاصطناعي')}
          </button>
        </div>
      </div>
    </div>
  );
}
