import React, { useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { DocumentPage as DocumentPageType, InDocSearchMode, LayoutBlock, PageLayout, normalizeMediaUrl } from '@/lib/api';
import type { ApiHighlight } from '@/lib/api/reader';
import DocumentPage from './DocumentPage';
import DocumentPageSkeleton from './DocumentPageSkeleton';
import ErrorDisplay from '@/components/ErrorDisplay';
import { useI18n } from '@/components/i18n/I18nProvider';
import { useLocalizedPath } from '@/lib/i18n/navigation';
import { toLocaleDigits } from '@/lib/utils';
import { findArabicMatches, findArabicPhraseMatches } from '@/lib/arabic';
import { blockOverlayMetrics } from '@/lib/reader/overlayMetrics';
import { suppressSelectionPopover, releaseSelectionPopoverSuppression } from '@/lib/reader/selection';

/**
 * PDF-overlay reader: renders each page as its original PDF page image with the
 * OCR text positioned on top as an invisible (transparent, selectable) layer.
 * Search matches and user highlights appear as translucent boxes over the
 * printed words without ever revealing the OCR text.
 *
 * Scroll/observer machinery mirrors `DocumentViewer` (infinite scroll, previous
 * batch loading, visible-page tracking, search-hit pulse) so the reader page
 * can swap the two viewers symmetrically.
 */
interface DocumentPdfViewerProps {
  pages: DocumentPageType[];
  isLoading: boolean;
  hasMore: boolean;
  searchQuery: string;
  /** Mode the current search results were produced with; drives on-page match strictness. */
  searchMode?: InDocSearchMode;
  onLoadMore: () => void;
  onPageVisible: (pageNumber: number) => void;
  onLoadFirstPage?: () => void;
  language?: string | null;
  error?: string | null;
  onRetry?: () => void;
  totalPages?: number;
  highlightedPage?: number | null;
  highlights?: ApiHighlight[];
  /** Chapter title shown above the first page (kept for parity with DocumentViewer). */
  sheetTitle?: string | null;
  sheetEyebrow?: string | null;
  bookTitle?: string;
  /** Double-click a word in the transparent layer → search it. */
  onWordSearch?: (word: string) => void;
  /** Hide the volume part of printed-edition page labels (single-volume works). */
  singleVolume?: boolean;
}

const WORD_CHAR = /[\p{L}\p{M}ـ]/u;

/** Resolve the whole word under a screen point (for click-to-search). */
function wordAtPoint(x: number, y: number): string | null {
  const doc = window.document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => globalThis.Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  let node: Node | null = null;
  let offset = 0;
  if (doc.caretRangeFromPoint) {
    const r = doc.caretRangeFromPoint(x, y);
    if (r) { node = r.startContainer; offset = r.startOffset; }
  } else if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y);
    if (p) { node = p.offsetNode; offset = p.offset; }
  }
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  const text = node.textContent || '';
  let start = Math.min(offset, text.length);
  let end = start;
  while (start > 0 && WORD_CHAR.test(text[start - 1])) start -= 1;
  while (end < text.length && WORD_CHAR.test(text[end])) end += 1;
  const word = text.slice(start, end).trim();
  return word.length >= 2 ? word : null;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface OverlayRange {
  start: number;
  end: number;
  type: 'highlight' | 'search';
  highlightId?: number;
  color?: string;
}

/**
 * Render one block's text with user highlights and search matches wrapped in
 * `<mark>` runs. Offsets are page-level (`content` = blocks joined by '\n'),
 * clipped to this block and shifted to block-local space. Newlines are kept as
 * literal characters (the block uses `white-space: pre-wrap`) so DOM selection
 * offsets align exactly with the stored content offsets.
 */
