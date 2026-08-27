import { expect, test } from '@playwright/test';
import type { LayoutBlock, LayoutWord } from '../lib/api';
import { blockOverlayLayout, blockWordLayout } from '../lib/reader/overlayMetrics';
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
  .ilm-pdf-word { position: absolute; white-space: pre; line-height: 1; }
  .ilm-pdf-overlay[dir='rtl'] .ilm-pdf-word { transform-origin: right center; }
  .ilm-pdf-overlay[dir='ltr'] .ilm-pdf-word { transform-origin: left center; }
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

// ---------------------------------------------------------------------------
// Word geometry: the backend aligned OCR words to the block text, so each
// word is its own absolutely-positioned span fitted to its measured box.
// The fixture builds the word boxes FROM the canvas measurements (scaled by a
// per-row factor), so every expected rect is exact, not approximate.

const WORD_BBOX: [number, number, number, number] = [124, 400, 1024, 580]; // 900 × 180, 3 rows of 60
const ROW_PITCH = 60;
const ROW_HEIGHT = 40; // uniform OCR row box inside each pitch slot
const WORD_GAP = 16;
const ROW_SCALES = [1.2, 0.9, 1.0]; // stretched, condensed, exact (→ no transform)
const WORD_QUERY = 'طبع الحدة'; // two adjacent words on row 2

