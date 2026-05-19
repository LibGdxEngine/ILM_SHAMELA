'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Document, normalizeMediaUrl } from '@/lib/api';
import { useLocalizedPath } from '@/lib/i18n/navigation';
import { useI18n } from '@/components/i18n/I18nProvider';

interface BookListRowProps {
  document: Document;
}

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

function generateCoverPattern(title: string): string {
  const palette = paletteFor(title);
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="120" height="180" viewBox="0 0 120 180">
      <defs>
        <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:${palette.from}"/>
          <stop offset="100%" style="stop-color:${palette.to}"/>
        </linearGradient>
      </defs>
      <rect width="120" height="180" fill="url(#g)"/>
      <rect x="14" y="22" width="92" height="1" fill="rgba(232,212,180,0.25)"/>
      <rect x="14" y="158" width="92" height="1" fill="rgba(232,212,180,0.25)"/>
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
        className="flex gap-4 p-4 bg-gradient-to-b from-card-2 to-card rounded-[18px] border border-border hover:border-accent/40 shadow-[0_4px_20px_-8px_rgba(0,0,0,0.4)] hover:shadow-[0_10px_30px_-10px_rgba(192,133,82,0.2)] transition-all"
      >
        {/* Thumbnail */}
        <div className="relative flex-shrink-0 w-20 sm:w-24 aspect-[2/3] overflow-hidden rounded-[10px] bg-bg-2">
          {coverPhotoUrl && !imageError ? (
            // eslint-disable-next-line @next/next/no-img-element
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
          <h3 className="font-fraunces text-[18px] leading-[1.3] text-text line-clamp-1 group-hover:text-accent-2 transition-colors">
            {document.title}
          </h3>
          {document.authors && document.authors.length > 0 && (
            <p className="mt-1 text-[13px] text-text-2 line-clamp-1 font-fraunces italic">
              <span className="text-text-3 not-italic">{t('book.by', 'بقلم')}:</span>{' '}
              {document.authors.map((a) => a.name).join('، ')}
            </p>
          )}

          {/* Two-line summary */}
          <p className="mt-2 text-[13px] text-text-2 leading-[1.65] line-clamp-2">
            {document.description ||
              t(
                'docs.list.summary.default',
                'نبذة موجزة ستظهر هنا قريبًا — تلخيص ذكي يصف الكتاب بإيجاز.'
              )}
          </p>

          {/* Metadata strip */}
          <div className="mt-auto pt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11.5px] text-text-3">
            <span className="inline-flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2" />
                <circle cx="12" cy="12" r="9" />
              </svg>
              {length}
            </span>
            {document.language && (
              <span className="uppercase tracking-[0.1em] text-text-2">
                {document.language}
              </span>
            )}
            {era && <span>{era}</span>}
            {categories.length > 0 && (
              <span className="flex flex-wrap gap-1.5">
                {categories.map((c) => (
                  <span
                    key={c}
                    className="px-2 py-0.5 bg-white/[0.04] border border-border-strong text-text-2 rounded-full"
                  >
                    {c}
                  </span>
                ))}
              </span>
            )}
          </div>
        </div>
      </Link>

      {/* Bookmark button */}
      <button
        type="button"
        onClick={toggleBookmark}
        aria-pressed={bookmarked}
        aria-label={t('docs.card.bookmark', 'حفظ')}
        className={`absolute top-4 end-4 w-8 h-8 rounded-full flex items-center justify-center border transition-all ${
          bookmarked
            ? 'bg-accent text-[#1a0e05] border-accent shadow-[0_4px_14px_-4px_rgba(192,133,82,0.5)]'
            : 'bg-bg/70 text-text-3 border-border-strong hover:text-accent-2 hover:border-accent'
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
