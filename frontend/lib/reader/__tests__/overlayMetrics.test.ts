import { describe, expect, it } from 'vitest';
import type { LayoutWord } from '../../api';
import { blockOverlayLayout, blockWordLayout, FONT_FACTOR, validWordPartition, WORD_FONT_FACTOR } from '../overlayMetrics';
import { MEASURE_REFERENCE_PX, type LineMeasurer } from '../lineMeasure';

const PAGE_HEIGHT = 1000;

/** Deterministic measurer: every char advances exactly 1em (100 units at the
 *  reference size), so naturalWidth = charCount × fontSize. */
const perCharMeasurer: LineMeasurer = (text) => text.length * MEASURE_REFERENCE_PX;

function block(text: string, bbox: [number, number, number, number]) {
  return { text, bbox };
}

function concatenated(layout: ReturnType<typeof blockOverlayLayout>): string {
  return layout.lines.map((l) => l.text).join('');
}

describe('blockOverlayLayout', () => {
  it('distributes rows evenly and centers each line box in its slot', () => {
    const layout = blockOverlayLayout(
      block('سطر أول\nسطر ثان\nسطر ثالث', [0, 0, 400, 300]),
      PAGE_HEIGHT,
      perCharMeasurer
    );
    expect(layout.lines).toHaveLength(3);
    const rowHeight = 300 / 3;
    const fontSize = FONT_FACTOR * rowHeight;
    const offset = (rowHeight - 1.1 * fontSize) / 2;
    layout.lines.forEach((line, i) => {
      expect(line.topPct).toBeCloseTo(((i * rowHeight + offset) / 300) * 100, 3);
    });
  });

  it('keeps the concatenated line texts byte-identical to block.text', () => {
    for (const text of ['سطر\nسطر', 'سطر\nسطر\n', 'سطر\nسطر\n\n', 'سطر\n\nسطر', '', '\n']) {
      const layout = blockOverlayLayout(block(text, [0, 0, 400, 200]), PAGE_HEIGHT, perCharMeasurer);
      expect(concatenated(layout)).toBe(text);
    }
  });

  it('ignores trailing newlines for the row count but keeps their characters', () => {
    const layout = blockOverlayLayout(block('سطر\nسطر\n\n', [0, 0, 400, 200]), PAGE_HEIGHT, perCharMeasurer);
    expect(layout.lines).toHaveLength(2);
    expect(layout.lines[1].text).toBe('سطر\n\n');
  });

  it('counts interior blank lines as rows with no transform', () => {
    const layout = blockOverlayLayout(block('سطر\n\nسطر', [0, 0, 400, 300]), PAGE_HEIGHT, perCharMeasurer);
    expect(layout.lines).toHaveLength(3);
    expect(layout.lines[1].text).toBe('\n');
    expect(layout.lines[1].scaleX).toBeNull();
  });

  it('fits full lines to the bbox width and gives short lines the reference scale', () => {
    // Two rows, rowHeight 50 → fontSize 37.5. Long line: 20 chars → natural
    // 750; bbox width 937.5 → fullScale 1.25 (the reference). Short line:
    // 5 chars → natural 187.5 → fullScale 5, capped to the reference 1.25.
    const long = 'ابجدهوزحطيكلمنسعفصقر';
    const short = 'ابجده';
    const layout = blockOverlayLayout(block(`${long}\n${short}`, [0, 0, 937.5, 100]), PAGE_HEIGHT, perCharMeasurer);
    expect(layout.lines[0].scaleX).toBeCloseTo(1.25, 4);
    expect(layout.lines[1].scaleX).toBeCloseTo(1.25, 4);
  });

  it('emits null instead of a no-op transform when the scale is ~1', () => {
    // 20 chars × fontSize 37.5 = natural 750 = bbox width → scale 1 → null.
    const long = 'ابجدهوزحطيكلمنسعفصقر';
    const layout = blockOverlayLayout(block(long, [0, 0, 750, 50]), PAGE_HEIGHT, perCharMeasurer);
    expect(layout.lines[0].scaleX).toBeNull();
  });

  it('clamps runaway scales into [0.5, 4]', () => {
    // Single line has no independent reference: 2 chars in a very wide box
    // → fullScale 40, clamped to 4.
    const wide = blockOverlayLayout(block('اب', [0, 0, 3000, 50]), PAGE_HEIGHT, perCharMeasurer);
    expect(wide.lines[0].scaleX).toBe(4);
    // 40 chars crammed into a narrow box → fullScale 0.1, clamped to 0.5.
    const narrow = blockOverlayLayout(
      block('ابجدهوزحطيكلمنسعفصقرابجدهوزحطيكلمنسعفصقر', [0, 0, 150, 50]),
      PAGE_HEIGHT,
      perCharMeasurer
    );
    expect(narrow.lines[0].scaleX).toBe(0.5);
  });

  it('derives fontSizeCqh from the row height with the 0.4 floor', () => {
    const layout = blockOverlayLayout(block('آ\nب', [0, 0, 800, 100]), PAGE_HEIGHT, perCharMeasurer);
    expect(layout.fontSizeCqh).toBeCloseTo(((FONT_FACTOR * 50) / PAGE_HEIGHT) * 100, 4);
    const tiny = blockOverlayLayout(block('نص', [0, 0, 4, 2]), PAGE_HEIGHT, perCharMeasurer);
    expect(tiny.fontSizeCqh).toBe(0.4);
  });

  it('returns a safe single line for degenerate bboxes', () => {
    const layout = blockOverlayLayout(block('نص\nآخر', [10, 10, 10, 50]), PAGE_HEIGHT, perCharMeasurer);
    expect(layout.fontSizeCqh).toBe(2);
    expect(layout.lines).toHaveLength(1);
    expect(layout.lines[0]).toEqual({ text: 'نص\nآخر', topPct: 0, scaleX: null });
    expect(blockOverlayLayout(block('نص', [0, 0, 100, 100]), 0, perCharMeasurer).fontSizeCqh).toBe(2);
  });

  it('handles empty text as a single transform-less row', () => {
    const layout = blockOverlayLayout(block('', [0, 0, 100, 40]), PAGE_HEIGHT, perCharMeasurer);
    expect(layout.lines).toHaveLength(1);
    expect(layout.lines[0].text).toBe('');
    expect(layout.lines[0].scaleX).toBeNull();
    expect(layout.fontSizeCqh).toBeGreaterThan(0);
  });
});

