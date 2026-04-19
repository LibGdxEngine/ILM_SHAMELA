'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Document, normalizeMediaUrl } from '@/lib/api';
import { useLocalizedPath } from '@/lib/i18n/navigation';
import { useI18n } from '@/components/i18n/I18nProvider';

interface BookListRowProps {
  document: Document;
}

function stringToColor(str: string): { primary: string; secondary: string } {
  const colors = [
    { primary: '#c96442', secondary: '#d97757' },
    { primary: '#4d4c48', secondary: '#87867f' },
    { primary: '#30302e', secondary: '#5e5d59' },
    { primary: '#a16207', secondary: '#d4a853' },
    { primary: '#7c4a2b', secondary: '#c96442' },
    { primary: '#3d3d3a', secondary: '#b0aea5' },
  ];
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function generateCoverPattern(title: string): string {
  const colors = stringToColor(title);
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="120" height="180" viewBox="0 0 120 180">
      <defs>
        <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:${colors.primary}"/>
          <stop offset="100%" style="stop-color:${colors.secondary}"/>
        </linearGradient>
      </defs>
      <rect width="120" height="180" fill="url(#g)"/>
      <rect x="14" y="22" width="92" height="1" fill="rgba(250,249,245,0.35)"/>
      <rect x="14" y="158" width="92" height="1" fill="rgba(250,249,245,0.35)"/>
    </svg>
  `;
}

function categoryName(c: unknown): string | null {
  if (!c) return null;
  if (typeof c === 'string') return c;
  if (typeof c === 'object' && c !== null && 'name' in c) {
    const n = (c as { name?: unknown }).name;
    return typeof n === 'string' ? n : null;
  }
  return null;
}

function lengthLabel(doc: Document, t: (k: string, f?: string) => string): string {
  const len = doc.content?.length ?? 0;
  if (!len) return t('docs.meta.lengthUnknown', 'طول غير محدد');
  if (len < 60_000) return t('docs.meta.short', 'قراءة قصيرة');
  if (len < 250_000) return t('docs.meta.medium', 'قراءة متوسطة');
  return t('docs.meta.long', 'قراءة طويلة');
}

function eraLabel(doc: Document): string | null {
  const raw = doc.written_date;
  if (!raw) return null;
  const y = Number(raw.slice(0, 4));
  if (!Number.isFinite(y)) return raw;
  return String(y);
}

export default function BookListRow({ document }: BookListRowProps) {
  const { t } = useI18n();
  const localizedPath = useLocalizedPath();

  const [imageError, setImageError] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);

  const coverSvg = generateCoverPattern(document.title);
  const coverDataUrl = `data:image/svg+xml,${encodeURIComponent(coverSvg)}`;
  const coverPhotoUrl = normalizeMediaUrl(document.cover_photo_url);

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

  const categories = (document.categories ?? [])
    .map(categoryName)
    .filter((c): c is string => Boolean(c))
    .slice(0, 3);

  const era = eraLabel(document);
  const length = lengthLabel(document, t);

  return (
    <div className="group relative">
      <Link
        href={localizedPath(`/documents/${document.id}`)}
        className="flex gap-4 p-4 bg-ivory dark:bg-dark-surface rounded-xl border border-border-cream dark:border-dark-surface shadow-whisper hover:shadow-[0_10px_28px_rgba(20,20,19,0.07)] hover:border-ring-warm dark:hover:border-[#4d4c48] transition-all"
      >
        {/* Thumbnail — logical-start side */}
        <div className="relative flex-shrink-0 w-20 sm:w-24 aspect-[2/3] overflow-hidden rounded-md bg-warm-sand dark:bg-[#3d3d3a]">
          {coverPhotoUrl && !imageError ? (
            <img
              src={coverPhotoUrl}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
              onError={() => setImageError(true)}
            />
          ) : (
            <div
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: `url("${coverDataUrl}")` }}
            />
          )}
        </div>

        <div className="flex-1 min-w-0 flex flex-col pe-10">
          <h3 className="font-serif text-[1.15rem] leading-[1.3] font-medium text-near-black dark:text-ivory line-clamp-1 group-hover:text-terracotta dark:group-hover:text-[#d97757] transition-colors">
            {document.title}
          </h3>
          {document.authors && document.authors.length > 0 && (
            <p className="mt-0.5 text-[13px] text-olive-gray dark:text-warm-silver line-clamp-1">
              <span className="text-stone-gray">{t('book.by', 'بقلم')}:</span>{' '}
              {document.authors.map((a) => a.name).join('، ')}
            </p>
          )}

          {/* Two-line AI-style summary */}
          <p className="mt-2 text-[13px] text-charcoal-warm dark:text-warm-silver leading-[1.65] line-clamp-2">
            {document.description ||
              t(
                'docs.list.summary.default',
                'نبذة موجزة ستظهر هنا قريبًا — تلخيص ذكي يصف الكتاب بإيجاز.'
              )}
          </p>

          {/* Metadata strip */}
          <div className="mt-auto pt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11.5px] text-stone-gray">
            <span className="inline-flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2" />
                <circle cx="12" cy="12" r="9" />
              </svg>
              {length}
            </span>
            {document.language && (
              <span className="uppercase tracking-wide text-charcoal-warm dark:text-warm-silver">
                {document.language}
              </span>
            )}
            {era && <span>{era}</span>}
            {categories.length > 0 && (
              <span className="flex flex-wrap gap-1.5">
                {categories.map((c) => (
                  <span
                    key={c}
                    className="px-2 py-0.5 bg-warm-sand dark:bg-[#3d3d3a] text-charcoal-warm dark:text-warm-silver rounded-full"
                  >
                    {c}
                  </span>
                ))}
              </span>
            )}
          </div>
        </div>
      </Link>

      {/* Bookmark button — sibling of Link, overlays top-end corner */}
      <button
        type="button"
        onClick={toggleBookmark}
        aria-pressed={bookmarked}
        aria-label={t('docs.card.bookmark', 'حفظ')}
        className={`absolute top-4 end-4 w-8 h-8 rounded-full flex items-center justify-center ring-1 transition-colors ${
          bookmarked
            ? 'bg-terracotta text-ivory ring-terracotta/60'
            : 'bg-ivory/90 dark:bg-near-black/70 text-stone-gray ring-border-cream dark:ring-[#4d4c48] hover:text-terracotta hover:ring-ring-warm'
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
