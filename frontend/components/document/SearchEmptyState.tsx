'use client';

// Empty (no-query) state for the Reader & Search v2 panel: usage hint plus
// three chip sections — recent searches, pinned terms, and words from the
// current chapter. Sections hide themselves when empty.

import { useI18n } from '@/components/i18n/I18nProvider';

interface SearchEmptyStateProps {
  recents: string[];
  pinned: string[];
  suggestions: string[];
  onPick: (term: string) => void;
}

function Chip({ term, withPin, onClick }: { term: string; withPin?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex cursor-pointer items-center gap-1.5 rounded-[9px] px-3 py-[5px] text-[12.5px]"
      style={{ background: 'var(--rr-surface)', border: '1px solid var(--rr-line)', color: '#4a4236' }}
    >
      {withPin && (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--rr-brand)" strokeWidth="2" aria-hidden>
          <path d="M12 17v5M7 4h10l-1.5 7.5L17 14H7l1.5-2.5z" />
        </svg>
      )}
      {term}
    </button>
  );
}

function SectionHead({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="mb-[9px] mt-[18px] flex items-center gap-[7px]">
      {icon}
      <span className="text-[11px] font-semibold tracking-[0.1em]" style={{ color: 'var(--rr-ink-4)' }}>
        {label}
      </span>
    </div>
  );
}

export default function SearchEmptyState({ recents, pinned, suggestions, onPick }: SearchEmptyStateProps) {
  const { t } = useI18n();
  return (
    <>
      <div className="px-1.5 pb-1 pt-2.5 text-center">
        <div className="mx-auto mb-3 flex h-[46px] w-[46px] items-center justify-center rounded-[13px]" style={{ background: '#e9dcbe' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--rr-brand)" strokeWidth="1.8" aria-hidden>
            <path d="M9 3h6M12 3v6M5.5 12.5l-2 6.5a1 1 0 0 0 1.3 1.2l5.2-2 5.2 2a1 1 0 0 0 1.3-1.2l-2-6.5" />
            <circle cx="12" cy="9" r="3.2" />
          </svg>
        </div>
        <div className="mx-auto max-w-[250px] text-[13px] leading-[1.75]" style={{ color: 'var(--rr-ink-2)' }}>
          {t('reader.search.empty.hint', 'انقر أيّ كلمة في النص، أو حدِّد عبارةً بالماوس، أو اكتب مصطلحًا أعلاه.')}
        </div>
      </div>

      {recents.length > 0 && (
        <>
          <SectionHead
            icon={
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--rr-ink-4)" strokeWidth="2" aria-hidden>
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
            }
            label={t('reader.search.recent', 'عمليات بحث أخيرة')}
          />
          <div className="flex flex-wrap gap-2">
            {recents.map((term) => (
              <Chip key={term} term={term} onClick={() => onPick(term)} />
            ))}
          </div>
        </>
      )}

      {pinned.length > 0 && (
        <>
          <SectionHead
            icon={
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--rr-brand)" strokeWidth="2" aria-hidden>
                <path d="M12 17v5M7 4h10l-1.5 7.5L17 14H7l1.5-2.5z" />
              </svg>
            }
            label={t('reader.search.pinnedTerms', 'مصطلحات مثبَّتة')}
          />
          <div className="flex flex-wrap gap-2">
            {pinned.map((term) => (
              <Chip key={term} term={term} withPin onClick={() => onPick(term)} />
            ))}
          </div>
        </>
      )}

      {suggestions.length > 0 && (
        <>
          <SectionHead icon={null} label={t('reader.search.chapterWords', 'كلمات من هذا الفصل')} />
          <div className="flex flex-wrap gap-2">
            {suggestions.map((term) => (
              <Chip key={term} term={term} onClick={() => onPick(term)} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
