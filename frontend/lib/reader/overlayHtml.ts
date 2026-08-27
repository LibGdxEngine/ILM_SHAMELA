import type { LayoutBlock } from '@/lib/api';
import type { ApiHighlight } from '@/lib/api/reader';
import { findArabicPhraseMatches, findArabicTokenSetMatches } from '@/lib/arabic';
import type { BlockOverlayLayout, WordOverlayLayout } from './overlayMetrics';

export function escapeHtml(text: string): string {
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
  type: 'highlight' | 'search' | 'near';
  highlightId?: number;
  color?: string;
}

export interface OverlaySearchOptions {
  /** The executed query — whole-token phrase occurrences get the strong mark. */
  searchQuery: string;
  /** Page-level matched surface tokens (from the backend's highlight
   *  fragments) — fuzzy/lexical hits get the lighter `--near` mark. */
  searchTokens: readonly string[];
  highlights: ApiHighlight[];
}

/**
 * Block-local mark ranges: user highlights (page-level offsets clipped to the
 * block and shifted), exact phrase hits, and lexical token hits (skipped where
 * they overlap an exact hit so the strong style wins).
 */
function collectRanges(
  block: LayoutBlock,
  { searchQuery, searchTokens, highlights }: OverlaySearchOptions
): OverlayRange[] {
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
    // Whole-token phrase matches mirror the backend's exact mode
    // (`match_phrase` on `content.exact`) and the plain reader's convention —
    // sub-word occurrences the backend would never report aren't marked.
    for (const m of findArabicPhraseMatches(text, searchQuery)) {
      ranges.push({ start: m.start, end: m.end, type: 'search' });
    }
  }

  if (searchTokens.length > 0) {
    const exactRanges = ranges.filter((r) => r.type === 'search');
    for (const m of findArabicTokenSetMatches(text, searchTokens)) {
      // Tokens inside an exact phrase hit keep the strong style.
      if (exactRanges.some((r) => m.start < r.end && r.start < m.end)) continue;
      ranges.push({ start: m.start, end: m.end, type: 'near' });
    }
  }

  return ranges;
}

/**
 * Escaped HTML for `text[segStart, bareEnd)` with every range boundary inside
 * it split into segments and each segment wrapped in its `<mark>`s (search
 * outside, highlight inside). The caller appends the raw newline tail after
 * this so no mark ever wraps a '\n'.
 */
function renderSegments(text: string, segStart: number, bareEnd: number, ranges: OverlayRange[]): string {
  if (segStart >= bareEnd) return '';
  const boundaries = new Set<number>([segStart, bareEnd]);
  for (const r of ranges) {
    if (r.end > segStart && r.start < bareEnd) {
      boundaries.add(Math.max(segStart, Math.min(r.start, bareEnd)));
      boundaries.add(Math.max(segStart, Math.min(r.end, bareEnd)));
    }
  }
  const sorted = Array.from(boundaries).sort((a, b) => a - b);

  let inner = '';
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const from = sorted[i];
    const to = sorted[i + 1];
    if (from >= to) continue;
    let segment = escapeHtml(text.slice(from, to));

    const matchingHighlight = ranges.find((r) => r.type === 'highlight' && r.start <= from && r.end >= to);
    const matchingSearch = ranges.find((r) => r.type === 'search' && r.start <= from && r.end >= to);
    const matchingNear = ranges.find((r) => r.type === 'near' && r.start <= from && r.end >= to);

    if (matchingHighlight) {
      const color = matchingHighlight.color ?? 'yellow';
      segment = `<mark data-hid="${matchingHighlight.highlightId}" data-color="${color}" class="highlight-${color}">${segment}</mark>`;
    }
    if (matchingSearch) {
      segment = `<mark class="ilm-pdf-search-mark">${segment}</mark>`;
    } else if (matchingNear) {
      segment = `<mark class="ilm-pdf-search-mark ilm-pdf-search-mark--near">${segment}</mark>`;
    }
    inner += segment;
  }
  return inner;
}

/**
 * Render one block as absolutely-positioned spans — one per printed line
 * (`blockOverlayLayout`) or one per OCR word (`blockWordLayout`) — with user
 * highlights and search matches wrapped in `<mark>` runs.
 *
 * Load-bearing invariant: the concatenated text nodes of the output equal
 * `block.text` byte-for-byte, INCLUDING the literal '\n' characters (a
 * separator newline is the last text node of the span that precedes it, never
 * inside a `<mark>`). The selection layer maps DOM offsets to content offsets
 * through a text-node TreeWalker anchored at `data-char-start`, and
 * highlight/search offsets index the same string — any dropped or reordered
 * character breaks all anchoring after it. Spans are therefore always emitted
 * in character order, whatever their on-page position.
 *
 * Highlight/search offsets are page-level (`content` = blocks joined by '\n'),
 * clipped to this block and shifted to block-local space. A range spanning a
 * span boundary emits one `<mark>` per span (repeating `data-hid` — consumers
 * use `closest('mark[data-hid]')`, so fragments behave like one highlight).
 * In the word model a mark may cover a word's trailing space, never a newline.
 */
export function renderBlockOverlayHtml(
  block: LayoutBlock,
  layout: BlockOverlayLayout | WordOverlayLayout,
  options: OverlaySearchOptions
): string {
  const text = block.text;
  const ranges = collectRanges(block, options);

  if (layout.kind === 'words') {
    const anchor = layout.direction === 'rtl' ? 'right' : 'left';
    let html = '';
    let spanStart = 0;
    for (const word of layout.words) {
      const spanEnd = spanStart + word.text.length;
      // Everything from the first newline on is the raw separator tail.
      const newlineAt = word.text.indexOf('\n');
      const bareEnd = newlineAt === -1 ? spanEnd : spanStart + newlineAt;
      const inner = renderSegments(text, spanStart, bareEnd, ranges) + escapeHtml(text.slice(bareEnd, spanEnd));
      let style =
        `${anchor}:${word.startPct}%;top:${word.topPct}%;` +
        `font-size:${word.fontSizeCqh}cqh;line-height:${word.lineHeightCqh}cqh`;
      if (word.scaleX != null) style += `;transform:scaleX(${word.scaleX})`;
      html += `<span class="ilm-pdf-word" style="${style}">${inner}</span>`;
      spanStart = spanEnd;
    }
    return html;
  }

  let html = '';
  let lineStart = 0;
  for (const line of layout.lines) {
    const lineEnd = lineStart + line.text.length;
    // Separator/trailing newlines are appended raw after the marked segments —
    // a mark must never straddle a span boundary or wrap a newline.
    const newlineCount = line.text.length - line.text.replace(/\n+$/, '').length;
    const bareEnd = lineEnd - newlineCount;
    const inner = renderSegments(text, lineStart, bareEnd, ranges) + text.slice(bareEnd, lineEnd);

    const style =
      line.scaleX != null
        ? `top:${line.topPct}%;transform:scaleX(${line.scaleX})`
        : `top:${line.topPct}%`;
    html += `<span class="ilm-pdf-line" style="${style}">${inner}</span>`;
    lineStart = lineEnd;
  }
  return html;
}
