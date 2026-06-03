import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/components/i18n/I18nProvider';
import {
  escapeContentHtml,
  isRtlLanguage,
  pageImageCache,
  rasterizeNode,
} from '@/lib/reader/pageImage';

interface DocumentPageImageProps {
  documentId: number;
  pageNumber: number;
  content: string;
  language?: string | null;
  tashkeelEnabled?: boolean;
  /**
   * Signature of the reader's layout settings (font size, theme, spacing…)
   * supplied by the parent. When it changes the page image is regenerated so it
   * always matches the live reader appearance.
   */
  styleSignature?: string;
}

const TASHKEEL = /[ً-ٰٟ]/g;

// Generate the image a bit before the page scrolls into view so it is ready by
// the time the reader reaches it.
const PRERENDER_MARGIN = '600px 0px';

/**
 * Content-protected page renderer. Lays out the page text in an offscreen
 * <article> (so the browser handles Arabic/Persian shaping, bidi, RTL and
 * line-wrapping), rasterizes it to a PNG, removes the text node from the DOM,
 * and shows only the image.
 *
 * Trade-off (intentional): search-match highlighting, user highlights and text
 * selection do not apply to image pages. See lib/reader/pageImage.ts for the
 * "not real DRM" caveat.
 */
export default function DocumentPageImage({
  documentId,
  pageNumber,
  content,
  language,
  tashkeelEnabled = true,
  styleSignature = '',
}: DocumentPageImageProps) {
  const { t } = useI18n();
  const textDirection = isRtlLanguage(language) ? 'rtl' : 'ltr';

  const articleRef = useRef<HTMLElement | null>(null);
  const offscreenRef = useRef<HTMLDivElement | null>(null);

  const [width, setWidth] = useState(0);
  const [inView, setInView] = useState(false);
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  // Strip tashkeel for Arabic pages when the toggle is off (no highlight remap
  // needed on the image path — a plain replace is enough).
  const shouldStrip = !tashkeelEnabled && isRtlLanguage(language) && TASHKEEL.test(content);
  TASHKEEL.lastIndex = 0;
  const visibleContent = shouldStrip ? content.replace(TASHKEEL, '') : content;

  // Full signature: parent's style settings + the bits that vary per page.
  const signature = `${styleSignature}|w${width}|${textDirection}|t${tashkeelEnabled ? 1 : 0}`;

  // Track the rendered width so the offscreen node wraps identically.
  useEffect(() => {
    const el = articleRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Lazily flag the page as in (or near) view.
  useEffect(() => {
    const el = articleRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setInView(true);
      },
      { rootMargin: PRERENDER_MARGIN }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Serve from cache immediately when the signature matches.
  useEffect(() => {
    const cached = pageImageCache.get(documentId, pageNumber, signature);
    setDataUrl(cached ?? null);
  }, [documentId, pageNumber, signature]);

  // Generate the image when needed.
  useEffect(() => {
    if (!inView || width === 0) return;
    if (pageImageCache.get(documentId, pageNumber, signature)) return;

    let cancelled = false;
    // Defer to the next frame so the offscreen node is mounted and laid out.
    const raf = requestAnimationFrame(async () => {
      const node = offscreenRef.current;
      if (!node || cancelled) return;
      try {
        const articleBg =
          articleRef.current && typeof window !== 'undefined'
            ? window.getComputedStyle(articleRef.current).backgroundColor
            : undefined;
        const png = await rasterizeNode(node, { backgroundColor: articleBg });
        if (cancelled) return;
        pageImageCache.set(documentId, pageNumber, signature, png);
        setDataUrl(png);
      } catch {
        // On failure leave the placeholder in place; a later scroll re-triggers.
      }
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [inView, width, documentId, pageNumber, signature]);

  const pageLabel = t('reader.pageLabel', 'صفحة {page}', { page: pageNumber });
  const needsOffscreen = inView && width > 0 && !dataUrl;

  const proseStyle: React.CSSProperties = {
    fontSize: 'var(--reader-font-size, 1.125rem)',
    letterSpacing: 'var(--reader-letter-spacing, 0)',
    lineHeight: 'var(--reader-line-height, 1.8)',
    fontWeight: 'var(--reader-font-weight, 400)',
  };

  return (
    <article
      ref={articleRef}
      className="bg-white rounded-xl shadow-sm mb-6 overflow-hidden relative group transition-all hover:shadow-md"
      aria-label={pageLabel}
    >
      {/* Page Header */}
      <header className="px-6 py-3 bg-gray-50/50 border-b border-gray-100 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          {pageLabel}
        </span>
      </header>

      {/* Rendered page image (or placeholder until ready) */}
      <div
        className="relative select-none"
        onContextMenu={(e) => e.preventDefault()}
        dir={textDirection}
        role="img"
        aria-label={pageLabel}
      >
        {dataUrl ? (
          <img
            src={dataUrl}
            alt={pageLabel}
            draggable={false}
            className="block w-full select-none pointer-events-none"
          />
        ) : (
          <div className="p-8 md:p-10 space-y-3" aria-hidden="true">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-4 rounded bg-gray-100 animate-pulse"
                style={{ width: `${90 - (i % 3) * 12}%` }}
              />
            ))}
          </div>
        )}

        {/* Offscreen text node: laid out by the browser, rasterized, then the
            text leaves the DOM once the image is ready. */}
        {needsOffscreen && (
          <article
            aria-hidden="true"
            className="bg-white"
            style={{
              position: 'absolute',
              left: '-99999px',
              top: 0,
              width: width > 0 ? `${width}px` : undefined,
              pointerEvents: 'none',
            }}
          >
            <div className="p-8 md:p-10" dir={textDirection} ref={offscreenRef}>
              <div
                className={`prose prose-lg max-w-none font-serif ${
                  textDirection === 'rtl' ? 'text-right' : 'text-left'
                }`}
                style={proseStyle}
                dangerouslySetInnerHTML={{ __html: escapeContentHtml(visibleContent) }}
              />
            </div>
          </article>
        )}
      </div>
    </article>
  );
}
