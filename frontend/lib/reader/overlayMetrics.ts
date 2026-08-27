import type { LayoutBlock, LayoutWord } from '@/lib/api';
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
  kind: 'lines';
  /** Font size in cqh relative to `.ilm-pdf-overlay` (the size container). */
  fontSizeCqh: number;
  lines: OverlayLine[];
}

export interface OverlayWord {
  /**
   * DOM text of the word's span: the token plus every character up to the
   * next word's start (its trailing whitespace / separator newlines). The
   * first span starts at 0 and the last one runs to the end of the text, so
   * concatenating `words[].text` reproduces `block.text` byte-for-byte.
   */
  text: string;
  /** Top of the row box, % of the BLOCK height. */
  topPct: number;
  /** Inline-start offset of the word box (from the block's right edge in rtl,
   *  left edge in ltr), % of the BLOCK width. */
  startPct: number;
  /** Font size in cqh (% of page height) — `WORD_FONT_FACTOR` × row height. */
  fontSizeCqh: number;
  /** Row height in cqh: the span's line-height, so `::selection` paints
   *  uniform rows that match the printed line. */
  lineHeightCqh: number;
  /** Horizontal scale fitting the token's glyph run to its printed box; null → no transform. */
  scaleX: number | null;
}

export interface WordOverlayLayout {
  kind: 'words';
  /** Block direction — decides whether spans anchor with `right` or `left`. */
  direction: 'rtl' | 'ltr';
  words: OverlayWord[];
}

/** Font size as a fraction of the row pitch (tuned against real page scans). */
export const FONT_FACTOR = 0.75;
/** Line-box height factor — keep in sync with `.ilm-pdf-line { line-height }`. */
export const LINE_BOX_FACTOR = 1.1;
/** Word-geometry font size as a fraction of the OCR row height: the serif
 *  content area (~1.15em) then covers the row, so mark backgrounds span the
 *  printed ink incl. Arabic ascenders/descenders. Horizontal fidelity does not
 *  depend on it — `scaleX` fits the glyph run to the measured word box. */
export const WORD_FONT_FACTOR = 0.9;

/** A line at least this fraction of the longest line's length counts as a
 *  "full" printed line and votes on the block's reference scale. */
const LONG_LINE_RATIO = 0.6;
const MIN_SCALE = 0.5;
const MAX_SCALE = 4;
/** Word boxes come from real OCR geometry, so the clamps only bound corrupt
 *  data (a box the width of a page, a slice of a glyph). */
const WORD_MIN_SCALE = 0.25;
const WORD_MAX_SCALE = 6;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
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
    return { kind: 'lines', fontSizeCqh: 2, lines: [{ text: block.text, topPct: 0, scaleX: null }] };
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
    kind: 'lines',
    fontSizeCqh: Math.max((fontSize / pageHeight) * 100, 0.4),
    lines,
  };
}

function isFiniteBbox(bbox: unknown): bbox is [number, number, number, number] {
  return Array.isArray(bbox) && bbox.length === 4 && bbox.every((v) => typeof v === 'number' && Number.isFinite(v));
}

/**
 * True when `words` is a complete, ordered partition of a text of
 * `textLength` characters: every token is non-empty (`start < end`), tokens
 * never overlap or reorder (`end_i <= start_{i+1}`, starts strictly
 * increasing), and all offsets stay inside the text. Anything else means the
 * stored geometry does not describe this text (e.g. the block text was
 * re-extracted after the words were computed) and the line model must be used
 * instead — rendering a partial partition would corrupt every selection offset
 * after the first gap.
 */
export function validWordPartition(
  words: readonly LayoutWord[] | null | undefined,
  textLength: number
): words is readonly LayoutWord[] {
  if (!Array.isArray(words) || words.length === 0 || textLength <= 0) return false;
  let previousEnd = 0;
  let previousStart = -1;
  for (const word of words) {
    if (!word || typeof word !== 'object') return false;
    const { start, end } = word;
    if (!Number.isInteger(start) || !Number.isInteger(end)) return false;
    if (start < 0 || end > textLength || end <= start) return false;
    if (start <= previousStart || start < previousEnd) return false;
    if (!isFiniteBbox(word.bbox)) return false;
    previousStart = start;
    previousEnd = end;
  }
  return true;
}

/**
 * Per-word layout from backend word geometry (`block.words`, produced by
 * OCR-ing the page and aligning the words to `block.text`). Each word becomes
 * an absolutely-positioned span whose glyph run is fitted to its measured
 * box with `scaleX`, exactly like the line model but at word granularity —
 * so native selection, hit testing and copied text refer to the printed word.
 *
 * Geometry contract (see the backend `word_geometry` module): bboxes are in
 * the block's OCR pixel space, clipped to the block, and every word on the
 * same `line` shares one uniform y-range (the OCR row), which is what makes
 * `::selection` paint clean rows. Positions are emitted as percentages of
 * the BLOCK box (the block is itself absolutely positioned in the overlay).
 *
 * Returns `null` — "use `blockOverlayLayout`" — when the block carries no
 * usable words: absent, not a valid partition of `block.text`, or a
 * degenerate block/row box.
 */
export function blockWordLayout(
  block: Pick<LayoutBlock, 'text' | 'bbox' | 'words'>,
  pageHeight: number,
  measure: LineMeasurer,
  direction: 'rtl' | 'ltr'
): WordOverlayLayout | null {
  const { text, words } = block;
  if (!validWordPartition(words, text.length)) return null;
  const [bx0, by0, bx1, by1] = block.bbox;
  const blockWidth = bx1 - bx0;
  const blockHeight = by1 - by0;
  if (!(blockWidth > 0) || !(blockHeight > 0) || !(pageHeight > 0)) return null;

  const rtl = direction === 'rtl';
  const out: OverlayWord[] = [];
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    const spanStart = i === 0 ? 0 : word.start;
    const spanEnd = i === words.length - 1 ? text.length : words[i + 1].start;
    const token = text.slice(word.start, word.end);

    // Clip to the block: the span must never escape its (overflow:hidden) block.
    const x0 = clamp(word.bbox[0], bx0, bx1);
    const x1 = clamp(word.bbox[2], bx0, bx1);
    const y0 = clamp(word.bbox[1], by0, by1);
    const y1 = clamp(word.bbox[3], by0, by1);
    const rowHeight = y1 - y0;
    if (!(rowHeight > 0)) return null;

    const fontSize = WORD_FONT_FACTOR * rowHeight;
    const natural = (measure(token) / MEASURE_REFERENCE_PX) * fontSize;
    let scaleX: number | null = null;
    if (natural > 0) {
      const fitted = clamp((x1 - x0) / natural, WORD_MIN_SCALE, WORD_MAX_SCALE);
      scaleX = Math.abs(fitted - 1) < 0.005 ? null : round4(fitted);
    }

    out.push({
      text: text.slice(spanStart, spanEnd),
      topPct: round4(((y0 - by0) / blockHeight) * 100),
      startPct: round4(((rtl ? bx1 - x1 : x0 - bx0) / blockWidth) * 100),
      fontSizeCqh: round4((fontSize / pageHeight) * 100),
      lineHeightCqh: round4((rowHeight / pageHeight) * 100),
      scaleX,
    });
  }
  return { kind: 'words', direction, words: out };
}
