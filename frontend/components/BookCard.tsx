'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Document, normalizeMediaUrl } from '@/lib/api';
import { useLocalizedPath } from '@/lib/i18n/navigation';
import { useI18n } from '@/components/i18n/I18nProvider';
import { paletteFor, type CoverPalette } from '@/lib/coverPalettes';
import { useLanguageName } from '@/lib/i18n/languageName';
import { toLocaleDigits } from '@/lib/utils';

interface BookCardProps {
  document: Document;
  formatDate?: (date: string) => string;
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

function wrapTitleLines(title: string, perLine = 14, maxLines = 3): string[] {
  if (!title) return [];
  const words = title.trim().split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    const next = current ? `${current} ${w}` : w;
    if (next.length > perLine && current) {
      lines.push(current);
      current = w;
      if (lines.length >= maxLines - 1) break;
    } else {
      current = next;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[lines.length - 1] = lines[lines.length - 1].replace(/\s+\S+$/, '') + '…';
  }
  return lines;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function generateCoverPattern(title: string, palette: CoverPalette): string {
  const lines = wrapTitleLines(title, 14, 3);
  const totalLines = Math.max(lines.length, 1);
  const lineHeight = 28;
  const blockHeight = totalLines * lineHeight;
  const startY = 150 - blockHeight / 2 + lineHeight * 0.75;

  const textEls = lines
    .map(
      (line, i) =>
        `<text x="100" y="${startY + i * lineHeight}" fill="${palette.text}" font-family="Reem Kufi, serif" font-size="22" font-weight="600" text-anchor="middle">${escapeXml(line)}</text>`
    )
    .join('');

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="200" height="300" viewBox="0 0 200 300">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${palette.from}" stop-opacity="1" />
          <stop offset="100%" stop-color="${palette.to}" stop-opacity="1" />
        </linearGradient>
      </defs>
      <rect width="200" height="300" fill="url(#grad)"/>
      <rect x="24" y="40" width="152" height="1" fill="${palette.accent}" fill-opacity="0.55"/>
      <rect x="24" y="260" width="152" height="1" fill="${palette.accent}" fill-opacity="0.55"/>
      <g transform="translate(100,32)" fill="${palette.accent}" fill-opacity="0.85">
        <path d="M0 -7 L1.6 -1.6 L7 0 L1.6 1.6 L0 7 L-1.6 1.6 L-7 0 L-1.6 -1.6 Z" />
      </g>
      ${textEls}
    </svg>
  `;
}

function yearOf(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const y = raw.slice(0, 4);
  return /^\d{3,4}$/.test(y) ? y : null;
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
  const { t, locale } = useI18n();
  const localizedPath = useLocalizedPath();
  const router = useRouter();
  const languageName = useLanguageName();

  const palette = paletteFor(document);
  const coverSvg = generateCoverPattern(document.title, palette);
  const coverDataUrl = `data:image/svg+xml,${encodeURIComponent(coverSvg)}`;
  const [imageError, setImageError] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);

  const coverPhotoUrl = normalizeMediaUrl(document.cover_photo_url);
  const pitch = usePitch(document);
  const year = yearOf(document.written_date);
  const langDisplay = document.language ? languageName(document.language) : null;

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

  const metaParts: string[] = [];
  if (year) metaParts.push(toLocaleDigits(year, locale));
  if (langDisplay) metaParts.push(langDisplay);

  return (
    <div className="group relative">
      <Link
        href={localizedPath(`/documents/${document.id}`)}
        className="block bg-gradient-to-b from-card-2 to-card rounded-[18px] border border-border hover:border-accent/40 shadow-[0_4px_20px_-8px_rgba(0,0,0,0.5)] hover:shadow-[0_12px_36px_-12px_rgba(192,133,82,0.25)] transition-all duration-300 overflow-hidden transform hover:-translate-y-1"
      >
        <div className="relative aspect-[2/3] overflow-hidden bg-bg-2">
          {coverPhotoUrl && !imageError ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={coverPhotoUrl}
              alt={document.title}
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
              onError={() => setImageError(true)}
            />
          ) : (
            <div
              className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-[1.03]"
              style={{ backgroundImage: `url("${coverDataUrl}")` }}
            />
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
              <span className="px-2 py-0.5 text-[10.5px] tracking-[0.08em] rounded-full bg-[var(--warm-deep)]/95 text-[#faf6ef] backdrop-blur-md">
                {t('book.processing', 'قيد المعالجة')}
              </span>
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

        <div className="p-4">
          <h3 className="font-fraunces text-[17px] leading-[1.3] text-text line-clamp-2 group-hover:text-accent-2 transition-colors">
            {document.title}
          </h3>

          {document.authors && document.authors.length > 0 && (
            <p className="mt-1.5 text-[12.5px] text-text-2 line-clamp-1 font-fraunces italic">
              {document.authors.map((a) => a.name).join('، ')}
            </p>
          )}

          {pitch && (
            <p className="mt-2 text-[12px] text-text-3 leading-[1.55] line-clamp-1">
              {pitch}
            </p>
          )}

          {metaParts.length > 0 && (
            <p className="mt-2.5 pt-2.5 border-t border-border text-[11px] text-text-3 tracking-wide">
              {metaParts.join(' · ')}
            </p>
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
