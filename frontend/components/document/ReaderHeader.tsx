'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useI18n } from '@/components/i18n/I18nProvider';
import StarMark from '@/components/landing/StarMark';
import NavSearchPopover, { type SelectedBook } from '@/components/search/NavSearchPopover';
import { useAuth } from '@/lib/AuthContext';
import { Document, type CorpusSearchMode } from '@/lib/api';
import { buildDocumentsSearchParams } from '@/lib/documentsSearchParams';
import { useLocalizedPath } from '@/lib/i18n/navigation';
import type { ReaderTheme } from './FontThemeControls';

interface ReaderHeaderProps {
  document: Document;
  currentPage: number;
  totalPages: number;
  /** Title of the chapter the user is currently reading (breadcrumb tail). */
  currentChapterTitle?: string | null;
  isBookmarked: boolean;

  /** Reader sheet theme (persisted value: light | sepia | dark). */
  theme: ReaderTheme;
  onSetTheme: (theme: ReaderTheme) => void;
  onFontDec: () => void;
  onFontInc: () => void;
  /** Advanced typography (diacritics / spacing / line-height / weight). */
  tashkeelEnabled: boolean;
  onTashkeelChange: (enabled: boolean) => void;
  letterSpacing: number;
  onLetterSpacingChange: (value: number) => void;
  lineHeight: number;
  onLineHeightChange: (value: number) => void;
  fontWeight: number;
  onFontWeightChange: (value: number) => void;
  /**
   * Show the font stepper + typography popover. Off for PDF-overlay books,
   * where the transparent text layer sizes itself from OCR bounding boxes and
   * these controls have no effect.
   */
  showTypography?: boolean;
  onToggleBookmark: () => void;
  onOpenAssistant: () => void;
  onToggleSearch: () => void;
  searchOpen: boolean;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}

/** Theme swatches — persisted value → design label + swatch color. */
const THEME_SWATCHES: { value: ReaderTheme; labelKey: string; fallback: string; color: string }[] = [
  { value: 'light', labelKey: 'reader.theme.parchment', fallback: 'ورقي', color: '#f4ecd8' },
  { value: 'sepia', labelKey: 'reader.theme.sepia', fallback: 'بُنّي', color: '#e3c68e' },
  { value: 'dark', labelKey: 'reader.theme.night', fallback: 'ليلي', color: '#241b12' },
];

/**
 * Reader header (parchment). Right→left in RTL:
 *   [back] [title + author + chapter breadcrumb] ···· [themes] [font −/+] [bookmark] [✦ assistant]
 * A 3px gold progress bar sits flush against the bottom edge.
 */
