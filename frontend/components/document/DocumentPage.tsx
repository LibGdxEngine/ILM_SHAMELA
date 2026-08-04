import React, { useMemo } from 'react';
import { useI18n } from '@/components/i18n/I18nProvider';
import type { PrintedRef } from '@/lib/api';
import type { ApiHighlight } from '@/lib/api/reader';
import { TASHKEEL, buildTashkeelStripMapping, classifyArabicTokenMatches } from '@/lib/arabic';
import type { PageMention, EntityType } from '@/lib/api/extractionMentions';

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
  /** Entity mentions for the overlay (when enabled). */
  entityMentions?: PageMention[];
  /** Returns a localized label for the given entity type (e.g. "عَلَم"). */
  getEntityLabel?: (type: EntityType) => string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface Range {
  start: number;
  end: number;
  type: 'highlight' | 'search-exact' | 'search-near' | 'entity';
  highlightId?: number;
  color?: string;
  // entity-specific
  entityType?: EntityType;
  entityTitle?: string;
}

/**
 * Render `content` with highlights (user-created marks), search matches, and
 * entity-mention marks all layered together.
 *
 * Rendering order (outermost → innermost):
 *   entity-mention → user highlight → search token
 *
 * This uses a shared boundary-split strategy: all ranges are merged into a
 * single boundary set; each resulting segment can carry marks from multiple
 * range types simultaneously. Entity and search marks coexist naturally — both
 * are applied to the same segment via nesting. No segment type is suppressed
 * even when search marks are present, because the nesting approach keeps them
 * visually independent (entity is a background tint, search is a gold fill).
 *
 * Highlights wrap with `<mark data-hid data-color>` so deep-link scroll works;
 * search matches get `rr-tok-exact`/`rr-tok-near`; entity mentions get
 * `entity-mention entity-<type>` with a `title` tooltip. Newlines → `<br />`.
 */
function renderContentHtml(
  content: string,
  searchQuery: string,
  highlights: ApiHighlight[],
  entityMentions: PageMention[],
  getEntityLabel: (type: EntityType) => string,
): string {
  const ranges: Range[] = [];

  // Entity mentions — outermost layer (background tint).
  for (const m of entityMentions) {
    if (
      typeof m.char_start === 'number' &&
      typeof m.char_end === 'number' &&
      m.char_end > m.char_start &&
      m.char_start < content.length
    ) {
      const label = getEntityLabel(m.entity_type);
      const titleText = m.normalized_text
        ? `${label}: ${m.normalized_text}`
        : label;
      ranges.push({
        start: m.char_start,
        end: Math.min(m.char_end, content.length),
        type: 'entity',
        entityType: m.entity_type,
        entityTitle: titleText,
      });
    }
  }

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
    for (const m of classifyArabicTokenMatches(content, searchQuery)) {
      ranges.push({ start: m.start, end: m.end, type: m.kind === 'exact' ? 'search-exact' : 'search-near' });
    }
  }

  if (ranges.length === 0) {
    return escapeHtml(content).replace(/\n/g, '<br />');
  }

  // Build event boundary set; for each character index, decide which (if any)
  // wrapping should apply. Search > highlight > entity precedence visually
  // because marks are applied innermost-last (entity outermost, search innermost).
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

    const matchingEntity = ranges.find(
      (r) => r.type === 'entity' && r.start <= segStart && r.end >= segEnd
    );
    const matchingHighlight = ranges.find(
      (r) => r.type === 'highlight' && r.start <= segStart && r.end >= segEnd
    );
    const matchingSearch = ranges.find(
      (r) => (r.type === 'search-exact' || r.type === 'search-near') && r.start <= segStart && r.end >= segEnd
    );

    let inner = segText;
    // Apply outermost first (entity), then highlight, then search (innermost).
    if (matchingEntity) {
      const cls = `entity-mention entity-${matchingEntity.entityType}`;
      inner = `<mark class="${cls}" title="${escapeHtml(matchingEntity.entityTitle ?? '')}">${inner}</mark>`;
    }
    if (matchingHighlight) {
      const color = matchingHighlight.color ?? 'yellow';
      inner = `<mark data-hid="${matchingHighlight.highlightId}" data-color="${color}" class="highlight-${color}">${inner}</mark>`;
    }
    if (matchingSearch) {
      const cls = matchingSearch.type === 'search-exact' ? 'rr-tok-exact' : 'rr-tok-near';
      inner = `<mark class="${cls}">${inner}</mark>`;
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
  entityMentions = [],
  getEntityLabel,
}: DocumentPageProps) {
  const { t } = useI18n();

  // Default entity label fallback (identity) when no translator is provided.
  const resolveEntityLabel = getEntityLabel ?? ((type: EntityType) => type);

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
  // with the visible text. Token classification re-runs per keystrokeless
  // executed query, so memoize the whole HTML pass on its actual inputs.
  const innerHtml = useMemo(() => {
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
    return renderContentHtml(visibleContent, searchQuery, displayHighlights, entityMentions, resolveEntityLabel);
  // resolveEntityLabel is stable when getEntityLabel is undefined (same fallback ref per render).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, searchQuery, highlights, tashkeelEnabled, language, entityMentions, getEntityLabel]);

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
