import { describe, expect, it } from 'vitest';
import { blockOverlayMetrics } from '../overlayMetrics';

const PAGE_HEIGHT = 1000;

function block(text: string, bbox: [number, number, number, number]) {
  return { text, bbox };
}

describe('blockOverlayMetrics', () => {
  it('distributes rows evenly: line-height = blockHeight / lineCount', () => {
    const m = blockOverlayMetrics(block('سطر أول\nسطر ثان\nسطر ثالث', [0, 0, 400, 300]), PAGE_HEIGHT);
    expect(m.lineHeightCqh).toBeCloseTo((300 / 3 / PAGE_HEIGHT) * 100);
  });

  it('never lets the longest line wrap (f * 0.55 * maxLineChars <= width)', () => {
    const text = 'كلمة قصيرة\nهذا سطر طويل جدا جدا جدا جدا جدا جدا جدا جدا';
    const bbox: [number, number, number, number] = [0, 0, 200, 100];
    const m = blockOverlayMetrics(block(text, bbox), PAGE_HEIGHT);
    const fontSizePdfUnits = (m.fontSizeCqh / 100) * PAGE_HEIGHT;
    const maxLineChars = Math.max(...text.split('\n').map((l) => l.length));
    expect(fontSizePdfUnits * 0.55 * maxLineChars).toBeLessThanOrEqual(200 + 1e-9);
  });

  it('caps the font below the row height', () => {
    const m = blockOverlayMetrics(block('آ\nب', [0, 0, 800, 100]), PAGE_HEIGHT);
    const fontSizePdfUnits = (m.fontSizeCqh / 100) * PAGE_HEIGHT;
    expect(fontSizePdfUnits).toBeLessThanOrEqual(50 * 0.9 + 1e-9);
  });

  it('ignores a trailing newline but counts interior blank lines', () => {
    const trailing = blockOverlayMetrics(block('سطر\nسطر\n', [0, 0, 400, 200]), PAGE_HEIGHT);
    expect(trailing.lineHeightCqh).toBeCloseTo((200 / 2 / PAGE_HEIGHT) * 100);
    const interior = blockOverlayMetrics(block('سطر\n\nسطر', [0, 0, 400, 300]), PAGE_HEIGHT);
    expect(interior.lineHeightCqh).toBeCloseTo((300 / 3 / PAGE_HEIGHT) * 100);
  });

  it('returns safe defaults for degenerate bboxes', () => {
    expect(blockOverlayMetrics(block('نص', [10, 10, 10, 50]), PAGE_HEIGHT)).toEqual({
      fontSizeCqh: 2,
      lineHeightCqh: 2.5,
    });
    expect(blockOverlayMetrics(block('نص', [0, 0, 100, 100]), 0)).toEqual({
      fontSizeCqh: 2,
      lineHeightCqh: 2.5,
    });
  });

  it('applies the 0.4cqh font floor for tiny blocks', () => {
    const m = blockOverlayMetrics(block('نص طويل في صندوق ضئيل للغاية', [0, 0, 4, 2]), PAGE_HEIGHT);
    expect(m.fontSizeCqh).toBe(0.4);
  });

  it('handles empty text as a single row', () => {
    const m = blockOverlayMetrics(block('', [0, 0, 100, 40]), PAGE_HEIGHT);
    expect(m.lineHeightCqh).toBeCloseTo((40 / PAGE_HEIGHT) * 100);
    expect(m.fontSizeCqh).toBeGreaterThan(0);
  });
});