function renderBlockHtml(
  block: LayoutBlock,
  searchQuery: string,
  searchMode: InDocSearchMode,
  highlights: ApiHighlight[]
): string {
  const text = block.text;
  const ranges: OverlayRange[] = [];

  for (const h of highlights) {
    if (
      typeof h.char_start === 'number' &&
      typeof h.char_end === 'number' &&
      h.char_end > block.char_start &&
      h.char_start < block.char_end
    ) {
      ranges.push({
        start: Math.max(0, h.char_start - block.char_start),
        end: Math.min(text.length, h.char_end - block.char_start),
        type: 'highlight',
        highlightId: h.id,
        color: h.color,
      });
    }
  }

  if (searchQuery.trim()) {
    // Tashkeel/variant-insensitive matching, mirroring the backend's
    // `content.exact` analyzer, with ranges mapped back to original offsets.
    // Exact mode additionally restricts marks to whole-token phrase matches.
    const matches =
      searchMode === 'exact'
        ? findArabicPhraseMatches(text, searchQuery)
        : findArabicMatches(text, searchQuery);
    for (const m of matches) {
      ranges.push({ start: m.start, end: m.end, type: 'search' });
    }
  }

  if (ranges.length === 0) {
    return escapeHtml(text);
  }

  const boundaries = new Set<number>([0, text.length]);
  for (const r of ranges) {
    boundaries.add(Math.max(0, Math.min(r.start, text.length)));
    boundaries.add(Math.max(0, Math.min(r.end, text.length)));
  }
  const sorted = Array.from(boundaries).sort((a, b) => a - b);

  let html = '';
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const segStart = sorted[i];
    const segEnd = sorted[i + 1];
    if (segStart >= segEnd) continue;
    let inner = escapeHtml(text.slice(segStart, segEnd));

    const matchingHighlight = ranges.find(
      (r) => r.type === 'highlight' && r.start <= segStart && r.end >= segEnd
    );
    const matchingSearch = ranges.find(
      (r) => r.type === 'search' && r.start <= segStart && r.end >= segEnd
    );

    if (matchingHighlight) {
      const color = matchingHighlight.color ?? 'yellow';
      inner = `<mark data-hid="${matchingHighlight.highlightId}" data-color="${color}" class="highlight-${color}">${inner}</mark>`;
    }
    if (matchingSearch) {
      inner = `<mark class="ilm-pdf-search-mark">${inner}</mark>`;
    }
    html += inner;
  }
  return html;
}

interface PdfOverlayPageProps {
  pageNumber: number;
  layout: PageLayout;
  imageUrl: string | null;
  searchQuery: string;
  searchMode: InDocSearchMode;
  highlights: ApiHighlight[];
  textDirection: 'rtl' | 'ltr';
  pageLabel: string;
}

function PdfOverlayPage({
  pageNumber,
  layout,
  imageUrl,
  searchQuery,
  searchMode,
  highlights,
  textDirection,
  pageLabel,
}: PdfOverlayPageProps) {
  const { width, height } = layout;
  return (
    <article className="ilm-pdf-page" aria-label={pageLabel}>
      <div
        className="ilm-pdf-canvas"
        style={{ aspectRatio: `${width} / ${height}` }}
        onContextMenu={(e) => {
          // Keep the highlight-delete context menu working on marks; block the
          // native menu elsewhere (parity with the text reader).
          const target = e.target as HTMLElement | null;
          if (!target?.closest('mark[data-hid]')) e.preventDefault();
        }}
      >
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={pageLabel}
            className="ilm-pdf-image"
            loading={pageNumber <= 2 ? 'eager' : 'lazy'}
            draggable={false}
          />
        ) : (
          <div className="ilm-pdf-image ilm-pdf-image--missing" aria-hidden />
        )}
        <div className="ilm-pdf-overlay" dir={textDirection}>
          {layout.blocks.map((block) => {
            const html = renderBlockHtml(block, searchQuery, searchMode, highlights);
            const metrics = blockOverlayMetrics(block, height);
            return (
              <div
                key={block.id}
                data-block-id={block.id}
                data-char-start={block.char_start}
                className="ilm-pdf-block"
                style={{
                  left: `${(block.bbox[0] / width) * 100}%`,
                  top: `${(block.bbox[1] / height) * 100}%`,
                  width: `${((block.bbox[2] - block.bbox[0]) / width) * 100}%`,
                  height: `${((block.bbox[3] - block.bbox[1]) / height) * 100}%`,
                  fontSize: `${metrics.fontSizeCqh}cqh`,
                  lineHeight: `${metrics.lineHeightCqh}cqh`,
                }}
                dangerouslySetInnerHTML={{ __html: html }}
              />
            );
          })}
        </div>
      </div>
    </article>
  );
}

