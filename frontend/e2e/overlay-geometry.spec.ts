import { expect, test } from '@playwright/test';
import type { LayoutBlock } from '../lib/api';
import { blockOverlayLayout } from '../lib/reader/overlayMetrics';
import { renderBlockOverlayHtml } from '../lib/reader/overlayHtml';
import { MEASURE_REFERENCE_PX } from '../lib/reader/lineMeasure';

/**
 * Empirical geometry check for the PDF-overlay text layer: real Chromium
 * layout (no app server needed — the page is built with setContent). Verifies
 * that per-line `scaleX` fitting makes the invisible glyph runs, search marks,
 * and caret hit-testing track the printed-line geometry the layout math
 * promises. Line widths are measured in-page with the same canvas font the
 * runtime measurer uses, then fed into the real layout/HTML builders.
 */

// OCR-space fixture (doc-1 page dimensions): 3 rows, the last one short.
const PAGE_W = 1148;
const PAGE_H = 1820;
const BBOX: [number, number, number, number] = [274, 400, 874, 580]; // 600 × 180
const LINES = [
  'وإذا تطبعت النفس على الكبر كان',
  'أضر عليها من طبع الحدة والعجلة',
  'قال الغزالي',
];
const QUERY = 'طبع الحدة'; // phrase inside line 2
const RENDERED_CANVAS_W = 574; // ×0.5 of the OCR page width
const RENDER_SCALE = RENDERED_CANVAS_W / PAGE_W;

const BLOCK: LayoutBlock = {
  id: '/page/0/Text/0',
  type: 'Text',
  bbox: BBOX,
  text: LINES.join('\n'),
  char_start: 0,
  char_end: LINES.join('\n').length,
};

const PAGE_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  .ilm-pdf-canvas { position: relative; width: ${RENDERED_CANVAS_W}px; aspect-ratio: ${PAGE_W} / ${PAGE_H}; }
  .ilm-pdf-overlay { position: absolute; inset: 0; container-type: size; }
  .ilm-pdf-block {
    position: absolute; overflow: hidden; color: transparent; caret-color: transparent;
    white-space: pre-wrap; cursor: text; font-family: serif; font-weight: 400;
  }
  .ilm-pdf-line { position: absolute; white-space: pre; line-height: 1.1; }
  .ilm-pdf-overlay[dir='rtl'] .ilm-pdf-line { right: 0; transform-origin: right center; }
  .ilm-pdf-overlay[dir='ltr'] .ilm-pdf-line { left: 0; transform-origin: left center; }
  .ilm-pdf-block mark { color: transparent !important; padding: 0; font-weight: inherit; background: rgba(250, 204, 21, 0.45); }
