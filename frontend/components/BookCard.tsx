'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Document, normalizeMediaUrl } from '@/lib/api';
import { useLocalizedPath } from '@/lib/i18n/navigation';
import { useI18n } from '@/components/i18n/I18nProvider';

interface BookCardProps {
  document: Document;
  formatDate?: (date: string) => string;
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
    <svg xmlns="http://www.w3.org/2000/svg" width="200" height="300" viewBox="0 0 200 300">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:${colors.primary};stop-opacity:1" />
          <stop offset="100%" style="stop-color:${colors.secondary};stop-opacity:1" />
        </linearGradient>
      </defs>
      <rect width="200" height="300" fill="url(#grad)"/>
      <rect x="24" y="40" width="152" height="1" fill="rgba(250,249,245,0.35)"/>
      <rect x="24" y="258" width="152" height="1" fill="rgba(250,249,245,0.35)"/>
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

function usePitch(doc: Document): string {
  const { t } = useI18n();
  const category = doc.categories?.map(categoryName).find(Boolean) ?? null;
  const author = doc.authors?.[0]?.name ?? null;

  if (author && category) {
    return t('docs.card.pitchByAuthor', 'By {author}, in {category}.', {
      author,
      category,
    });
  }
  if (author) {
    return t('docs.card.pitchJustAuthor', 'By {author}.', { author });
  }
  if (category) {
    return t('docs.card.pitchFallback', 'A book in {category}.', { category });
  }
  return '';
}

export default function BookCard({ document }: BookCardProps) {
  const { t } = useI18n();
  const localizedPath = useLocalizedPath();
  const router = useRouter();

  const coverSvg = generateCoverPattern(document.title);
  const coverDataUrl = `data:image/svg+xml,${encodeURIComponent(coverSvg)}`;
  const [imageError, setImageError] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);

  const coverPhotoUrl = normalizeMediaUrl(document.cover_photo_url);
  const pitch = usePitch(document);

  const isReady = document.processing_status
    ? document.processing_status === 'succeeded'
    : document.processed;

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

  return (
    <div className="group relative">
      <Link
        href={localizedPath(`/documents/${document.id}`)}
        className="block bg-ivory dark:bg-dark-surface rounded-xl border border-border-cream dark:border-dark-surface shadow-whisper hover:shadow-[0_10px_28px_rgba(20,20,19,0.08)] hover:border-ring-warm dark:hover:border-[#4d4c48] transition-all duration-300 overflow-hidden transform hover:-translate-y-0.5"
      >
        <div className="relative aspect-[2/3] overflow-hidden bg-warm-sand dark:bg-[#3d3d3a]">
          {coverPhotoUrl && !imageError ? (
            <img
              src={coverPhotoUrl}
              alt={document.title}
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
              onError={() => setImageError(true)}
            />
          ) : (
            <div
              className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-[1.02]"
              style={{ backgroundImage: `url("${coverDataUrl}")` }}
            />
          )}

          {/* Language pill — logical-start side */}
          {document.language && (
            <div className="absolute top-3 start-3">
              <span className="px-2 py-0.5 text-[10.5px] tracking-wide rounded-full bg-ivory/90 dark:bg-near-black/70 text-charcoal-warm dark:text-warm-silver backdrop-blur-md uppercase ring-1 ring-ring-warm dark:ring-[#4d4c48]">
                {document.language}
              </span>
            </div>
          )}

          {/* Processing state (only when not ready — less visual noise) */}
          {!isReady && (
            <div className="absolute top-3 end-3">
              <span className="px-2 py-0.5 text-[10.5px] tracking-wide rounded-full bg-terracotta/90 text-ivory backdrop-blur-md">
                {t('book.processing', 'قيد المعالجة')}
              </span>
            </div>
          )}

          {/* Ask-about-this — hover reveal, bottom end */}
          <button
            type="button"
            onClick={openAsk}
            className="absolute bottom-3 end-3 px-3 py-1.5 text-[12px] rounded-full bg-near-black/80 text-ivory backdrop-blur-md opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 focus:opacity-100 focus:translate-y-0 transition-all duration-200 ring-1 ring-white/10 hover:bg-near-black"
            aria-label={t('docs.card.askAbout', 'اسأل عن هذا الكتاب')}
          >
            {t('docs.card.askAbout', 'اسأل عن هذا الكتاب')}
          </button>
        </div>

        <div className="p-4">
          <h3 className="font-serif text-[1.1rem] leading-[1.3] font-medium text-near-black dark:text-ivory line-clamp-2 group-hover:text-terracotta dark:group-hover:text-[#d97757] transition-colors">
            {document.title}
          </h3>

          {document.authors && document.authors.length > 0 && (
            <p className="mt-1 text-[13px] text-olive-gray dark:text-warm-silver line-clamp-1">
              {document.authors.map((a) => a.name).join('، ')}
            </p>
          )}

          {pitch && (
            <p className="mt-2 text-[12.5px] text-stone-gray leading-[1.55] line-clamp-1">
              {pitch}
            </p>
          )}
        </div>
      </Link>

      {/* Bookmark button — above the link surface */}
      <button
        type="button"
        onClick={toggleBookmark}
        aria-pressed={bookmarked}
        aria-label={t('docs.card.bookmark', 'حفظ')}
        className={`absolute top-3 ${
          document.language ? 'start-[4.5rem]' : 'start-3'
        } w-8 h-8 rounded-full flex items-center justify-center backdrop-blur-md ring-1 transition-all duration-200 ${
          bookmarked
            ? 'bg-terracotta text-ivory ring-terracotta/60 opacity-100'
            : 'bg-ivory/90 dark:bg-near-black/70 text-charcoal-warm dark:text-warm-silver ring-ring-warm dark:ring-[#4d4c48] opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-ivory'
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