export default function ReaderHeader({
  document,
  currentPage,
  totalPages,
  currentChapterTitle,
  isBookmarked,
  theme,
  onSetTheme,
  onFontDec,
  onFontInc,
  tashkeelEnabled,
  onTashkeelChange,
  letterSpacing,
  onLetterSpacingChange,
  lineHeight,
  onLineHeightChange,
  fontWeight,
  onFontWeightChange,
  showTypography = true,
  onToggleBookmark,
  onOpenAssistant,
  onToggleSearch,
  searchOpen,
  isFullscreen,
  onToggleFullscreen,
}: ReaderHeaderProps) {
  const { t } = useI18n();
  const localizedPath = useLocalizedPath();
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const [typoOpen, setTypoOpen] = useState(false);

  // Close the typography popover on Escape, matching the backdrop click-out.
  useEffect(() => {
    if (!typoOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTypoOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [typoOpen]);

  // Compact library-wide corpus search (a separate feature from the in-book
  // search toggle further down): a magnifier button opens the shared
  // NavSearchPopover as a slide-over panel, and submitting navigates away to
  // /documents rather than filtering the open book in place. Self-contained
  // local state, mirroring the `typoOpen` popover pattern above.
  const librarySearchBtnRef = useRef<HTMLButtonElement>(null);
  const [librarySearchOpen, setLibrarySearchOpen] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [libraryMode, setLibraryMode] = useState<CorpusSearchMode>('hybrid');
  const [libraryCategories, setLibraryCategories] = useState<string[]>([]);
  const [libraryAuthors, setLibraryAuthors] = useState<string[]>([]);
  const [libraryBooks, setLibraryBooks] = useState<SelectedBook[]>([]);

  const toggleLibraryCategory = (name: string) =>
    setLibraryCategories((prev) =>
      prev.includes(name) ? prev.filter((c) => c !== name) : [...prev, name],
    );
  const toggleLibraryAuthor = (name: string) =>
    setLibraryAuthors((prev) =>
      prev.includes(name) ? prev.filter((a) => a !== name) : [...prev, name],
    );
  const toggleLibraryBook = (book: SelectedBook) =>
    setLibraryBooks((prev) =>
      prev.some((b) => b.id === book.id) ? prev.filter((b) => b.id !== book.id) : [...prev, book],
    );

  const handleLibrarySubmit = () => {
    const params = buildDocumentsSearchParams({
      q: libraryQuery,
      mode: libraryMode,
      documents: libraryBooks.map((b) => b.id),
      authors: libraryAuthors,
      categories: libraryCategories,
    });
    router.push(localizedPath(`/documents?${params.toString()}`));
  };

  const authorLine = useMemo(
    () => (document.authors ?? []).map((a) => a.name).filter(Boolean).join('، '),
    [document.authors],
  );

  const breadcrumb = useMemo(() => {
    const parts = [
      ...(document.categories ?? []).map((c) => c.name),
      currentChapterTitle ?? '',
    ].filter(Boolean);
    return parts.join(' · ');
  }, [document.categories, currentChapterTitle]);

  return (
    <header
      className="relative flex flex-shrink-0 items-center gap-3 px-4 py-[13px] md:gap-[18px] md:px-6"
      style={{ background: 'var(--rr-surface-2)', borderBottom: '1px solid var(--rr-line)' }}
    >
      {/* Back + identity */}
      <div className="flex min-w-0 items-center gap-3">
        {/* Brand mark — links to the library; hidden below sm to match the author line */}
        <Link
          href={localizedPath('/documents')}
          aria-label={t('brand.name', 'مكتبة عِلم')}
          className="hidden flex-shrink-0 items-center justify-center sm:inline-flex"
          style={{ color: 'var(--rr-brand)' }}
        >
          <StarMark size={22} holeColor="var(--rr-surface-2)" />
        </Link>
        <Link
          href={localizedPath('/documents')}
          aria-label={t('reader.backToLibrary', 'العودة إلى المكتبة')}
          className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-[9px] transition-colors"
          style={{ background: 'var(--rr-rail)', border: '1px solid var(--rr-line)', color: 'var(--rr-ink-2)' }}
        >
          {/* RTL: chevron points right (toward the list, which is "back"). */}
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9 6l6 6-6 6" />
          </svg>
        </Link>

        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h1 className="rr-title truncate text-[17px]" title={document.title}>
              <bdi>{document.title}</bdi>
            </h1>
            {authorLine && (
              <span className="hidden truncate text-[12px] sm:inline" style={{ color: 'var(--rr-ink-3)' }} title={authorLine}>
                <bdi>{authorLine}</bdi>
              </span>
            )}
          </div>
          {breadcrumb && (
            <div className="mt-0.5 truncate text-[11.5px]" style={{ color: 'var(--rr-ink-4)' }} title={breadcrumb}>
              {breadcrumb}
            </div>
          )}
        </div>
      </div>

      {/* Compact library-wide search — grouped with brand/identity, not the reading-tool
          cluster. Opens the shared popup as a slide-over panel (never an anchored dropdown,
          which the reader shell's overflow-hidden wrapper would clip). */}
      <button
        ref={librarySearchBtnRef}
        type="button"
        onClick={() => setLibrarySearchOpen((v) => !v)}
        aria-expanded={librarySearchOpen}
        aria-label={t('nav.search.openLabel', 'Search the library')}
        title={t('nav.search.openLabel', 'Search the library')}
        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] transition-colors"
        style={{ background: 'var(--rr-rail)', border: '1px solid var(--rr-line)', color: 'var(--rr-ink-2)' }}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.5" y2="16.5" />
        </svg>
      </button>
      <NavSearchPopover
        presentation="panel"
        open={librarySearchOpen}
        onOpenChange={setLibrarySearchOpen}
        anchorRef={librarySearchBtnRef}
        showQueryField
        mode={libraryMode}
        onModeChange={setLibraryMode}
        queryValue={libraryQuery}
        onQueryChange={setLibraryQuery}
        onSubmit={handleLibrarySubmit}
        selectedCategories={libraryCategories}
        onToggleCategory={toggleLibraryCategory}
        selectedAuthors={libraryAuthors}
        onToggleAuthor={toggleLibraryAuthor}
        selectedBooks={libraryBooks}
        onToggleBook={toggleLibraryBook}
        isAuthenticated={isAuthenticated}
      />

      <div className="flex-1" />

      {/* Reader theme swatches */}
      <div
        className="hidden items-center gap-[7px] rounded-[10px] px-2 py-[5px] sm:flex"
        style={{ background: 'var(--rr-rail)', border: '1px solid var(--rr-line)' }}
        role="group"
        aria-label={t('reader.theme', 'سمة القراءة')}
      >
        {THEME_SWATCHES.map((s) => {
          const active = theme === s.value;
          return (
            <button
              key={s.value}
              type="button"
              onClick={() => onSetTheme(s.value)}
              aria-pressed={active}
              title={t(s.labelKey, s.fallback)}
              aria-label={t(s.labelKey, s.fallback)}
              className="h-5 w-5 rounded-full"
              style={{
                background: s.color,
                boxShadow: active
                  ? '0 0 0 2px #b07d2b, inset 0 0 0 2px #f7efdc'
                  : 'inset 0 0 0 1px rgba(0,0,0,.12)',
              }}
            />
          );
        })}
      </div>

      {/* Font size stepper */}
      {showTypography && (
        <div
          className="flex items-center overflow-hidden rounded-[10px]"
          style={{ background: 'var(--rr-rail)', border: '1px solid var(--rr-line)' }}
        >
          <button
            type="button"
            onClick={onFontDec}
            aria-label={t('reader.fontDecrease', 'تصغير الخط')}
            className="px-[11px] py-1.5 text-[13px] transition-colors hover:bg-black/[0.04]"
            style={{ color: 'var(--rr-ink-2)' }}
          >
            أ−
          </button>
          <span className="h-[18px] w-px" style={{ background: 'var(--rr-line)' }} />
          <button
            type="button"
            onClick={onFontInc}
            aria-label={t('reader.fontIncrease', 'تكبير الخط')}
            className="px-[11px] py-1.5 text-[17px] transition-colors hover:bg-black/[0.04]"
            style={{ color: '#3a342b' }}
          >
            أ+
          </button>
        </div>
      )}

      {/* Advanced typography popover (diacritics / spacing / line-height / weight) */}
      {showTypography && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setTypoOpen((v) => !v)}
            aria-pressed={typoOpen}
            aria-label={t('reader.typography', 'إعدادات الطباعة')}
            title={t('reader.typography', 'إعدادات الطباعة')}
            className="flex h-9 items-end justify-center gap-px rounded-[10px] px-2.5 pb-2 transition-colors"
            style={{
              background: typoOpen ? 'rgba(176,125,43,0.14)' : 'var(--rr-rail)',
              border: '1px solid var(--rr-line)',
              color: typoOpen ? '#8a6a23' : 'var(--rr-ink-2)',
            }}
          >
            <span className="text-[15px] leading-none">أ</span>
            <span className="text-[10px] leading-none">أ</span>
          </button>

          {typoOpen && (
            <>
              <button
                type="button"
                aria-hidden
                tabIndex={-1}
                onClick={() => setTypoOpen(false)}
                className="fixed inset-0 z-[59] cursor-default"
              />
              <div
                role="dialog"
                aria-label={t('reader.typography', 'إعدادات الطباعة')}
                className="absolute z-[60] mt-2 w-[262px] p-3.5"
                style={{
                  insetInlineEnd: 0,
                  borderRadius: 12,
                  background: 'var(--rr-surface)',
                  border: '1px solid var(--rr-line)',
                  boxShadow: '0 12px 32px -8px rgba(44,38,32,0.35)',
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[12.5px]" style={{ color: 'var(--rr-ink-2)' }}>
                    {t('reader.tashkeel', 'التشكيل')}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={tashkeelEnabled}
                    aria-label={t('reader.tashkeel', 'التشكيل')}
                    onClick={() => onTashkeelChange(!tashkeelEnabled)}
                    className="relative h-[22px] w-10 rounded-full transition-colors"
                    style={{ background: tashkeelEnabled ? 'var(--rr-brand)' : 'var(--rr-line-2)' }}
                  >
                    <span
                      className="absolute top-[3px] h-4 w-4 rounded-full bg-white transition-all"
                      style={{ insetInlineStart: tashkeelEnabled ? 21 : 3 }}
                    />
                  </button>
                </div>

                <TypoSlider
                  label={t('reader.letterSpacing', 'تباعد الحروف')}
                  display={`${letterSpacing.toFixed(3)}em`}
                  value={letterSpacing}
                  min={-0.05}
                  max={0.1}
                  step={0.005}
                  onChange={onLetterSpacingChange}
                />
                <TypoSlider
                  label={t('reader.lineHeight', 'ارتفاع السطر')}
                  display={lineHeight.toFixed(2)}
                  value={lineHeight}
                  min={1.4}
                  max={2.4}
                  step={0.05}
                  onChange={onLineHeightChange}
                />

                <div className="mt-3">
                  <span className="text-[12.5px]" style={{ color: 'var(--rr-ink-2)' }}>
                    {t('reader.fontWeight', 'وزن الخط')}
                  </span>
                  <div className="mt-1.5 flex gap-1.5">
                    {[300, 400, 500, 700].map((w) => {
                      const active = fontWeight === w;
                      return (
                        <button
                          key={w}
                          type="button"
                          onClick={() => onFontWeightChange(w)}
                          aria-pressed={active}
                          className="flex-1 rounded-[8px] py-1.5 text-[14px] transition-colors"
                          style={{
                            background: active ? 'rgba(176,125,43,0.14)' : 'var(--rr-rail)',
                            border: `1px solid ${active ? '#b07d2b' : 'var(--rr-line)'}`,
                            color: active ? '#8a6a23' : 'var(--rr-ink-2)',
                            fontWeight: w,
                          }}
                        >
                          أ
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Toggle advanced search */}
      <button
        type="button"
        onClick={onToggleSearch}
        aria-pressed={searchOpen}
        aria-label={t('reader.search.title', 'البحث المتقدّم')}
        title={t('reader.search.title', 'البحث المتقدّم')}
        className="flex h-9 w-9 items-center justify-center rounded-[10px] transition-colors"
        style={{
          background: searchOpen ? 'rgba(176,125,43,0.14)' : 'var(--rr-rail)',
          border: '1px solid var(--rr-line)',
          color: searchOpen ? '#8a6a23' : 'var(--rr-ink-2)',
        }}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.5" y2="16.5" />
        </svg>
      </button>

      {/* Full-screen reading mode */}
      <button
        type="button"
        onClick={onToggleFullscreen}
        aria-pressed={isFullscreen}
        aria-label={t(isFullscreen ? 'reader.exitFullscreen' : 'reader.fullscreen', isFullscreen ? 'إنهاء ملء الشاشة' : 'وضع القراءة بملء الشاشة')}
        title={t(isFullscreen ? 'reader.exitFullscreen' : 'reader.fullscreen', isFullscreen ? 'إنهاء ملء الشاشة' : 'وضع القراءة بملء الشاشة')}
        className="flex h-9 w-9 items-center justify-center rounded-[10px] transition-colors"
        style={{ background: 'var(--rr-rail)', border: '1px solid var(--rr-line)', color: 'var(--rr-ink-2)' }}
      >
        {isFullscreen ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9 9H4M9 9V4M15 9h5M15 9V4M9 15H4M9 15v5M15 15h5M15 15v5" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          </svg>
        )}
      </button>

      {/* Bookmark */}
      <button
        type="button"
        onClick={onToggleBookmark}
        aria-pressed={isBookmarked}
        aria-label={t('reader.header.bookmark', 'إشارة مرجعية')}
        title={t('reader.header.bookmark', 'إشارة مرجعية')}
        className="flex h-9 w-9 items-center justify-center rounded-[10px] transition-colors"
        style={{
          background: isBookmarked ? 'var(--rr-brand)' : 'var(--rr-rail)',
          border: '1px solid var(--rr-line)',
          color: isBookmarked ? 'var(--rr-brand-ink)' : 'var(--rr-ink-2)',
        }}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill={isBookmarked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z" />
        </svg>
      </button>

      {/* AI assistant (green ✦) */}
      <button
        type="button"
        onClick={onOpenAssistant}
        aria-label={t('reader.header.assistant', 'المساعد الذكي')}
        title={t('reader.header.assistant', 'المساعد الذكي')}
        className="flex h-9 w-9 items-center justify-center rounded-[10px] transition-transform hover:-translate-y-px"
        style={{ background: 'var(--rr-green)' }}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="#efe7d2" aria-hidden>
          <path d="M12 2l1.7 7L21 11l-7.3 2L12 22l-1.7-9L3 11l7.3-2z" />
        </svg>
      </button>

      {/* Gold progress bar */}
      <div className="absolute inset-x-0 -bottom-px h-[3px]" style={{ background: 'var(--rr-line-2)' }}>
        <div
          className="h-full transition-[width] duration-300 ease-out"
          style={{
            width: totalPages > 0 ? `${(currentPage / totalPages) * 100}%` : '0%',
            background: 'var(--rr-brand)',
          }}
          aria-hidden
        />
      </div>
    </header>
  );
}

function TypoSlider({
  label,
  display,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  display: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between">
        <span className="text-[12.5px]" style={{ color: 'var(--rr-ink-2)' }}>
          {label}
        </span>
        <span className="text-[11px]" style={{ color: 'var(--rr-ink-3)' }}>
          {display}
        </span>
      </div>
      <input
        type="range"
        dir="ltr"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        aria-label={label}
        className="mt-1.5 w-full accent-[#b07d2b]"
      />
    </div>
  );
}

export type { ReaderHeaderProps };
