'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { Document, normalizeMediaUrl } from '@/lib/api';
import { useI18n } from '@/components/i18n/I18nProvider';
import { useLocalizedPath } from '@/lib/i18n/navigation';

interface CompactReaderHeaderProps {
  document: Document;
  currentPage: number;
  totalPages: number;
  isVisible: boolean;
}

export default function CompactReaderHeader({
  document,
  currentPage,
  totalPages,
  isVisible,
}: CompactReaderHeaderProps) {
  const { t } = useI18n();
  const localizedPath = useLocalizedPath();

  const coverUrl = useMemo(
    () => normalizeMediaUrl(document.cover_photo_url) || normalizeMediaUrl(document.thumbnail_url),
    [document.cover_photo_url, document.thumbnail_url]
  );

  const monogram = (document.title?.trim()?.charAt(0) || '?').toUpperCase();

  return (
    <div
      className={`fixed inset-x-0 top-[3px] z-40 transform border-b border-border bg-bg/85 backdrop-blur-xl transition-transform duration-300 ease-out ${
        isVisible ? 'translate-y-0' : '-translate-y-full'
      }`}
      aria-hidden={!isVisible}
    >
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2.5 md:px-6">
        <Link
          href={localizedPath('/documents')}
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12.5px] font-medium text-text-3 transition-colors hover:text-accent-2"
          aria-label={t('reader.backToLibrary', 'Back to library')}
        >
          <svg
            className="h-4 w-4 rtl:-scale-x-100"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
        </Link>

        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <div className="relative h-11 w-8 flex-shrink-0 overflow-hidden rounded-[6px] border border-border-strong bg-bg-2">
            {coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-accent-2 to-accent text-xs font-fraunces font-semibold text-[#1a0e05]">
                <bdi>{monogram}</bdi>
              </div>
            )}
          </div>
          <p className="line-clamp-1 min-w-0 flex-1 font-fraunces text-[14px] text-text md:text-[15.5px]">
            <bdi>{document.title}</bdi>
          </p>
        </div>

        <span className="rounded-full border border-border-strong bg-white/[0.03] px-2.5 py-1 text-[11px] tracking-wide text-text-2">
          {t('reader.pageOf', 'Page {current} of {total}', {
            current: currentPage,
            total: totalPages,
          })}
        </span>
      </div>
    </div>
  );
}