export default function DocumentPdfViewer({
  pages,
  isLoading,
  hasMore,
  searchQuery,
  searchMode = 'mix',
  onLoadMore,
  onPageVisible,
  onLoadFirstPage,
  language,
  error,
  onRetry,
  totalPages,
  highlightedPage,
  highlights = [],
  sheetTitle,
  sheetEyebrow,
  bookTitle,
  onWordSearch,
  singleVolume = false,
}: DocumentPdfViewerProps) {
  const { t, locale } = useI18n();
  const localizedPath = useLocalizedPath();

  // Double-click a word → search it. The popover is suppressed from the 2nd
  // mousedown (before the browser's native word-selection fires
  // selectionchange), because its debounced timer can run before dblclick does.
  const handleSheetMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!onWordSearch) return;
      if (e.detail === 2) {
        const target = e.target as HTMLElement | null;
        if (target?.closest('a, button, input, textarea, mark[data-hid]')) return;
        suppressSelectionPopover();
      } else if (e.detail > 2) {
        // Triple-click paragraph selection keeps its popover.
        releaseSelectionPopoverSuppression();
      }
    },
    [onWordSearch],
  );

  const handleSheetDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!onWordSearch) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('a, button, input, textarea, mark[data-hid]')) return;
      const sel = window.getSelection();
      const selText = sel?.toString().trim() ?? '';
      // dblclick+drag selects multiple words — that's a real selection for the
      // popover flow, not a word search.
      if (/\s/.test(selText)) {
        releaseSelectionPopoverSuppression();
        return;
      }
      const word = wordAtPoint(e.clientX, e.clientY) ?? (selText.length >= 2 ? selText : null);
      if (!word) return;
      sel?.removeAllRanges(); // don't leave the native word-selection up
      onWordSearch(word);
    },
    [onWordSearch],
  );

  const observer = useRef<IntersectionObserver | null>(null);
  const lastPageNodeRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const topSentinelRef = useRef<HTMLDivElement | null>(null);
  const isLoadingFirstPageRef = useRef(false);
  const topObserverRef = useRef<IntersectionObserver | null>(null);
  const visibilityObserverRef = useRef<IntersectionObserver | null>(null);
  const intersectionRatiosRef = useRef<Map<number, number>>(new Map());
  const lastScrollTopRef = useRef<number>(0);
  const scrollDirectionRef = useRef<'up' | 'down'>('down');

  const isLoadingRef = useRef(isLoading);
  const hasMoreRef = useRef(hasMore);
  const onLoadMoreRef = useRef(onLoadMore);
  const onPageVisibleRef = useRef(onPageVisible);
  const onLoadFirstPageRef = useRef(onLoadFirstPage);
  const pagesRef = useRef(pages);

  useEffect(() => { isLoadingRef.current = isLoading; }, [isLoading]);
  useEffect(() => { hasMoreRef.current = hasMore; }, [hasMore]);
  useEffect(() => { onLoadMoreRef.current = onLoadMore; }, [onLoadMore]);
  useEffect(() => { onPageVisibleRef.current = onPageVisible; }, [onPageVisible]);
  useEffect(() => { onLoadFirstPageRef.current = onLoadFirstPage; }, [onLoadFirstPage]);
  useEffect(() => { pagesRef.current = pages; }, [pages]);

  // Search-hit pulse on the jumped-to page (CSS keys off `data-search-hit`).
  useEffect(() => {
    if (highlightedPage == null) return;
    const node = pageRefs.current.get(highlightedPage);
    if (!node) return;
    node.setAttribute('data-search-hit', 'true');
    const timer = window.setTimeout(() => {
      node.removeAttribute('data-search-hit');
    }, 1500);
    return () => {
      window.clearTimeout(timer);
      node.removeAttribute('data-search-hit');
    };
  }, [highlightedPage]);

  // Infinite scroll observer on the last page node.
  const lastElementRef = useCallback((node: HTMLDivElement | null) => {
    if (observer.current) {
      observer.current.disconnect();
      observer.current = null;
    }
    lastPageNodeRef.current = node;
    if (isLoadingRef.current || !hasMoreRef.current || !node) return;
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMoreRef.current && !isLoadingRef.current) {
        onLoadMoreRef.current();
      }
    });
    observer.current.observe(node);
  }, []);

  useEffect(() => {
    const currentNode = lastPageNodeRef.current;
    if (observer.current) {
      observer.current.disconnect();
      observer.current = null;
    }
    if (currentNode && !isLoadingRef.current && hasMoreRef.current) {
      observer.current = new IntersectionObserver(entries => {
        if (entries[0].isIntersecting && hasMoreRef.current && !isLoadingRef.current) {
          onLoadMoreRef.current();
        }
      });
      observer.current.observe(currentNode);
    }
  }, [pages, isLoading, hasMore]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      observer.current?.disconnect();
      observer.current = null;
      topObserverRef.current?.disconnect();
      topObserverRef.current = null;
      visibilityObserverRef.current?.disconnect();
      visibilityObserverRef.current = null;
      pageRefs.current.clear();
    };
  }, []);

  // Track scroll direction (used to break visibility ties).
  useEffect(() => {
    const scrollContainer = document.getElementById('document-scroll-container');
    if (!scrollContainer) return;
    const handleScroll = () => {
      const currentScrollTop = scrollContainer.scrollTop;
      if (currentScrollTop > lastScrollTopRef.current) {
        scrollDirectionRef.current = 'down';
      } else if (currentScrollTop < lastScrollTopRef.current) {
        scrollDirectionRef.current = 'up';
      }
      lastScrollTopRef.current = currentScrollTop;
    };
    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
    return () => scrollContainer.removeEventListener('scroll', handleScroll);
  }, []);

  // Visibility observer for current-page tracking.
  useEffect(() => {
    if (visibilityObserverRef.current) {
      visibilityObserverRef.current.disconnect();
      visibilityObserverRef.current = null;
    }
    intersectionRatiosRef.current.clear();

    const visibilityObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const pageNum = parseInt(entry.target.getAttribute('data-page') || '0');
          if (pageNum > 0) {
            if (entry.isIntersecting) {
              intersectionRatiosRef.current.set(pageNum, entry.intersectionRatio);
            } else {
              intersectionRatiosRef.current.delete(pageNum);
            }
          }
        });

        let maxRatio = 0;
        let mostVisiblePage = 0;
        const visiblePages: Array<{ pageNum: number; ratio: number }> = [];
        intersectionRatiosRef.current.forEach((ratio, pageNum) => {
          visiblePages.push({ pageNum, ratio });
          if (ratio > maxRatio) {
            maxRatio = ratio;
            mostVisiblePage = pageNum;
          }
        });

        if (visiblePages.length > 1) {
          const similarPages = visiblePages.filter(p => Math.abs(p.ratio - maxRatio) < 0.1);
          if (similarPages.length > 1) {
            similarPages.sort((a, b) => a.pageNum - b.pageNum);
            mostVisiblePage = scrollDirectionRef.current === 'down'
              ? similarPages[similarPages.length - 1].pageNum
              : similarPages[0].pageNum;
          }
        }

        if (mostVisiblePage > 0) {
          onPageVisibleRef.current(mostVisiblePage);
        }
      },
      {
        rootMargin: '-30% 0px -30% 0px',
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1.0],
      }
    );

    visibilityObserverRef.current = visibilityObserver;
    pageRefs.current.forEach((el) => visibilityObserver.observe(el));

    return () => {
      visibilityObserverRef.current?.disconnect();
      visibilityObserverRef.current = null;
      intersectionRatiosRef.current.clear();
    };
  }, [pages]);

  // Scroll-to-top detection → load the previous batch.
  useEffect(() => {
    if (!onLoadFirstPage) return;
    const topSentinel = topSentinelRef.current;
    if (!topSentinel) return;

    if (topObserverRef.current) {
      topObserverRef.current.disconnect();
      topObserverRef.current = null;
    }

    const scrollContainer = document.getElementById('document-scroll-container');
    const topObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const hasFirstPage = pagesRef.current.some(p => p.page_number === 1);
            if (!hasFirstPage && !isLoadingRef.current && !isLoadingFirstPageRef.current) {
              isLoadingFirstPageRef.current = true;
              onLoadFirstPageRef.current?.();
            }
          }
        });
      },
      {
        root: scrollContainer,
        rootMargin: '400px 0px 0px 0px',
        threshold: 0,
      }
    );

    topObserverRef.current = topObserver;
    topObserver.observe(topSentinel);

    return () => {
      topObserverRef.current?.disconnect();
      topObserverRef.current = null;
    };
  }, [onLoadFirstPage]);

  // After a batch load finishes, re-arm the top sentinel for the next batch.
  useEffect(() => {
    if (isLoading) return;
    const hasFirstPage = pages.some(p => p.page_number === 1);
    isLoadingFirstPageRef.current = false;
    if (hasFirstPage) return;
    const sentinel = topSentinelRef.current;
    const topObserver = topObserverRef.current;
    if (sentinel && topObserver) {
      topObserver.unobserve(sentinel);
      topObserver.observe(sentinel);
    }
  }, [isLoading, pages]);

  const textDirection: 'rtl' | 'ltr' = language === 'ar' ? 'rtl' : 'ltr';

  return (
    <div
      className="px-4 py-8 sm:px-6"
      dir={textDirection}
      style={{ background: 'var(--sheet-area)', minHeight: '100%' }}
    >
      <div
        className="ilm-pdf-sheet relative mx-auto"
        onMouseDown={handleSheetMouseDown}
        onDoubleClick={handleSheetDoubleClick}
      >
        {/* Chapter header (parity with the text reader) */}
        {(sheetTitle || sheetEyebrow) && pages.length > 0 && (
          <div className="mb-7 text-center">
            {sheetEyebrow && (
              <div className="text-[12px] font-semibold tracking-[0.16em]" style={{ color: '#b0936a' }}>
                {sheetEyebrow}
              </div>
            )}
            {sheetTitle && (
              <h1 className="rr-title mt-3 text-[clamp(26px,4vw,34px)]" style={{ color: 'var(--sheet-ink)' }}>
                <bdi>{sheetTitle}</bdi>
              </h1>
            )}
          </div>
        )}

        {/* Top sentinel for previous-batch loading */}
        {onLoadFirstPage && (
          <div ref={topSentinelRef} className="h-1 w-full" aria-hidden="true" />
        )}

        {pages.map((page, index) => {
          const isLastPage = index === pages.length - 1;
          const pageLabel = t('reader.pageLabel', 'صفحة {page}', { page: page.page_number });
          // Printed-edition label (موافقة المطبوع) — display only; `#p-N` jumps
          // and highlights keep using the digital page number.
          const printedLabel = page.printed_ref
            ? singleVolume
              ? t('reader.editionPageLabelNoVolume', 'ص {page}', {
                  page: page.printed_ref.printed_page,
                })
              : t('reader.editionPageLabel', 'ج{volume} ص{page}', {
                  volume: page.printed_ref.volume,
                  page: page.printed_ref.printed_page,
                })
            : null;
          return (
            <div
              key={page.page_number}
              ref={(el) => {
                if (el) {
                  pageRefs.current.set(page.page_number, el);
                  if (visibilityObserverRef.current) {
                    visibilityObserverRef.current.observe(el);
                  }
                } else {
                  pageRefs.current.delete(page.page_number);
                }
                if (isLastPage) lastElementRef(el);
              }}
              data-page={page.page_number}
              className="mb-6"
            >
              <div className="mb-2 text-center text-[11px]" style={{ color: 'var(--rr-ink-4, #b0a487)' }}>
                {printedLabel ?? pageLabel}
                {printedLabel && (
                  <span className="ms-2 text-[10px] opacity-75">{pageLabel}</span>
                )}
              </div>
              {page.layout ? (
                <PdfOverlayPage
                  pageNumber={page.page_number}
                  layout={page.layout}
                  imageUrl={normalizeMediaUrl(page.image_url ?? null)}
                  searchQuery={searchQuery}
                  searchMode={searchMode}
                  highlights={highlights.filter((h) => h.page_number === page.page_number)}
                  textDirection={textDirection}
                  pageLabel={pageLabel}
                />
              ) : (
                // Defensive fallback: a layout-mode page missing geometry still reads as text.
                <DocumentPage
                  pageNumber={page.page_number}
                  content={page.content}
                  searchQuery={searchQuery}
                  searchMode={searchMode}
                  language={language}
                  highlights={highlights.filter((h) => h.page_number === page.page_number)}
                />
              )}
            </div>
          );
        })}

        {isLoading && (
          <div className="space-y-6">
            {pages.length === 0 ? (
              <>
                <DocumentPageSkeleton />
                <DocumentPageSkeleton />
                <DocumentPageSkeleton />
              </>
            ) : pages[0]?.page_number === 1 || !onLoadFirstPage ? (
              <DocumentPageSkeleton />
            ) : null}
          </div>
        )}

        {!hasMore && pages.length > 0 && (
          <div className="mt-8 py-6 text-center" role="status" aria-live="polite">
            <div className="flex flex-col items-center gap-1.5" style={{ color: 'var(--rr-ink-3, #9a8b70)' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="var(--sheet-orn)" aria-hidden="true">
                <path d="M12 2l1.7 7L21 11l-7.3 2L12 22l-1.7-9L3 11l7.3-2z" />
              </svg>
              <p className="text-[13px] font-medium" style={{ color: 'var(--rr-ink-2, #6e6354)' }}>
                {t('reader.endReached', 'وصلت إلى نهاية المستند')}
              </p>
              <p className="text-[11.5px]">
                {t('reader.allLoaded', 'تم تحميل جميع الصفحات')}
              </p>
            </div>
          </div>
        )}

        {/* Sheet footer (book name · pages) */}
        {bookTitle && pages.length > 0 && (
          <div
            className="mt-8 flex items-center justify-between pt-4 text-[11.5px]"
            style={{ borderTop: '1px solid var(--sheet-rule)', color: 'var(--rr-ink-4, #b0a487)' }}
          >
            <span className="truncate"><bdi>{bookTitle}</bdi></span>
            {totalPages ? <span>{toLocaleDigits(totalPages, locale)}</span> : null}
          </div>
        )}

        {pages.length === 0 && !isLoading && (
          <div className="text-center py-20 px-4" role="status" aria-live="polite">
            <div className="w-20 h-20 mx-auto mb-6 text-gray-300">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" className="w-full h-full" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">
              {t('reader.noPages', 'لا توجد صفحات لهذا المستند حاليًا')}
            </h2>
            <p className="text-gray-600 mb-2 max-w-md mx-auto">
              {t('reader.noPagesHint', 'قد يكون المستند قيد المعالجة أو حدث خطأ أثناء التحميل.')}
            </p>
            {error && (
              <div className="mb-6 max-w-md mx-auto">
                <ErrorDisplay message={error} onRetry={onRetry} />
              </div>
            )}
            <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
              {onRetry && (
                <button
                  onClick={onRetry}
                  className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors text-sm font-medium shadow-sm hover:shadow-md"
                  aria-label={t('docs.tryAgain', 'إعادة المحاولة')}
                >
                  {t('docs.tryAgain', 'إعادة المحاولة')}
                </button>
              )}
              <Link
                href={localizedPath('/documents')}
                className="px-6 py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg transition-colors text-sm font-medium inline-flex items-center gap-2 shadow-sm hover:shadow-md"
                aria-label={t('reader.backToLibrary', 'العودة إلى المكتبة')}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                {t('reader.backToLibrary', 'العودة إلى المكتبة')}
              </Link>
            </div>
          </div>
        )}

        {error && pages.length > 0 && (
          <div className="mb-6">
            <ErrorDisplay message={error} onRetry={onRetry} />
          </div>
        )}
      </div>
    </div>
  );
}
