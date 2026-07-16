import type { LayoutBlock } from '@/lib/api';
import type { ApiHighlight } from '@/lib/api/reader';
import { findArabicPhraseMatches, findArabicTokenSetMatches } from '@/lib/arabic';
import type { BlockOverlayLayout } from './overlayMetrics';

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
 * Render one block as absolutely-positioned line spans with user highlights
 * and search matches wrapped in `<mark>` runs.
 *
 * Load-bearing invariant: the concatenated text nodes of the output equal
 * `block.text` byte-for-byte, INCLUDING the literal '\n' characters (each
 * line's separator newline is the last text node of its span, never inside a
 * `<mark>`). The selection layer maps DOM offsets to content offsets through
 * a text-node TreeWalker anchored at `data-char-start`, and highlight/search
 * offsets index the same string — any dropped or reordered character breaks
 * all anchoring after it.
 *
 * Highlight/search offsets are page-level (`content` = blocks joined by '\n'),
 * clipped to this block and shifted to block-local space. A range spanning a
 * line boundary emits one `<mark>` per line (repeating `data-hid` — consumers
 * use `closest('mark[data-hid]')`, so fragments behave like one highlight).
 */
export function renderBlockOverlayHtml(
  block: LayoutBlock,
  layout: BlockOverlayLayout,
  { searchQuery, searchTokens, highlights }: OverlaySearchOptions
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

  let html = '';
  let lineStart = 0;
  for (const line of layout.lines) {
    const lineEnd = lineStart + line.text.length;
    // Separator/trailing newlines are appended raw after the marked segments —
    // a mark must never straddle a span boundary or wrap a newline.
    const newlineCount = line.text.length - line.text.replace(/\n+$/, '').length;
    const bareEnd = lineEnd - newlineCount;

    const boundaries = new Set<number>([lineStart, bareEnd]);
    for (const r of ranges) {
      if (r.end > lineStart && r.start < bareEnd) {
        boundaries.add(Math.max(lineStart, Math.min(r.start, bareEnd)));
        boundaries.add(Math.max(lineStart, Math.min(r.end, bareEnd)));
      }
    }
    const sorted = Array.from(boundaries).sort((a, b) => a - b);

    let inner = '';
    for (let i = 0; i < sorted.length - 1; i += 1) {
      const segStart = sorted[i];
      const segEnd = sorted[i + 1];
      if (segStart >= segEnd) continue;
      let segment = escapeHtml(text.slice(segStart, segEnd));

      const matchingHighlight = ranges.find(
        (r) => r.type === 'highlight' && r.start <= segStart && r.end >= segEnd
      );
      const matchingSearch = ranges.find(
        (r) => r.type === 'search' && r.start <= segStart && r.end >= segEnd
      );
      const matchingNear = ranges.find(
        (r) => r.type === 'near' && r.start <= segStart && r.end >= segEnd
      );

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
    inner += text.slice(bareEnd, lineEnd);

    const style =
      line.scaleX != null
        ? `top:${line.topPct}%;transform:scaleX(${line.scaleX})`
        : `top:${line.topPct}%`;
    html += `<span class="ilm-pdf-line" style="${style}">${inner}</span>`;
    lineStart = lineEnd;
  }
  return html;
}
