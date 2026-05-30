'use client';

import Link from 'next/link';
import { normalizeMediaUrl } from '@/lib/api';
import { useAuth } from '@/lib/AuthContext';
import { useContinueReading } from '@/lib/reader/useContinueReading';
import { useLocalizedPath } from '@/lib/i18n/navigation';
import { useI18n } from '@/components/i18n/I18nProvider';
import Shelf from '@/components/documents/Shelf';
import { toLocaleDigits } from '@/lib/utils';

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

export default function ContinueShelf() {
  const { t, locale } = useI18n();
  const { isAuthenticated } = useAuth();
  const localizedPath = useLocalizedPath();
  const { data, isLoading } = useContinueReading(8);

  if (!isAuthenticated) return null;
  if (isLoading) return null;
  if (!data || data.length === 0) return null;

  return (
    <Shelf
      eyebrow={t('docs.shelf.continue', 'تابع القراءة')}
      title={t('docs.shelf.continue', 'تابع القراءة')}
    >
      {data.map((item) => {
        const cover = normalizeMediaUrl(item.cover_photo_url ?? item.thumbnail_url);
        const percent = Math.max(
          0,
          Math.min(100, Math.round((item.percent_complete ?? 0) * 100))
        );
        const gradient = pickGradient(item.document_title);
        return (
          <Link
            key={item.document}
            href={localizedPath(`/documents/${item.document}`)}
            className="group block w-44 flex-shrink-0 md:w-auto"
          >
            <div
              className={`relative aspect-[2/3] overflow-hidden rounded-[18px] bg-gradient-to-br ${gradient} border border-border shadow-[0_4px_20px_-8px_rgba(0,0,0,0.5)] transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-[0_12px_36px_-12px_rgba(192,133,82,0.25)]`}
            >
              {cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={cover}
                  alt={item.document_title}
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : (
                <div className="absolute inset-x-4 bottom-8">
                  <p className="font-fraunces text-[16px] leading-[1.25] text-[#faf6ef] line-clamp-3">
                    {item.document_title}
                  </p>
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 h-1 bg-black/30">
                <div
                  className="h-full bg-accent"
                  style={{ width: `${percent}%` }}
                  aria-hidden
                />
              </div>
            </div>
            <div className="mt-3">
              <p className="font-fraunces text-[14px] text-text line-clamp-2 group-hover:text-accent-2 transition-colors">
                {item.document_title}
              </p>
              <p className="mt-1 text-[11.5px] text-text-3 tracking-wide">
                {t('home.percentRead', '{percent}% read', {
                  percent: toLocaleDigits(percent, locale),
                })}
                {item.total_pages > 0 && (
                  <>
                    {' · '}
                    {t('home.pageOfTotal', 'Page {n} of {total}', {
                      n: toLocaleDigits(item.last_page, locale),
                      total: toLocaleDigits(item.total_pages, locale),
                    })}
                  </>
                )}
              </p>
            </div>
          </Link>
        );
      })}
    </Shelf>
  );
}
