'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Document, normalizeMediaUrl } from '@/lib/api';
import { useI18n } from '@/components/i18n/I18nProvider';
import { useLocalizedPath } from '@/lib/i18n/navigation';

interface DocumentHeroProps {
  document: Document;
  currentPage: number;
  totalPages: number;
  isBookmarked: boolean;
  onStartReading: () => void;
  onToggleBookmark: () => void;
  onShare: () => void;
  onOpenInfo: () => void;
}

const DESCRIPTION_COLLAPSED_LENGTH = 220;

export default function DocumentHero({
  document,
  currentPage,
  totalPages,
  isBookmarked,
  onStartReading,
  onToggleBookmark,
  onShare,
  onOpenInfo,
}: DocumentHeroProps) {
  const { t } = useI18n();
  const localizedPath = useLocalizedPath();
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);

  const coverUrl = useMemo(
    () => normalizeMediaUrl(document.cover_photo_url) || normalizeMediaUrl(document.thumbnail_url),
    [document.cover_photo_url, document.thumbnail_url]
  );

  const description = document.description?.trim() || '';
  const isLongDescription = description.length > DESCRIPTION_COLLAPSED_LENGTH;

  const processingStatus = document.processing_status;
  const isReady = processingStatus ? processingStatus === 'succeeded' : document.processed;
  const isFailed = processingStatus === 'failed';

  const monogram = (document.title?.trim()?.charAt(0) || '?').toUpperCase();

  const continueLabel =
    currentPage > 1
      ? t('reader.continueFrom', 'Continue from page {page}', { page: currentPage })
      : t('reader.startReading', 'Start reading');

  return (
    <section
      data-hero-root
      className="border-b border-border-cream bg-gradient-to-b from-ivory via-ivory to-parchment/60 px-4 pt-10 pb-8 md:px-8"
      aria-label={document.title}
    >
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 flex items-center justify-between">
          <Link
            href={localizedPath('/documents')}
            className="inline-flex items-center gap-2 rounded-lg px-2 py-1 text-sm font-medium text-olive-gray transition-colors hover:bg-warm-sand/60 hover:text-terracotta"
          >
            <svg
              className="h-4 w-4 rtl:-scale-x-100"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            {t('reader.library', 'Library')}
          </Link>
        </div>

        <div className="grid grid-cols-12 gap-6 md:gap-8">
          {/* Cover */}
          <div className="col-span-4 md:col-span-3">
            <div className="relative overflow-hidden rounded-2xl bg-warm-sand ring-1 ring-teal-600/10 shadow-whisper aspect-[3/4] max-w-[160px] md:max-w-none mx-auto">
              {coverUrl ? (
                <img
                  src={coverUrl}
                  alt={document.title}
                  className="h-full w-full object-cover"
                  loading="eager"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-terracotta/80 to-terracotta-soft/90 text-6xl font-serif text-ivory md:text-7xl">
                  <bdi>{monogram}</bdi>
                </div>
              )}
            </div>
          </div>

          {/* Meta + CTAs */}
          <div className="col-span-8 md:col-span-9 flex flex-col gap-4">
            <div>
              <h1 className="font-serif text-2xl leading-tight text-near-black md:text-4xl">
                <bdi>{document.title}</bdi>
              </h1>

              {/* Authors + Date + Language */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {document.authors?.map((author) => (
                  <span
                    key={author.id}
                    className="rounded-full bg-stone-100 px-3 py-1 text-xs font-medium text-charcoal-warm"
                  >
                    {author.name}
                  </span>
                ))}
                {document.written_date && (
                  <span className="rounded-full bg-amber-50 px-3 py-1 text-xs text-amber-900">
                    {t('reader.writtenIn', 'Written: {date}', { date: document.written_date })}
                  </span>
                )}
                {document.language && (
                  <span className="rounded-full border border-border-warm bg-ivory px-3 py-1 text-xs font-medium uppercase text-olive-gray">
                    {document.language}
                  </span>
                )}
              </div>

              {/* Categories */}
              {document.categories && document.categories.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {document.categories.map((category) => {
                    const key = typeof category === 'string' ? category : String(category.id);
                    const name = typeof category === 'string' ? category : category.name;
                    return (
                      <span
                        key={key}
                        className="rounded-full bg-teal-50 px-2.5 py-0.5 text-[11px] font-medium text-teal-800"
                      >
                        {name}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Description */}
            {description && (
              <div className="text-sm leading-6 text-olive-gray">
                <p className={descriptionExpanded ? '' : 'line-clamp-3'}>{description}</p>
                {isLongDescription && (
                  <button
                    type="button"
                    onClick={() => setDescriptionExpanded((prev) => !prev)}
                    className="mt-1 text-xs font-semibold text-teal-700 hover:text-teal-900"
                  >
                    {descriptionExpanded
                      ? t('reader.showLess', 'Show less')
                      : t('reader.readMore', 'Read more')}
                  </button>
                )}
              </div>
            )}

            {/* CTAs */}
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 snap-x md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
              {isReady ? (
                <button
                  type="button"
                  onClick={onStartReading}
                  className="snap-start whitespace-nowrap rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:ring-offset-2"
                >
                  {continueLabel}
                  {totalPages > 0 && (
                    <span className="ms-2 text-xs font-normal text-white/80">
                      · {totalPages}
                    </span>
                  )}
                </button>
              ) : (
                <span
                  className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold ${
                    isFailed
                      ? 'bg-red-50 text-red-700'
                      : 'bg-amber-50 text-amber-800'
                  }`}
                >
                  {!isFailed && (
                    <span
                      className="h-3 w-3 animate-spin rounded-full border-2 border-amber-600 border-t-transparent"
                      aria-hidden="true"
                    />
                  )}
                  {isFailed
                    ? t('reader.processingFailed', 'Processing failed')
                    : t('reader.processing', 'Processing...')}
                </span>
              )}

              <button
                type="button"
                onClick={onToggleBookmark}
                aria-pressed={isBookmarked}
                className={`snap-start inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
                  isBookmarked
                    ? 'border-teal-500 bg-teal-50 text-teal-800'
                    : 'border-border-warm bg-white text-olive-gray hover:border-teal-300 hover:text-teal-800'
                }`}
              >
                <svg
                  className="h-4 w-4"
                  fill={isBookmarked ? 'currentColor' : 'none'}
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
                  />
                </svg>
                {t('sidebar.bookmarks', 'Bookmarks')}
              </button>

              <button
                type="button"
                onClick={onShare}
                className="snap-start inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-border-warm bg-white px-3 py-2.5 text-sm font-medium text-olive-gray transition-colors hover:border-teal-300 hover:text-teal-800"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
                  />
                </svg>
                {t('reader.share', 'Share')}
              </button>

              <button
                type="button"
                onClick={onOpenInfo}
                className="snap-start inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-border-warm bg-white px-3 py-2.5 text-sm font-medium text-olive-gray transition-colors hover:border-teal-300 hover:text-teal-800"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                {t('reader.info', 'Info')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
