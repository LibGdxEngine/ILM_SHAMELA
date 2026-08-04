'use client';

import { useI18n } from '@/components/i18n/I18nProvider';
import type { SearchScopeType } from '@/lib/search/terms';
import OptionListPane from './OptionListPane';
import type { ScopeSectionSpec } from './types';

const SCOPE_FALLBACK: Record<SearchScopeType, string> = {
  all: 'كل الكتب',
  mine: 'كتبي',
  selected: 'كتب محددة',
};

const SCOPE_HINT_FALLBACK: Record<SearchScopeType, string> = {
  all: 'يبحث في المكتبة كاملة.',
  mine: 'يقتصر البحث على الكتب التي رفعتَها بنفسك.',
  selected: 'اختر كتبًا بعينها ليقتصر البحث عليها.',
};

/** The search-scope radio group (كل الكتب / كتبي / كتب محددة); choosing
 *  "selected" reveals the book multi-select (the former books section). */
export default function ScopePane({ section }: { section: ScopeSectionSpec }) {
  const { t } = useI18n();

  const choices: SearchScopeType[] = section.showMine
    ? ['all', 'mine', 'selected']
    : ['all', 'selected'];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div role="radiogroup" aria-label={section.label} className="flex flex-col gap-1.5">
        {choices.map((choice) => {
          const on = choice === section.scope;
          return (
            <button
              key={choice}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => section.onScopeChange(choice)}
              className="flex items-start gap-2.5 rounded-[10px] border px-3 py-2 text-start transition-colors"
              style={
                on
                  ? {
                      background: 'color-mix(in srgb, var(--accent, #b07d2b) 12%, transparent)',
                      borderColor: 'color-mix(in srgb, var(--accent, #b07d2b) 45%, transparent)',
                    }
                  : {
                      background: 'transparent',
                      borderColor: 'var(--shell-line, #e2d5ba)',
                    }
              }
            >
              <span
                aria-hidden
                className="mt-[3px] inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border-2"
                style={{
                  borderColor: on
                    ? 'var(--accent, #b07d2b)'
                    : 'var(--shell-muted, #9a8b70)',
                }}
              >
                {on && (
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: 'var(--accent, #b07d2b)' }}
                  />
                )}
              </span>
              <span className="min-w-0">
                <span
                  className="block text-[13px] font-semibold"
                  style={{ color: 'var(--shell-ink, #2c2620)' }}
                >
                  {t(`nav.search.scope.${choice}`, SCOPE_FALLBACK[choice])}
                </span>
                <span
                  className="block text-[11.5px] leading-[1.6]"
                  style={{ color: 'var(--shell-muted, #9a8b70)' }}
                >
                  {t(`nav.search.scope.${choice}Hint`, SCOPE_HINT_FALLBACK[choice])}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {section.scope === 'selected' && (
        <div className="flex min-h-0 flex-1 flex-col">
          <OptionListPane section={section.books} />
        </div>
      )}
    </div>
  );
}
