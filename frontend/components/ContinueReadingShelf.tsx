'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/AuthContext';
import { useContinueReading } from '@/lib/reader/useContinueReading';
import { useLocalizedPath } from '@/lib/i18n/navigation';
import { useI18n } from '@/components/i18n/I18nProvider';
import { normalizeMediaUrl } from '@/lib/api';

const FALLBACK_GRADIENTS = [
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
  return FALLBACK_GRADIENTS[Math.abs(hash) % FALLBACK_GRADIENTS.length];
}

export default function ContinueReadingShelf() {
  const { t } = useI18n();
  const { isAuthenticated } = useAuth();
  const localizedPath = useLocalizedPath();
  const { data, isLoading } = useContinueReading(8);

  if (!isAuthenticated) return null;
  if (isLoading) return null;
  if (!data || data.length === 0) return null;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex items-end justify-between">
        <h2 className="font-serif text-2xl font-medium text-near-black dark:text-ivory md:text-[32px]">
          {t('home.continueReading', 'Continue reading')}
        </h2>
      </div>
      <div className="-mx-2 flex gap-4 overflow-x-auto px-2 pb-2 md:grid md:grid-cols-4 md:overflow-visible">
        {data.map((item) => {
          const cover = normalizeMediaUrl(item.cover_photo_url ?? item.thumbnail_url);
          const percent = Math.max(0, Math.min(100, Math.round((item.percent_complete ?? 0) * 100)));
          const gradient = pickGradient(item.document_title);
          return (
            <Link
              key={item.document}
              href={localizedPath(`/documents/${item.document}`)}
              className="group block w-44 flex-shrink-0 md:w-auto"
            >
              <div
                className={`relative aspect-[3/4] overflow-hidden rounded-xl bg-gradient-to-br ${gradient} shadow-whisper ring-1 ring-black/5 transition-transform duration-300 group-hover:-translate-y-1 group-hover:shadow-[0_16px_40px_-12px_rgba(20,20,19,0.25)]`}
              >
                {cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={cover} alt={item.document_title} className="absolute inset-0 h-full w-full object-cover" />
                ) : (
                  <div className="absolute inset-x-4 bottom-5">
                    <p className="font-serif text-[15px] leading-[1.25] text-ivory line-clamp-3">
                      {item.document_title}
                    </p>
                  </div>
                )}
                <div className="absolute inset-x-0 bottom-0 h-1 bg-black/30">
                  <div className="h-full bg-terracotta" style={{ width: `${percent}%` }} aria-hidden />
                </div>
              </div>
              <div className="mt-3">
                <p className="font-serif text-sm font-medium text-near-black line-clamp-2 dark:text-ivory">
                  {item.document_title}
                </p>
                <p className="mt-1 font-sans text-[12px] text-olive-gray dark:text-warm-silver">
                  {t('home.percentRead', '{percent}% read', { percent })}
                  {item.total_pages > 0 && (
                    <>
                      {' · '}
                      {t('home.pageOfTotal', 'Page {n} of {total}', {
                        n: item.last_page,
                        total: item.total_pages,
                      })}
                    </>
                  )}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
