'use client';

import { useI18n } from '@/components/i18n/I18nProvider';
import type { ChatContextScope, ChatPin } from '@/lib/api/reader';

interface AssistantContextBarProps {
  scope: ChatContextScope;
  onScopeChange: (scope: ChatContextScope) => void;
  pins: ChatPin[];
  onRemovePin: (index: number) => void;
  onClearPins: () => void;
  currentPage: number;
  disabled?: boolean;
}

const SCOPE_ORDER: Array<{ value: ChatContextScope; key: string; fallback: string }> = [
  { value: 'page', key: 'assistant.scope.page', fallback: 'This page' },
  { value: 'book', key: 'assistant.scope.book', fallback: 'Whole book' },
  { value: 'auto', key: 'assistant.scope.auto', fallback: 'Auto' },
];

/**
 * Session-context controls shown above the assistant input: a scope segmented
 * toggle (page / book / auto), the current-page indicator (when scope is page)
 * and any pinned snippets as removable chips. Owns the page badge that used to
 * live in `AssistantInput`.
 */
export default function AssistantContextBar({
  scope,
  onScopeChange,
  pins,
  onRemovePin,
  onClearPins,
  currentPage,
  disabled,
}: AssistantContextBarProps) {
  const { t } = useI18n();

  return (
    <div className="border-t border-border px-3 py-2.5">
      {/* Row 1: scope segmented toggle */}
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[11px] text-text-3">{t('assistant.scope.label', 'Context')}</span>
        <div className="grid flex-1 grid-cols-3 gap-[4px] rounded-[10px] bg-bg-2/70 p-[3px]">
          {SCOPE_ORDER.map((entry) => {
            const on = entry.value === scope;
            return (
              <button
                key={entry.value}
                type="button"
                onClick={() => onScopeChange(entry.value)}
                disabled={disabled}
                aria-pressed={on}
                className={`flex items-center justify-center whitespace-nowrap rounded-[7px] px-0 py-1.5 text-[11.5px] font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                  on ? 'bg-accent-soft text-accent shadow-[0_1px_3px_rgba(0,0,0,0.08)]' : 'text-text-3 hover:text-text-2'
                }`}
              >
                {t(entry.key, entry.fallback)}
              </button>
            );
          })}
        </div>
        {scope === 'page' && (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-accent">
            <span aria-hidden>✦</span>
            {t('assistant.input.contextBadge', 'Context: page {page}', { page: currentPage })}
          </span>
        )}
      </div>

      {/* Row 2: pinned snippets */}
      {pins.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {pins.map((pin, index) => (
            <span
              key={`${pin.page}-${index}`}
              className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-accent"
            >
              <span className="max-w-[150px] truncate">{pin.label || pin.text.slice(0, 40)}</span>
              <span className="opacity-70">· {pin.page}</span>
              <button
                type="button"
                onClick={() => onRemovePin(index)}
                disabled={disabled}
                aria-label={t('assistant.context.removePin', 'Remove')}
                title={t('assistant.context.removePin', 'Remove')}
                className="ms-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={onClearPins}
            disabled={disabled}
            className="text-[11px] text-text-3 underline-offset-2 transition-colors hover:text-text-2 hover:underline disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('assistant.context.clear', 'Clear context')}
          </button>
        </div>
      )}
    </div>
  );
}