describe('validWordPartition', () => {
  const w = (start: number, end: number): LayoutWord => ({ start, end, bbox: [0, 0, 10, 10], line: 0, matched: true });

  it('accepts an ordered, non-overlapping partition', () => {
    expect(validWordPartition([w(0, 2), w(3, 5), w(6, 9)], 9)).toBe(true);
    // Text after the last token rides on the last word's span.
    expect(validWordPartition([w(0, 2), w(3, 5)], 9)).toBe(true);
  });

  it('rejects empty, unordered, overlapping, empty-token and out-of-range words', () => {
    expect(validWordPartition([], 9)).toBe(false);
    expect(validWordPartition(undefined, 9)).toBe(false);
    expect(validWordPartition([w(0, 2)], 0)).toBe(false);
    expect(validWordPartition([w(3, 5), w(0, 2)], 9)).toBe(false); // reordered
    expect(validWordPartition([w(0, 4), w(3, 5)], 9)).toBe(false); // overlapping
    expect(validWordPartition([w(0, 0), w(3, 5)], 9)).toBe(false); // empty token
    expect(validWordPartition([w(0, 2), w(3, 12)], 9)).toBe(false); // past the end
    expect(validWordPartition([w(0, 2), w(9, 10)], 9)).toBe(false); // starts at the end
    expect(validWordPartition([{ ...w(0, 2), bbox: [0, 0, Number.NaN, 1] }], 9)).toBe(false);
  });
});

