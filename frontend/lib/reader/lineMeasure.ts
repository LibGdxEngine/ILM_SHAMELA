/**
 * Canvas text measurement for the PDF-overlay text layer.
 *
 * Lines are measured once at a fixed reference size and scaled linearly by the
 * caller (outline-font advances are linear in size), so the memo cache is
 * font-size-independent. The font string must stay in sync with
 * `.ilm-pdf-block` in globals.css (generic `serif`, weight 400 — pinned there):
 * canvas and DOM then resolve to the same system font and produce identical
 * advance widths, which is what makes per-line `scaleX` fitting exact.
 */

export const MEASURE_REFERENCE_PX = 100;

/** Width of `text` at MEASURE_REFERENCE_PX in the overlay font. */
export type LineMeasurer = (text: string) => number;

const MEASURE_FONT = `400 ${MEASURE_REFERENCE_PX}px serif`;

/** Average Arabic glyph advance (em) in the serif fallback — the constant the
 *  pre-scaleX overlay used to cap font size. Only reached without a canvas
 *  (SSR, jsdom), where a rough-but-finite width beats none. */
const HEURISTIC_ADVANCE_EM = 0.55;

function heuristicMeasurer(text: string): number {
  return text.length * HEURISTIC_ADVANCE_EM * MEASURE_REFERENCE_PX;
}

function createMeasurer(): LineMeasurer {
  if (typeof document === 'undefined') return heuristicMeasurer;
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return heuristicMeasurer;
  context.font = MEASURE_FONT;
  try {
    // Total advance width is order-independent, but rtl removes any bidi
    // ambiguity for mixed Arabic/Latin lines.
    context.direction = 'rtl';
  } catch {
    // Engines without canvas `direction` support: widths are unaffected.
  }
  const cache = new Map<string, number>();
  return (text: string) => {
    const hit = cache.get(text);
    if (hit !== undefined) return hit;
    const width = context.measureText(text).width;
    if (cache.size > 20_000) cache.clear();
    cache.set(text, width);
    return width;
  };
}

let measurer: LineMeasurer | null = null;

/** Module-singleton measurer (per-line widths repeat across re-renders). */
export function getLineMeasurer(): LineMeasurer {
  if (!measurer) measurer = createMeasurer();
  return measurer;
}
