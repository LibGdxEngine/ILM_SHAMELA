'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Document, normalizeMediaUrl } from '@/lib/api';
import { useLocalizedPath } from '@/lib/i18n/navigation';
import { useI18n } from '@/components/i18n/I18nProvider';
import { paletteFor } from '@/lib/coverPalettes';
import { useLanguageName } from '@/lib/i18n/languageName';
import { fileTypeLabel, formatRelativeDate, toLocaleDigits } from '@/lib/utils';

interface BookCardProps {
  document: Document;
  /** Reading progress 0..100; when present the footer shows progress instead of date/type. */
  progressPercent?: number;
}

export default function BookCard({ document, progressPercent }: BookCardProps) {
  const { t, locale } = useI18n();
  const localizedPath = useLocalizedPath();
  const router = useRouter();
  const languageName = useLanguageName();

  const palette = paletteFor(document);
  const [imageError, setImageError] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);

  const coverPhotoUrl = normalizeMediaUrl(document.cover_photo_url ?? document.thumbnail_url);
  const hasPhoto = Boolean(coverPhotoUrl) && !imageError;
  const langDisplay = document.language ? languageName(document.language) : null;
  const fileType = fileTypeLabel(document.file);

  const isReady = document.processing_status
    ? document.processing_status === 'succeeded'
    : document.processed;

  const hasProgress = typeof progressPercent === 'number';
  const percent = hasProgress ? Math.max(0, Math.min(100, Math.round(progressPercent!))) : 0;

  const bookmarkKey = `ilm.bookmarks.${document.id}`;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setBookmarked(window.localStorage.getItem(bookmarkKey) === '1');
  }, [bookmarkKey]);

  const toggleBookmark = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setBookmarked((prev) => {
        const next = !prev;
        try {
          if (next) window.localStorage.setItem(bookmarkKey, '1');
          else window.localStorage.removeItem(bookmarkKey);
        } catch {}
        return next;
      });
    },
    [bookmarkKey]
  );

  const openAsk = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      router.push(localizedPath(`/documents/${document.id}?ask=1`));
    },
    [router, localizedPath, document.id]
  );

  const metaParts = [formatRelativeDate(document.uploaded_at, locale, t), fileType].filter(Boolean);

  return (
    <div className="group relative">
      <Link href={localizedPath(`/documents/${document.id}`)} className="block">
        <div className="relative aspect-[2/3] overflow-hidden rounded-[18px] border border-border bg-bg-2 shadow-[0_4px_20px_-8px_rgba(0,0,0,0.5)] transition-all duration-300 group-hover:-translate-y-1 group-hover:border-accent/40 group-hover:shadow-[0_12px_36px_-12px_rgba(192,133,82,0.25)]">
          {hasPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={coverPhotoUrl as string}
              alt={document.title}
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
              onError={() => setImageError(true)}
            />
          ) : (
            <div
              className="absolute inset-0 transition-transform duration-500 group-hover:scale-[1.03]"
              style={{ backgroundImage: `linear-gradient(135deg, ${palette.from}, ${palette.to})` }}
            >
              <div className="absolute inset-x-5 bottom-9">
                <p
                  dir="auto"
                  className="font-fraunces text-[15px] leading-[1.3] line-clamp-4"
                  style={{ color: palette.text }}
                >
                  {document.title}
                </p>
              </div>
            </div>
          )}

          <div
            className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/40 to-transparent pointer-events-none"
            aria-hidden
          />

          {langDisplay && (
            <div className="absolute top-3 start-3">
              <span className="px-2 py-0.5 text-[10.5px] tracking-[0.04em] rounded-full bg-bg/85 text-text-2 backdrop-blur-md border border-border-strong">
                {langDisplay}
              </span>
            </div>
          )}

          {!isReady && (
            <div className="absolute top-3 end-3">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10.5px] tracking-[0.08em] rounded-full bg-[var(--warm-deep)]/95 text-[#faf6ef] backdrop-blur-md">
                <span className="w-1.5 h-1.5 rounded-full bg-[#faf6ef]/80 animate-pulse" aria-hidden />
                {t('book.processing', 'قيد المعالجة')}
              </span>
            </div>
          )}

          {hasProgress && (
            <div className="absolute inset-x-0 bottom-0 h-1 bg-black/30">
              <div className="h-full bg-accent" style={{ width: `${percent}%` }} aria-hidden />
            </div>
          )}

          <button
            type="button"
            onClick={openAsk}
            className="absolute bottom-3 end-3 px-3 py-1.5 text-[11.5px] rounded-full bg-bg/85 text-text border border-border-strong backdrop-blur-md opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 focus:opacity-100 focus:translate-y-0 transition-all duration-200 hover:border-accent hover:text-accent-2"
            aria-label={t('docs.card.askAbout', 'اسأل عن هذا الكتاب')}
          >
            <span aria-hidden className="text-accent me-1">✦</span>
            {t('docs.card.askAbout', 'اسأل عن هذا الكتاب')}
          </button>
        </div>

        <div className="mt-3">
          <h3
            dir="auto"
            className="font-fraunces text-[14px] leading-[1.25] text-text line-clamp-2 group-hover:text-accent-2 transition-colors"
          >
            {document.title}
          </h3>

          {hasProgress ? (
            <p className="mt-1 text-[11.5px] text-accent-2 tracking-wide">
              {t('docs.card.percentReadShort', 'قُرئ {n}٪', { n: toLocaleDigits(percent, locale) })}
            </p>
          ) : (
            metaParts.length > 0 && (
              <p className="mt-1 text-[11.5px] text-text-3 tracking-wide flex items-center gap-1.5">
                {metaParts.map((part, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5">
                    {i > 0 && <span aria-hidden className="text-text-3/60">·</span>}
                    <span dir={part === fileType ? 'ltr' : undefined}>{part}</span>
                  </span>
                ))}
              </p>
            )
          )}
        </div>
      </Link>

      <button
        type="button"
        onClick={toggleBookmark}
        aria-pressed={bookmarked}
        aria-label={t('docs.card.bookmark', 'حفظ')}
        className={`absolute top-3 ${
          langDisplay ? 'start-[5.5rem]' : 'start-3'
        } w-8 h-8 rounded-full flex items-center justify-center backdrop-blur-md border transition-all duration-200 ${
          bookmarked
            ? 'bg-accent text-[#1a0e05] border-accent opacity-100 shadow-[0_4px_14px_-4px_rgba(192,133,82,0.5)]'
            : 'bg-bg/80 text-text-2 border-border-strong opacity-0 group-hover:opacity-100 focus:opacity-100 hover:border-accent hover:text-accent-2'
        }`}
      >
        <svg
          className="w-4 h-4"
          fill={bookmarked ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-4-7 4V5z"
          />
        </svg>
      </button>
    </div>
  );
}