test('word spans, marks, caret mapping and selection track the OCR word boxes', async ({ page }) => {
  const text = LINES.join('\n');
  const tokens = Array.from(text.matchAll(/\S+/g)).map((m) => ({ text: m[0], start: m.index!, end: m.index! + m[0].length }));
  const rowOf = (start: number) => text.slice(0, start).split('\n').length - 1;

  // 1. Measure every token with the runtime measurer's canvas font.
  const measured: Record<string, number> = await page.evaluate(
    ({ texts, referencePx }) => {
      const context = document.createElement('canvas').getContext('2d')!;
      context.font = `400 ${referencePx}px serif`;
      context.direction = 'rtl';
      return Object.fromEntries(texts.map((t: string) => [t, context.measureText(t).width]));
    },
    { texts: tokens.map((t) => t.text), referencePx: MEASURE_REFERENCE_PX }
  );
  const measure = (t: string) => measured[t] ?? 0;

  // 2. Lay the words out rtl from the block's right edge, row by row.
  const [bx0, by0, bx1] = WORD_BBOX;
  const fontOcr = 0.9 * ROW_HEIGHT; // WORD_FONT_FACTOR
  const words: LayoutWord[] = [];
  let cursor = bx1;
  let currentRow = -1;
  for (const token of tokens) {
    const row = rowOf(token.start);
    if (row !== currentRow) {
      currentRow = row;
      cursor = bx1;
    }
    const natural = (measure(token.text) / MEASURE_REFERENCE_PX) * fontOcr;
    const width = natural * ROW_SCALES[row];
    const x1 = cursor;
    const x0 = x1 - width;
    expect(x0).toBeGreaterThan(bx0); // fixture sanity: never clipped by the block
    const y0 = by0 + row * ROW_PITCH + (ROW_PITCH - ROW_HEIGHT) / 2;
    words.push({ start: token.start, end: token.end, bbox: [x0, y0, x1, y0 + ROW_HEIGHT], line: row, matched: true });
    cursor = x0 - WORD_GAP;
  }
  const block: LayoutBlock = {
    id: '/page/0/Text/1',
    type: 'Text',
    bbox: WORD_BBOX,
    text,
    char_start: 0,
    char_end: text.length,
    words,
  };

  // 3. Build the layout + HTML with the real modules.
  const layout = blockWordLayout(block, PAGE_H, measure, 'rtl');
  expect(layout).not.toBeNull();
  expect(layout!.words[tokens.length - 1].scaleX).toBeNull(); // row 3 scale 1.0 → no transform
  const html = renderBlockOverlayHtml(block, layout!, { searchQuery: WORD_QUERY, searchTokens: [], highlights: [] });

  const blockStyle =
    `left:${(bx0 / PAGE_W) * 100}%;top:${(by0 / PAGE_H) * 100}%;` +
    `width:${((bx1 - bx0) / PAGE_W) * 100}%;height:${((WORD_BBOX[3] - by0) / PAGE_H) * 100}%`;
  await page.setContent(`
    <style>${PAGE_CSS}</style>
    <div class="ilm-pdf-canvas">
      <div class="ilm-pdf-overlay" dir="rtl">
        <div class="ilm-pdf-block" data-block-id="${block.id}" data-char-start="0" style="${blockStyle}">${html}</div>
      </div>
    </div>
  `);
  const blockBox = (await page.locator('.ilm-pdf-block').boundingBox())!;
  const blockRight = blockBox.x + blockBox.width;

  // 4. One span per word; the TOKEN's glyph box (a Range over its characters,
  //    so the trailing space hanging into the gap is excluded) matches the
  //    stored bbox × render scale; the span's row box matches the OCR row.
  const spans = page.locator('.ilm-pdf-word');
  await expect(spans).toHaveCount(tokens.length);
  const rects = await spans.evaluateAll((els, tokenLens: number[]) =>
    els.map((el, idx) => {
      const range = document.createRange();
      range.setStart(el, 0);
      let remaining = tokenLens[idx];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node: Node | null = walker.nextNode();
      while (node) {
        const len = (node.textContent ?? '').length;
        if (remaining <= len) {
          range.setEnd(node, remaining);
          break;
        }
        remaining -= len;
        node = walker.nextNode();
      }
      const r = range.getBoundingClientRect();
      const s = el.getBoundingClientRect();
      return { right: r.right, width: r.width, cx: r.left + r.width / 2, cy: r.top + r.height / 2, spanTop: s.top, spanHeight: s.height };
    }),
    tokens.map((t) => t.text.length)
  );
  for (let i = 0; i < tokens.length; i += 1) {
    const [x0, y0, x1] = words[i].bbox;
    const expectedWidth = (x1 - x0) * RENDER_SCALE;
    // 2% like the line test, with a 2px floor: per-glyph font hinting at
    // ~18px shifts a 3-letter word's advance by ~1px either way, which the
    // 100px canvas reference cannot predict (it averages out over a line).
    expect(Math.abs(rects[i].width - expectedWidth)).toBeLessThan(Math.max(expectedWidth * 0.02, 2));
    expect(Math.abs(rects[i].right - (blockRight - (bx1 - x1) * RENDER_SCALE))).toBeLessThan(1.5);
    expect(Math.abs(rects[i].spanTop - (blockBox.y + (y0 - by0) * RENDER_SCALE))).toBeLessThan(1.5);
    // A single row even for the spans that carry the separator '\n'.
    expect(Math.abs(rects[i].spanHeight - ROW_HEIGHT * RENDER_SCALE)).toBeLessThan(ROW_HEIGHT * RENDER_SCALE * 0.02);
  }

  // 5. Caret hit-testing through the per-word transforms: each token's visual
  //    centre resolves into its own span.
  const caretHits = await page.evaluate(
    (points: { cx: number; cy: number }[]) => {
      const all = Array.from(document.querySelectorAll('.ilm-pdf-word'));
      return points.map(({ cx, cy }) => {
        const range = document.caretRangeFromPoint(cx, cy);
        if (!range || range.startContainer.nodeType !== Node.TEXT_NODE) return -1;
        const span = range.startContainer.parentElement?.closest('.ilm-pdf-word');
        return span ? all.indexOf(span) : -1;
      });
    },
    rects.map(({ cx, cy }) => ({ cx, cy }))
  );
  expect(caretHits).toEqual(tokens.map((_, i) => i));

  // 6. A phrase across two words → one mark fragment per word, each hugging
  //    its word: the first ends at its word's right edge, the second starts at
  //    its word's left edge.
  const marks = page.locator('mark.ilm-pdf-search-mark');
  await expect(marks).toHaveCount(2);
  const markInfo = await marks.evaluateAll((els) => {
    const all = Array.from(document.querySelectorAll('.ilm-pdf-word'));
    return els.map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, span: all.indexOf(el.closest('.ilm-pdf-word')!) };
    });
  });
  const first = tokens.findIndex((t) => t.text === 'طبع');
  expect(markInfo[0].span).toBe(first);
  expect(markInfo[1].span).toBe(first + 1);
  expect(Math.abs(markInfo[0].right - (blockRight - (bx1 - words[first].bbox[2]) * RENDER_SCALE))).toBeLessThan(1.5);
  expect(Math.abs(markInfo[1].left - (blockRight - (bx1 - words[first + 1].bbox[0]) * RENDER_SCALE))).toBeLessThan(1.5);

  // 7. Byte identity and selection text: a Range from word 2 to word 4 reads
  //    the exact substring, both as a Range and as the live Selection.
  const domText = await page.locator('.ilm-pdf-block').evaluate((el) => el.textContent);
  expect(domText).toBe(block.text);
  const expectedSelection = text.slice(words[1].start, words[3].end);
  const selected = await page.evaluate((endTokenLen: number) => {
    const all = Array.from(document.querySelectorAll('.ilm-pdf-word'));
    const range = document.createRange();
    range.setStart(all[1], 0);
    let remaining = endTokenLen;
    const walker = document.createTreeWalker(all[3], NodeFilter.SHOW_TEXT);
    let node: Node | null = walker.nextNode();
    while (node) {
      const len = (node.textContent ?? '').length;
      if (remaining <= len) {
        range.setEnd(node, remaining);
        break;
      }
      remaining -= len;
      node = walker.nextNode();
    }
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    return { range: range.toString(), selection: selection.toString() };
  }, tokens[3].text.length);
  expect(selected.range).toBe(expectedSelection);
  expect(selected.selection).toBe(expectedSelection);
});
