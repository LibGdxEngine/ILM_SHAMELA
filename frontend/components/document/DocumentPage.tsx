import React from 'react';
import { useI18n } from '@/components/i18n/I18nProvider';
import type { ApiHighlight } from '@/lib/api/reader';

interface DocumentPageProps {
  pageNumber: number;
  content: string;
  searchQuery: string;
  isIntersecting?: boolean;
  language?: string | null;
  tashkeelEnabled?: boolean;
  highlights?: ApiHighlight[];
}

const TASHKEEL = /[\u064B-\u065F\u0670]/g;
const TASHKEEL_CHAR = /[\u064B-\u065F\u0670]/;

/**
 * Build a per-character mapping from the original string to its tashkeel-stripped
 * counterpart. `mapping[i]` is the index in the stripped string of the character
 * that was originally at position `i`. `mapping[original.length]` equals the
 * stripped string's length so end-exclusive ranges map correctly.
 */
function buildTashkeelStripMapping(original: string): { stripped: string; mapping: number[] } {
  const mapping: number[] = new Array(original.length + 1);
  let strippedIdx = 0;
  let stripped = '';
  for (let i = 0; i < original.length; i += 1) {
    mapping[i] = strippedIdx;
    const ch = original[i];
    if (!TASHKEEL_CHAR.test(ch)) {
      stripped += ch;
      strippedIdx += 1;
    }
  }
  mapping[original.length] = strippedIdx;
  return { stripped, mapping };
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
}: DocumentPageProps) {
  const { t } = useI18n();

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
      className="bg-white rounded-xl shadow-sm mb-6 overflow-hidden relative group transition-all hover:shadow-md"
      aria-label={t('reader.pageLabel', 'صفحة {page}', { page: pageNumber })}
    >
      {/* Page Header */}
      <header className="px-6 py-3 bg-gray-50/50 border-b border-gray-100 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          {t('reader.pageLabel', 'صفحة {page}', { page: pageNumber })}
        </span>
      </header>

      {/* Page Content */}
      <div
        className="p-8 md:p-10 cursor-default"
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
            fontSize: 'var(--reader-font-size, 1.125rem)',
            letterSpacing: 'var(--reader-letter-spacing, 0)',
            lineHeight: 'var(--reader-line-height, 1.8)',
            fontWeight: 'var(--reader-font-weight, 400)',
          }}
          dangerouslySetInnerHTML={{ __html: innerHtml }}
        />
      </div>

      {/* Footer / Overlay (optional) */}
      <div className="absolute inset-0 pointer-events-none border-2 border-transparent group-hover:border-indigo-500/10 rounded-xl transition-colors" aria-hidden="true" />
    </article>
  );
}
