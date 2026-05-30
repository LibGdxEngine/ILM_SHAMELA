'use client';

import { useI18n } from '@/components/i18n/I18nProvider';
import { toLocaleDigits } from '@/lib/utils';

export interface TopicShortcut {
  name: string;
  count: number;
  seeds: string[];
}

interface LibraryTopicShortcutsProps {
  topics: TopicShortcut[];
  onSelect: (name: string) => void;
}

const SPINE_GRADIENTS = [
  'from-[#c96442] to-[#7c4a2b]',
  'from-[#2c3a4a] to-[#141413]',
  'from-[#3a4a34] to-[#1f2a1b]',
  'from-[#a16207] to-[#4d3210]',
];

function pickGradient(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  return SPINE_GRADIENTS[Math.abs(hash) % SPINE_GRADIENTS.length];
}

export default function LibraryTopicShortcuts({ topics, onSelect }: LibraryTopicShortcutsProps) {
  const { t, locale } = useI18n();

  if (topics.length < 2) return null;

  return (
    <section className="mb-12">
      <div className="mb-5">
        <span className="text-[11px] tracking-[0.18em] uppercase text-accent font-medium">
          {t('docs.zoneB.eyebrow', 'تنقّل')}
        </span>
        <h2 className="mt-2 font-reem-kufi font-semibold text-[clamp(20px,2.2vw,26px)] leading-[1.15] text-text">
          {t('docs.zoneB.title', 'اقفز إلى موضوع')}
        </h2>
      </div>

      <ul className="-mx-2 flex gap-3 overflow-x-auto px-2 pb-2 md:grid md:grid-cols-3 md:overflow-visible md:gap-3 lg:grid-cols-6">
        {topics.map((topic) => {
          const seeds = topic.seeds.slice(0, 3);
          while (seeds.length < 3) seeds.push(topic.name);
          return (
            <li key={topic.name} className="flex-shrink-0 w-44 md:w-auto">
              <button
                type="button"
                onClick={() => onSelect(topic.name)}
                className="group w-full text-start flex items-center gap-3 rounded-[14px] border border-border bg-card hover:bg-accent-soft/40 hover:border-accent/40 transition-all px-3.5 py-3 h-[72px]"
                aria-label={topic.name}
              >
                <span className="flex-1 min-w-0">
                  <span className="block font-reem-kufi text-[14px] text-text truncate group-hover:text-accent-2 transition-colors">
                    {topic.name}
                  </span>
                  <span className="mt-1 block text-[11.5px] text-text-3 tracking-wide">
                    {t('docs.zoneB.topicCount', '{n} كتاباً', { n: toLocaleDigits(topic.count, locale) })}
                  </span>
                </span>

                <span className="relative w-12 h-12 flex-shrink-0" aria-hidden>
                  {seeds.map((seed, i) => (
                    <span
                      key={`${seed}-${i}`}
                      className={`absolute top-1 bottom-1 w-3.5 rounded-[3px] bg-gradient-to-b ${pickGradient(seed)} border border-black/10 shadow-[0_1px_2px_rgba(0,0,0,0.12)]`}
                      style={{ insetInlineStart: `${i * 12}px` }}
                    />
                  ))}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
