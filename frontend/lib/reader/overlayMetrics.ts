import type { LayoutBlock } from '@/lib/api';
import { MEASURE_REFERENCE_PX, type LineMeasurer } from './lineMeasure';

export interface OverlayLine {
  /**
   * Line text INCLUDING its separator/trailing '\n' characters (only the
   * block's last visible line can carry more than one, or none). Concatenating
   * `lines[].text` reproduces `block.text` byte-for-byte — the selection layer
   * depends on the DOM text nodes matching the stored content exactly.
   */
  text: string;
  /** Top of the line box, % of the BLOCK height. */
  topPct: number;
  /** Horizontal scale fitting the glyph run to the printed line; null → no transform. */
  scaleX: number | null;
}

export interface BlockOverlayLayout {
  /** Font size in cqh relative to `.ilm-pdf-overlay` (the size container). */
  fontSizeCqh: number;
  lines: OverlayLine[];
}

/** Font size as a fraction of the row pitch (tuned against real page scans). */
export const FONT_FACTOR = 0.75;
/** Line-box height factor — keep in sync with `.ilm-pdf-line { line-height }`. */
export const LINE_BOX_FACTOR = 1.1;

/** A line at least this fraction of the longest line's length counts as a
 *  "full" printed line and votes on the block's reference scale. */
const LONG_LINE_RATIO = 0.6;
const MIN_SCALE = 0.5;
const MAX_SCALE = 4;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Per-line layout for the invisible OCR text (PDF.js-textLayer model): the
 * stored OCR JSON has no line geometry, so rows are distributed evenly over
 * the block bbox and each line is horizontally fitted with a measured
 * `scaleX`. Full lines fit the bbox width exactly; short lines (the last line
 * of a justified paragraph, a half-verse) get the block's reference scale — a
 * robust estimate of the print-font/serif advance ratio measured off the full
 * lines — so they render at their true proportional width anchored
 * inline-start instead of stretching across the box.
 *
 * All math is in OCR pixel space; the result is scale-invariant because bbox
 * percentages, `cqh` font sizes, and measured widths all scale uniformly with
 * the rendered page. `fontSizeCqh` resolves against `.ilm-pdf-overlay`
 * (100cqh = page height): an element is never its own size container, so the
 * container ancestor is load-bearing — without it the units fall back to the
 * viewport and come out ~8× too large.
 */
export function blockOverlayLayout(
  block: Pick<LayoutBlock, 'text' | 'bbox'>,
  pageHeight: number,
  measure: LineMeasurer
): BlockOverlayLayout {
  const width = block.bbox[2] - block.bbox[0];
  const height = block.bbox[3] - block.bbox[1];
  if (width <= 0 || height <= 0 || pageHeight <= 0) {
    return { fontSizeCqh: 2, lines: [{ text: block.text, topPct: 0, scaleX: null }] };
  }

  // Trailing '\n's must not create extra rows, but their characters must stay
  // in the DOM: they ride at the end of the last visible row's text. Interior
  // blank lines DO count as rows (they are blank lines in print).
  const bare = block.text.split('\n');
  let trailingNewlines = 0;
  while (bare.length > 1 && bare[bare.length - 1] === '') {
    bare.pop();
    trailingNewlines += 1;
  }
  const rowCount = bare.length;
  const rowHeight = height / rowCount;
  const fontSize = FONT_FACTOR * rowHeight;

  // Reference scale from the plausibly-full lines: `fullScale` of a full line
  // literally measures the printed-font vs serif-fallback advance ratio.
  const naturalWidths = bare.map((line) => (measure(line) / MEASURE_REFERENCE_PX) * fontSize);
  const maxLineChars = Math.max(...bare.map((line) => line.length), 1);
  const fullScales = naturalWidths.map((w) => (w > 0 ? width / w : null));
  const longScales: number[] = [];
  for (let i = 0; i < bare.length; i += 1) {
    const scale = fullScales[i];
    if (scale != null && bare[i].length >= LONG_LINE_RATIO * maxLineChars) {
      longScales.push(scale);
    }
  }
  const refScale = longScales.length > 0 ? median(longScales) : null;

  // Center each line box (LINE_BOX_FACTOR × fontSize) in its row slot.
  const lineBoxOffset = (rowHeight - LINE_BOX_FACTOR * fontSize) / 2;

  const lines: OverlayLine[] = bare.map((lineText, i) => {
    const isLast = i === rowCount - 1;
    const fullScale = fullScales[i];
    let scaleX: number | null = null;
    if (fullScale != null) {
      // `min` guarantees no line ever overshoots the bbox width; the clamps
      // bound corrupt geometry (merged columns, near-empty wide boxes).
      const fitted = refScale != null ? Math.min(fullScale, refScale) : fullScale;
      const clamped = Math.min(Math.max(fitted, MIN_SCALE), MAX_SCALE);
      scaleX = Math.abs(clamped - 1) < 0.005 ? null : round4(clamped);
    }
    return {
      text: lineText + '\n'.repeat(isLast ? trailingNewlines : 1),
      topPct: round4(((i * rowHeight + lineBoxOffset) / height) * 100),
      scaleX,
    };
  });

  return {
    fontSizeCqh: Math.max((fontSize / pageHeight) * 100, 0.4),
    lines,
  };
}