describe('blockWordLayout', () => {
  const TEXT = 'اب جد\nهوز';
  const WORDS: LayoutWord[] = [
    { start: 0, end: 2, bbox: [400, 200, 500, 250], line: 0, matched: true },
    { start: 3, end: 5, bbox: [250, 200, 350, 250], line: 0, matched: true },
    { start: 6, end: 9, bbox: [200, 250, 500, 300], line: 1, matched: false },
  ];
  const BBOX: [number, number, number, number] = [100, 200, 500, 300]; // 400 × 100
  const wordBlock = (overrides: Partial<{ text: string; bbox: [number, number, number, number]; words: LayoutWord[] }> = {}) => ({
    text: TEXT,
    bbox: BBOX,
    words: WORDS,
    ...overrides,
  });
  const rtl = (b: Parameters<typeof blockWordLayout>[0] = wordBlock(), pageHeight = PAGE_HEIGHT) =>
    blockWordLayout(b, pageHeight, perCharMeasurer, 'rtl');

  it('returns null without usable words or with degenerate geometry', () => {
    expect(rtl(block('اب', [0, 0, 10, 10]))).toBeNull();
    expect(rtl(wordBlock({ words: [] }))).toBeNull();
    expect(rtl(wordBlock({ words: [WORDS[1], WORDS[0], WORDS[2]] }))).toBeNull();
    expect(rtl(wordBlock({ bbox: [100, 200, 100, 300] }))).toBeNull();
    expect(rtl(wordBlock(), 0)).toBeNull();
    // A word entirely outside the block collapses to an empty row after clipping.
    expect(rtl(wordBlock({ words: [{ ...WORDS[0], bbox: [400, 100, 500, 150] }, WORDS[1], WORDS[2]] }))).toBeNull();
  });

  it('partitions the text so the span texts concatenate to block.text', () => {
    const layout = rtl()!;
    expect(layout.kind).toBe('words');
    expect(layout.words.map((w) => w.text)).toEqual(['اب ', 'جد\n', 'هوز']);
    expect(layout.words.map((w) => w.text).join('')).toBe(TEXT);
  });

  it('anchors rtl words from the block right edge and ltr words from the left', () => {
    const r = rtl()!;
    expect(r.direction).toBe('rtl');
    expect(r.words.map((w) => w.startPct)).toEqual([0, 37.5, 0]);
    expect(r.words.map((w) => w.topPct)).toEqual([0, 0, 50]);
    const l = blockWordLayout(wordBlock(), PAGE_HEIGHT, perCharMeasurer, 'ltr')!;
    expect(l.direction).toBe('ltr');
    expect(l.words.map((w) => w.startPct)).toEqual([75, 37.5, 25]);
  });

  it('sizes the font from the row height and fits each token with scaleX', () => {
    const layout = rtl()!;
    // Row height 50 → font 45; per-char measurer → natural = chars × 45.
    for (const w of layout.words) {
      expect(w.fontSizeCqh).toBeCloseTo(((WORD_FONT_FACTOR * 50) / PAGE_HEIGHT) * 100, 4);
      expect(w.lineHeightCqh).toBeCloseTo((50 / PAGE_HEIGHT) * 100, 4);
    }
    expect(layout.words[0].scaleX).toBeCloseTo(100 / 90, 4);
    expect(layout.words[1].scaleX).toBeCloseTo(100 / 90, 4);
    expect(layout.words[2].scaleX).toBeCloseTo(300 / 135, 4);
  });

  it('emits null for a ~1 scale and clamps corrupt boxes into [0.25, 6]', () => {
    const exact = rtl(wordBlock({ words: [{ ...WORDS[0], bbox: [410, 200, 500, 250] }, WORDS[1], WORDS[2]] }))!;
    expect(exact.words[0].scaleX).toBeNull(); // 90 / 90
    const wide = rtl(wordBlock({ words: [{ ...WORDS[0], bbox: [100, 200, 500, 202] }, WORDS[1], WORDS[2]] }))!;
    expect(wide.words[0].scaleX).toBe(6); // 400 / (2 × 1.8)
    const narrow = rtl(wordBlock({ words: [{ ...WORDS[0], bbox: [499, 200, 500, 250] }, WORDS[1], WORDS[2]] }))!;
    expect(narrow.words[0].scaleX).toBe(0.25); // 1 / 90
  });

  it('clips word boxes to the block box', () => {
    const layout = rtl(wordBlock({ words: [{ ...WORDS[0], bbox: [400, 150, 600, 250] }, WORDS[1], WORDS[2]] }))!;
    expect(layout.words[0].startPct).toBe(0); // x1 600 → 500
    expect(layout.words[0].topPct).toBe(0); // y0 150 → 200
    expect(layout.words[0].lineHeightCqh).toBeCloseTo((50 / PAGE_HEIGHT) * 100, 4);
  });
});
