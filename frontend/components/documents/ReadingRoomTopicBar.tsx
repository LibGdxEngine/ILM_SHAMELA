'use client';

import { useQuery } from '@tanstack/react-query';
import { getCategories } from '@/lib/api';
import { useI18n } from '@/components/i18n/I18nProvider';

interface ReadingRoomTopicBarProps {
  selectedCategories: string[];
  onToggleCategory: (name: string) => void;
  onClearCategories: () => void;
  /** How many topic chips to surface (most populous categories first). */
  limit?: number;
}

/**
 * "Browse by topic" chip row from the Reading Room design. Topics are real
 * categories pulled from the backend, so tapping one drives the page's actual
 * category filter (server-side refetch) rather than a cosmetic toggle.
 */
export default function ReadingRoomTopicBar({
  selectedCategories,
  onToggleCategory,
  onClearCategories,
  limit = 9,
}: ReadingRoomTopicBarProps) {
  const { t } = useI18n();

  const { data } = useQuery({
    queryKey: ['categories', 'reading-room-topics'],
    queryFn: () => getCategories(),
    staleTime: 5 * 60 * 1000,
  });

  // Keep any selected topics visible even if they fall outside the top slice,
  // so an active filter can always be toggled back off from the bar.
  const topics = (() => {
    const names = (data?.results ?? []).map((c) => c.name).filter(Boolean);
    const base = names.slice(0, limit);
    const set = new Set(base);
    for (const s of selectedCategories) {
      if (!set.has(s)) {
        base.push(s);
        set.add(s);
      }
    }
    return base;
  })();

  if (topics.length === 0) return null;

  const allActive = selectedCategories.length === 0;

  return (
    <div className="flex items-center gap-2.5 overflow-x-auto hide-scrollbar py-1">
      <span className="text-[12.5px] text-[#9a8b70] me-1 whitespace-nowrap flex-shrink-0">
        {t('docs.rr.browseByTopic', 'تصفّح حسب الموضوع')}
      </span>
      <button
        type="button"
        onClick={onClearCategories}
        aria-pressed={allActive}
        className="rr-chip rr-chip-all flex-shrink-0"
      >
        {t('docs.rr.allTopics', 'الكل')}
      </button>
      {topics.map((name) => {
        const on = selectedCategories.includes(name);
        return (
          <button
            key={name}
            type="button"
            onClick={() => onToggleCategory(name)}
            aria-pressed={on}
            className="rr-chip flex-shrink-0"
            title={name}
          >
            <span dir="auto">{name}</span>
          </button>
        );
      })}
    </div>
  );
}
