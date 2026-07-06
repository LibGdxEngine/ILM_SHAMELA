import React from 'react';
import { useI18n } from '@/components/i18n/I18nProvider';
import type { PrintedRef } from '@/lib/api';
import type { ApiHighlight } from '@/lib/api/reader';
import { TASHKEEL, buildTashkeelStripMapping } from '@/lib/arabic';

interface DocumentPageProps {
  pageNumber: number;
  content: string;
  searchQuery: string;
  isIntersecting?: boolean;
  language?: string | null;
  tashkeelEnabled?: boolean;
  highlights?: ApiHighlight[];
  /** Printed-edition (volume, page) reference for this page, when mapped. */
  printedRef?: PrintedRef | null;
  /** Hide the volume part of the printed label for single-volume editions. */
  singleVolume?: boolean;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface Range {
  start: number;
  end: number;
  type: 'highlight' | 'search';
  highlightId?: number;
  color?: string;
}

/**
 * Render `content` with highlights (user-created marks) layered under search
 * matches. Highlights wrap with `<mark data-hid data-color>` so deep-link
 * scroll-into-view works; search matches use the original yellow `<mark>`
 * styling so search functionality remains visually unchanged.
 *
 * Strategy: produce a non-overlapping list of "segments" of plain text and
 * sliced wrapped ranges, then convert each to escaped HTML. Newlines become
 * `<br />` in the final pass.
 */
function renderContentHtml(
  content: string,
  searchQuery: string,
  highlights: ApiHighlight[]
): string {
  const ranges: Range[] = [];

  for (const h of highlights) {
    if (
      typeof h.char_start === 'number' &&
      typeof h.char_end === 'number' &&
      h.char_end > h.char_start &&
      h.char_start < content.length
    ) {
      ranges.push({
        start: h.char_start,
        end: Math.min(h.char_end, content.length),
        type: 'highlight',
        highlightId: h.id,
        color: h.color,
      });
    }
  }

  if (searchQuery.trim()) {
    const escaped = escapeRegex(searchQuery);
    const regex = new RegExp(escaped, 'gi');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      ranges.push({ start: match.index, end: match.index + match[0].length, type: 'search' });
      if (match.index === regex.lastIndex) regex.lastIndex += 1;
    }
  }

  if (ranges.length === 0) {
    return escapeHtml(content).replace(/\n/g, '<br />');
  }

  // Build event boundary set; for each character index, decide which (if any)
  // wrapping should apply. Search > highlight precedence visually because
  // search marks are stacked on top via DOM order, but we render per-range
  // segments. Where ranges overlap, we split at boundaries.
  const boundaries = new Set<number>([0, content.length]);
  for (const r of ranges) {
    boundaries.add(r.start);
    boundaries.add(r.end);
  }
  const sorted = Array.from(boundaries).sort((a, b) => a - b);

  let html = '';
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const segStart = sorted[i];
    const segEnd = sorted[i + 1];
    if (segStart >= segEnd) continue;
    const segText = escapeHtml(content.slice(segStart, segEnd));

    const matchingHighlight = ranges.find(
      (r) => r.type === 'highlight' && r.start <= segStart && r.end >= segEnd
    );
    const matchingSearch = ranges.find(
      (r) => r.type === 'search' && r.start <= segStart && r.end >= segEnd
    );

    let inner = segText;
    if (matchingHighlight) {
      const color = matchingHighlight.color ?? 'yellow';
      inner = `<mark data-hid="${matchingHighlight.highlightId}" data-color="${color}" class="highlight-${color}">${inner}</mark>`;
    }
    if (matchingSearch) {
      inner = `<mark class="bg-yellow-200/80 px-1 py-0.5 rounded text-gray-900">${inner}</mark>`;
    }
    html += inner;
  }
  return html.replace(/\n/g, '<br />');
}

export default function DocumentPage({
  pageNumber,
  content,
  searchQuery,
  language,
  tashkeelEnabled = true,
  highlights = [],
  printedRef = null,
  singleVolume = false,
}: DocumentPageProps) {
  const { t } = useI18n();

  // Printed-edition label (موافقة المطبوع) — display metadata only; the digital
  // page number stays the canonical anchor for jumps/highlights.
  const printedLabel = printedRef
    ? singleVolume
      ? t('reader.editionPageLabelNoVolume', 'ص {page}', { page: printedRef.printed_page })
      : t('reader.editionPageLabel', 'ج{volume} ص{page}', {
          volume: printedRef.volume,
          page: printedRef.printed_page,
        })
    : null;

  // Determine text direction: Arabic = RTL, others = LTR
  const textDirection = language === 'ar' ? 'rtl' : 'ltr';

  // Strip tashkeel client-side for Arabic pages when toggled off so highlights
  // and search use the same visible offsets. Highlights store offsets against
  // the ORIGINAL content; remap them to the stripped string so wrapping aligns
  // with the visible text.
  const shouldStrip = !tashkeelEnabled && language === 'ar' && TASHKEEL.test(content);
  // Reset regex.lastIndex because TASHKEEL is global.
  TASHKEEL.lastIndex = 0;

  let visibleContent = content;
  let displayHighlights = highlights;
  if (shouldStrip) {
    const { stripped, mapping } = buildTashkeelStripMapping(content);
    visibleContent = stripped;
    displayHighlights = highlights.map((h) => ({
      ...h,
      char_start: mapping[Math.max(0, Math.min(h.char_start, content.length))],
      char_end: mapping[Math.max(0, Math.min(h.char_end, content.length))],
    }));
  }

  const innerHtml = renderContentHtml(visibleContent, searchQuery, displayHighlights);

  return (
    <article
      className="ilm-sheet-page relative"
      aria-label={t('reader.pageLabel', 'صفحة {page}', { page: pageNumber })}
    >
      {/* Subtle page divider + marker (continuous-sheet style). The first page
          omits the top rule so the chapter header sits flush. */}
      {pageNumber > 1 && (
        <div className="mb-8 mt-2 flex items-center justify-center gap-3" aria-hidden>
          <span className="h-px w-12" style={{ background: 'var(--sheet-rule)' }} />
          <span className="text-[11px]" style={{ color: 'var(--rr-ink-4, #b0a487)' }}>
            {printedLabel ?? t('reader.pageLabel', 'صفحة {page}', { page: pageNumber })}
          </span>
          {printedLabel && (
            <span className="text-[10px] opacity-75" style={{ color: 'var(--rr-ink-4, #b0a487)' }}>
              {t('reader.pageLabel', 'صفحة {page}', { page: pageNumber })}
            </span>
          )}
          <span className="h-px w-12" style={{ background: 'var(--sheet-rule)' }} />
        </div>
      )}

      {/* Page content */}
      <div
        className="cursor-text"
        onContextMenu={(e) => e.preventDefault()}
        dir={textDirection}
        role="text"
        aria-label={t('reader.pageLabel', 'صفحة {page}', { page: pageNumber })}
      >
        <div
          className={`prose prose-lg max-w-none font-serif ${
            textDirection === 'rtl' ? 'text-right' : 'text-left'
          }`}
          style={{
            color: 'var(--sheet-ink, #2a2419)',
            fontSize: 'var(--reader-font-size, 1.125rem)',
            letterSpacing: 'var(--reader-letter-spacing, 0)',
            lineHeight: 'var(--reader-line-height, 1.8)',
            fontWeight: 'var(--reader-font-weight, 400)',
            textAlign: textDirection === 'rtl' ? 'justify' : undefined,
          }}
          dangerouslySetInnerHTML={{ __html: innerHtml }}
        />
      </div>
    </article>
  );
}
