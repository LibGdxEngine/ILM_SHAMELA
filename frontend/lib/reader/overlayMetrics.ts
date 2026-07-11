import type { LayoutBlock } from '@/lib/api';

export interface OverlayBlockMetrics {
  /** Font size in cqh relative to `.ilm-pdf-overlay` (the size container). */
  fontSizeCqh: number;
  /** One row per explicit '\n' line, rows distributed over the block height. */
  lineHeightCqh: number;
}

/**
 * Metrics for the invisible OCR text so each explicit line sits on its printed
 * line: line-height = blockHeight / lineCount distributes the rows evenly, and
 * the font size is capped so no line ever wraps (a wrapped line would shift
 * every following row off its printed line). Sizes are returned in `cqh`
 * relative to `.ilm-pdf-overlay` (100cqh = page height): an element cannot be
 * its own container, so the units resolve against the overlay ancestor —
 * without it they'd fall back to the viewport and come out ~8× too large.
 */
export function blockOverlayMetrics(
  block: Pick<LayoutBlock, 'text' | 'bbox'>,
  pageHeight: number
): OverlayBlockMetrics {
  const width = block.bbox[2] - block.bbox[0];
  const height = block.bbox[3] - block.bbox[1];
  if (width <= 0 || height <= 0 || pageHeight <= 0) {
    return { fontSizeCqh: 2, lineHeightCqh: 2.5 };
  }

  // Trailing '\n' from the OCR pipeline must not compress the rows; interior
  // blank lines DO count (pre-wrap renders them as line boxes).
  const lines = block.text.split('\n');
  while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const rowHeight = height / lines.length;

  // Area heuristic (avg glyph box ≈ 0.62·f²), then cap so a row fits its slot
  // vertically and the longest line fits the block width (avg Arabic glyph
  // advance ≈ 0.55em in the serif fallback; justified gaps make up the slack).
  const len = Math.max(block.text.length, 1);
  const maxLineChars = Math.max(...lines.map((l) => l.length), 1);
  let fontSize = Math.sqrt((width * height) / (len * 0.62));
  fontSize = Math.min(fontSize, rowHeight * 0.9);
  fontSize = Math.min(fontSize, width / (maxLineChars * 0.55));

  return {
    fontSizeCqh: Math.max((fontSize / pageHeight) * 100, 0.4),
    lineHeightCqh: (rowHeight / pageHeight) * 100,
  };
}
