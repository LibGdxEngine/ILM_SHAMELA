'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Document, normalizeMediaUrl } from '@/lib/api';
import { useI18n } from '@/components/i18n/I18nProvider';
import { useLocalizedPath } from '@/lib/i18n/navigation';
import LanguageSwitcher from '@/components/i18n/LanguageSwitcher';

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

const COVER_PALETTE = [
  { from: '#2a1a10', to: '#4a2818' },
  { from: '#1a2a2e', to: '#2c4145' },
  { from: '#2e1a26', to: '#4a2c3e' },
  { from: '#1a2818', to: '#2a4424' },
  { from: '#2e2418', to: '#4a3a24' },
  { from: '#1f1a2c', to: '#2e2848' },
];

function paletteFor(str: string) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COVER_PALETTE[Math.abs(hash) % COVER_PALETTE.length];
}

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
  const palette = paletteFor(document.title || '');

  const continueLabel =
    currentPage > 1
      ? t('reader.continueFrom', 'Continue from page {page}', { page: currentPage })
      : t('reader.startReading', 'Start reading');

  return (
    <section
      data-hero-root
      className="landing-shell border-b border-border px-6 sm:px-10 lg:px-16 pt-10 pb-12 relative overflow-hidden"
      aria-label={document.title}
    >
      <div className="mx-auto max-w-5xl relative z-10">
        {/* Top bar */}
        <div className="mb-8 flex items-center justify-between">
          <Link
            href={localizedPath('/documents')}
            className="inline-flex items-center gap-2 text-[13px] text-text-3 transition-colors hover:text-accent-2"
          >
            <svg
              className="h-4 w-4 rtl:-scale-x-100"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={1.8}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            {t('reader.library', 'Library')}
          </Link>

          <div className="flex items-center gap-4 sm:gap-6">
            <Link
              href={localizedPath('/')}
              className="hidden sm:flex items-center gap-2 font-fraunces"
            >
              <span className="text-[22px] text-accent-2 leading-none">ع</span>
              <span className="text-[16px] tracking-tight text-text">
                ILM <em className="italic text-text-2">Shamela</em>
              </span>
            </Link>
            <LanguageSwitcher />
          </div>
        </div>

        <div className="grid grid-cols-12 gap-6 md:gap-10">
          {/* Cover */}
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="col-span-4 md:col-span-3"
          >
            <div
              className="relative overflow-hidden rounded-[14px] border border-black/40 shadow-[0_18px_44px_-14px_rgba(0,0,0,0.6),inset_8px_0_0_rgba(0,0,0,0.25),inset_11px_0_0_rgba(255,255,255,0.04)] aspect-[3/4] max-w-[170px] md:max-w-none mx-auto"
              style={{ background: `linear-gradient(135deg, ${palette.from}, ${palette.to})` }}
            >
              {coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={coverUrl}
                  alt={document.title}
                  className="h-full w-full object-cover"
                  loading="eager"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center font-fraunces text-6xl text-[#ecdcb8]/90 md:text-7xl">
                  <bdi>{monogram}</bdi>
                </div>
              )}
            </div>
          </motion.div>

          {/* Meta + CTAs */}
          <div className="col-span-8 md:col-span-9 flex flex-col gap-5">
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1], delay: 0.05 }}
            >
              <span className="section-eyebrow">{t('reader.eyebrow', 'Now reading')}</span>
              <h1 className="font-fraunces font-light text-[clamp(28px,4vw,48px)] leading-[1.05] tracking-tight mt-4 text-text">
                <bdi>{document.title}</bdi>
              </h1>

              {/* Authors + Date + Language */}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {document.authors?.map((author) => (
                  <span
                    key={author.id}
                    className="rounded-full border border-accent/30 bg-accent-soft px-3 py-1 text-[12px] text-accent-2 font-fraunces italic"
                  >
                    {author.name}
                  </span>
                ))}
                {document.written_date && (
                  <span className="rounded-full border border-border-strong bg-white/[0.03] px-3 py-1 text-[12px] text-text-2">
                    {t('reader.writtenIn', 'Written: {date}', { date: document.written_date })}
                  </span>
                )}
                {document.language && (
                  <span className="rounded-full border border-border-strong bg-white/[0.03] px-3 py-1 text-[11px] tracking-[0.12em] uppercase text-text-2">
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
                        className="rounded-full border border-border-strong bg-white/[0.04] px-2.5 py-0.5 text-[11px] text-text-3"
                      >
                        {name}
                      </span>
                    );
                  })}
                </div>
              )}
            </motion.div>

            {/* Description */}
            {description && (
              <motion.div
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1], delay: 0.12 }}
                className="text-[14.5px] leading-[1.7] text-text-2 max-w-2xl"
              >
                <p className={descriptionExpanded ? '' : 'line-clamp-3'}>{description}</p>
                {isLongDescription && (
                  <button
                    type="button"
                    onClick={() => setDescriptionExpanded((prev) => !prev)}
                    className="mt-2 text-[12.5px] font-medium text-accent-2 hover:text-text transition-colors"
                  >
                    {descriptionExpanded
                      ? t('reader.showLess', 'Show less')
                      : t('reader.readMore', 'Read more')}
                  </button>
                )}
              </motion.div>
            )}

            {/* CTAs */}
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1], delay: 0.18 }}
              className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 snap-x md:mx-0 md:flex-wrap md:overflow-visible md:px-0"
            >
              {isReady ? (
                <button
                  type="button"
                  onClick={onStartReading}
                  className="btn-primary snap-start whitespace-nowrap !rounded-[14px] !px-5 !py-3 !text-[14px] inline-flex items-center gap-2"
                >
                  {continueLabel}
                  {totalPages > 0 && (
                    <span className="text-[12px] font-normal opacity-70">
                      · {totalPages}
                    </span>
                  )}
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M5 12h14M13 5l7 7-7 7" />
                  </svg>
                </button>
              ) : (
                <span
                  className={`inline-flex items-center gap-2 rounded-full border px-4 py-2.5 text-[13px] font-medium ${
                    isFailed
                      ? 'border-red-500/40 bg-red-500/10 text-red-200'
                      : 'border-accent/40 bg-accent-soft text-accent-2'
                  }`}
                >
                  {!isFailed && (
                    <span
                      className="h-3 w-3 animate-spin rounded-full border-2 border-accent-2 border-t-transparent"
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
                className={`snap-start inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-4 py-2.5 text-[13px] transition-all ${
                  isBookmarked
                    ? 'border-accent/40 bg-accent-soft text-accent-2'
                    : 'border-border-strong bg-white/[0.03] text-text hover:border-accent hover:text-accent-2'
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
                    strokeWidth={1.8}
                    d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
                  />
                </svg>
                {t('sidebar.bookmarks', 'Bookmarks')}
              </button>

              <button
                type="button"
                onClick={onShare}
                className="snap-start inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-border-strong bg-white/[0.03] px-4 py-2.5 text-[13px] text-text transition-all hover:border-accent hover:text-accent-2"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} aria-hidden="true">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
                  />
                </svg>
                {t('reader.share', 'Share')}
              </button>

              <button
                type="button"
                onClick={onOpenInfo}
                className="snap-start inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-border-strong bg-white/[0.03] px-4 py-2.5 text-[13px] text-text transition-all hover:border-accent hover:text-accent-2"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} aria-hidden="true">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                {t('reader.info', 'Info')}
              </button>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}
