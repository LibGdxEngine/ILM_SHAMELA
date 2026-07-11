'use client';

import Link from 'next/link';
import { normalizeMediaUrl } from '@/lib/api';
import { useAuth } from '@/lib/AuthContext';
import { useRecommendations } from '@/lib/reader/useRecommendations';
import type { ApiRecommendation } from '@/lib/api/recommendations';
import { trackEvent } from '@/lib/api/tracking';
import { useLocalizedPath } from '@/lib/i18n/navigation';
import { useI18n } from '@/components/i18n/I18nProvider';
import Shelf from '@/components/documents/Shelf';

// Mirrors ContinueShelf's cover fallback so the two shelves read as one system.
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

function reasonText(
  item: ApiRecommendation,
  t: ReturnType<typeof useI18n>['t'],
): string {
  switch (item.reason) {
    case 'more_by_author':
      return t('docs.rec.reason.more_by_author', 'More by {name}', {
        name: item.reason_detail ?? '',
      });
    case 'popular':
      return t('docs.rec.reason.popular', 'Popular in the library');
    case 'newest':
      return t('docs.rec.reason.newest', 'New in the library');
    case 'for_you':
    default:
      return t('docs.rec.reason.for_you', 'Based on your reading');
  }
}

export default function RecommendedShelf() {
  const { t } = useI18n();
  const { isAuthenticated } = useAuth();
  const localizedPath = useLocalizedPath();
  const { data, isLoading } = useRecommendations(12);

  if (!isAuthenticated) return null;
  if (isLoading) return null;
  if (!data || data.length === 0) return null;

  return (
    <Shelf
      eyebrow={t('docs.shelf.recommended', 'موصى به لك')}
      title={t('docs.shelf.recommended', 'موصى به لك')}
    >
      {data.map((item, index) => {
        const cover = normalizeMediaUrl(item.cover_photo_url ?? item.thumbnail_url);
        const gradient = pickGradient(item.title);
        return (
          <Link
            key={item.id}
            href={localizedPath(`/documents/${item.id}`)}
            onClick={() =>
              // Close the feedback loop: reuse the allowed 'suggestion_select'
              // event, disambiguated by source/metadata (no new backend type).
              trackEvent('suggestion_select', {
                documentId: item.id,
                source: 'recommendation_shelf',
                metadata: { position: index, reason: item.reason },
              })
            }
            className="group block w-44 flex-shrink-0 md:w-auto"
          >
            <div
              className={`relative aspect-[2/3] overflow-hidden rounded-[18px] bg-gradient-to-br ${gradient} border border-border shadow-[0_4px_20px_-8px_rgba(0,0,0,0.5)] transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-[0_12px_36px_-12px_rgba(192,133,82,0.25)]`}
            >
              {cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={cover}
                  alt={item.title}
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : (
                <div className="absolute inset-x-4 bottom-8">
                  <p className="font-fraunces text-[16px] leading-[1.25] text-[#faf6ef] line-clamp-3">
                    {item.title}
                  </p>
                </div>
              )}
            </div>
            <div className="mt-3">
              <p className="font-fraunces text-[14px] text-text line-clamp-2 group-hover:text-accent-2 transition-colors">
                {item.title}
              </p>
              <p className="mt-1 text-[11.5px] text-accent-2/90 tracking-wide line-clamp-1">
                {reasonText(item, t)}
              </p>
            </div>
          </Link>
        );
      })}
    </Shelf>
  );
}