`;

test('overlay lines, search marks and caret mapping track the printed geometry', async ({ page }) => {
  // 1. Measure the fixture strings with the runtime measurer's canvas font.
  const measured: Record<string, number> = await page.evaluate(
    ({ texts, referencePx }) => {
      const context = document.createElement('canvas').getContext('2d')!;
      context.font = `400 ${referencePx}px serif`;
      context.direction = 'rtl';
      return Object.fromEntries(texts.map((t: string) => [t, context.measureText(t).width]));
    },
    { texts: [...LINES, QUERY], referencePx: MEASURE_REFERENCE_PX }
  );
  const measure = (text: string) => measured[text] ?? 0;

  // 2. Build the layout + HTML with the real modules.
  const layout = blockOverlayLayout(BLOCK, PAGE_H, measure);
  const html = renderBlockOverlayHtml(BLOCK, layout, {
    searchQuery: QUERY,
    searchTokens: [],
    highlights: [],
  });

  const [x0, y0, x1, y1] = BBOX;
  const blockStyle =
    `left:${(x0 / PAGE_W) * 100}%;top:${(y0 / PAGE_H) * 100}%;` +
    `width:${((x1 - x0) / PAGE_W) * 100}%;height:${((y1 - y0) / PAGE_H) * 100}%;` +
    `font-size:${layout.fontSizeCqh}cqh`;
  await page.setContent(`
    <style>${PAGE_CSS}</style>
    <div class="ilm-pdf-canvas">
      <div class="ilm-pdf-overlay" dir="rtl">
        <div class="ilm-pdf-block" data-block-id="${BLOCK.id}" data-char-start="0" style="${blockStyle}">${html}</div>
      </div>
    </div>
  `);

  const rowHeightOcr = (y1 - y0) / LINES.length;
  const fontOcr = 0.75 * rowHeightOcr;
  const blockBox = (await page.locator('.ilm-pdf-block').boundingBox())!;
  expect(blockBox.width).toBeCloseTo((x1 - x0) * RENDER_SCALE, 0);

  // 3. Each line's rendered width matches natural-width × scaleX; full lines
  //    hit the bbox width, the short last line does NOT stretch across it.
  const lineBoxes = await page.locator('.ilm-pdf-line').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { width: r.width, top: r.top, right: r.right };
    })
  );
  expect(lineBoxes).toHaveLength(3);
  for (let i = 0; i < 3; i += 1) {
    const naturalOcr = (measure(LINES[i]) / MEASURE_REFERENCE_PX) * fontOcr;
    const expected = naturalOcr * (layout.lines[i].scaleX ?? 1) * RENDER_SCALE;
    expect(Math.abs(lineBoxes[i].width - expected)).toBeLessThan(expected * 0.02);
    // rtl: every line anchors at the block's right edge.
    expect(Math.abs(lineBoxes[i].right - (blockBox.x + blockBox.width))).toBeLessThan(1.5);
  }
  const fullWidth = (x1 - x0) * RENDER_SCALE;
  expect(Math.abs(lineBoxes[0].width - fullWidth)).toBeLessThan(fullWidth * 0.02);
  expect(Math.abs(lineBoxes[1].width - fullWidth)).toBeLessThan(fullWidth * 0.02);
  expect(lineBoxes[2].width).toBeLessThan(fullWidth * 0.75); // short line stays proportional

  // 4. The search mark hugs the matched phrase: inside its line box, width ≈
  //    the phrase's measured width × the line's scale.
  const mark = page.locator('mark.ilm-pdf-search-mark');
  await expect(mark).toHaveCount(1);
  const markBox = (await mark.boundingBox())!;
  const line2 = lineBoxes[1];
  const line2Box = (await page.locator('.ilm-pdf-line').nth(1).boundingBox())!;
  expect(markBox.y + markBox.height / 2).toBeGreaterThan(line2Box.y);
  expect(markBox.y + markBox.height / 2).toBeLessThan(line2Box.y + line2Box.height);
  expect(markBox.width).toBeLessThan(line2.width * 0.5); // a fraction of the line, not the block
  const phraseOcr = (measure(QUERY) / MEASURE_REFERENCE_PX) * fontOcr;
  const expectedMark = phraseOcr * (layout.lines[1].scaleX ?? 1) * RENDER_SCALE;
  expect(Math.abs(markBox.width - expectedMark)).toBeLessThan(expectedMark * 0.03);

  // 5. Caret hit-testing through the transform: the mark's visual center
  //    resolves to a text node inside the mark (selection/dblclick fidelity).
  const caretHitsMark = await page.evaluate(
    ({ x, y }) => {
      const range = document.caretRangeFromPoint(x, y);
      if (!range || range.startContainer.nodeType !== Node.TEXT_NODE) return false;
      return range.startContainer.parentElement?.closest('mark.ilm-pdf-search-mark') != null;
    },
    { x: markBox.x + markBox.width / 2, y: markBox.y + markBox.height / 2 }
  );
  expect(caretHitsMark).toBe(true);

  // 6. Byte identity survives real DOM parsing (selection offset invariant).
  const domText = await page.locator('.ilm-pdf-block').evaluate((el) => el.textContent);
  expect(domText).toBe(BLOCK.text);
});
