import { describe, expect, it } from 'vitest';
import { blockOverlayLayout, FONT_FACTOR } from '../overlayMetrics';
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
