import { describe, expect, it } from 'vitest';
import type { LayoutBlock, LayoutWord } from '../../api';
import type { ApiHighlight } from '../../api/reader';
import { blockOverlayLayout, blockWordLayout } from '../overlayMetrics';
import { renderBlockOverlayHtml } from '../overlayHtml';
import { MEASURE_REFERENCE_PX, type LineMeasurer } from '../lineMeasure';

const perCharMeasurer: LineMeasurer = (text) => text.length * MEASURE_REFERENCE_PX;

function makeBlock(text: string, charStart = 0): LayoutBlock {
  return {
    id: '/page/0/Text/0',
    type: 'Text',
    bbox: [0, 0, 400, 100],
    text,
    char_start: charStart,
    char_end: charStart + text.length,
  };
}

function highlight(overrides: Partial<ApiHighlight>): ApiHighlight {
  return { id: 5, color: 'green', page_number: 1, paragraph_id: '/page/0/Text/0', char_start: 0, char_end: 0, ...overrides } as ApiHighlight;
}

function render(
  text: string,
  opts: { searchQuery?: string; searchTokens?: readonly string[]; highlights?: ApiHighlight[] } = {},
  charStart = 0
): HTMLDivElement {
  const block = makeBlock(text, charStart);
  const layout = blockOverlayLayout(block, 1000, perCharMeasurer);
  const html = renderBlockOverlayHtml(block, layout, {
    searchQuery: opts.searchQuery ?? '',
    searchTokens: opts.searchTokens ?? [],
    highlights: opts.highlights ?? [],
  });
  const div = document.createElement('div');
  div.innerHTML = html;
  return div;
}

describe('renderBlockOverlayHtml', () => {
  it('keeps the concatenated DOM text byte-identical to block.text', () => {
    const texts = [
      'سطر أول\nسطر ثان\nسطر ثالث',
      'سطر\nسطر\n',
      'سطر\nسطر\n\n',
      'سطر\n\nسطر',
      'قال & <قيل> "ثم" \'بعد\'\nسطر ثان',
      '',
      '\n',
    ];
    for (const text of texts) {
      expect(render(text).textContent).toBe(text);
    }
  });

  it('keeps byte identity when marks and highlights are present', () => {
    const text = 'بسم الله\nالرحمن الرحيم';
    const div = render(text, {
      searchQuery: 'الرحمن',
      searchTokens: ['الرحيم'],
      highlights: [highlight({ char_start: 2, char_end: 12 })],
    });
    expect(div.textContent).toBe(text);
  });

  it('emits one span per line with top/transform styles', () => {
    const div = render('سطر أول\nسطر ثان');
    const spans = div.querySelectorAll('span.ilm-pdf-line');
    expect(spans).toHaveLength(2);
    for (const span of Array.from(spans)) {
      expect(span.getAttribute('style')).toMatch(/^top:[\d.]+%/);
    }
  });

  it('splits a phrase match spanning a line boundary into per-line marks without newlines', () => {
    const text = 'بسم الله\nالرحمن الرحيم';
    const div = render(text, { searchQuery: 'الله الرحمن' });
    const marks = div.querySelectorAll('mark.ilm-pdf-search-mark');
    expect(marks).toHaveLength(2);
    expect(marks[0].textContent).toBe('الله');
    expect(marks[1].textContent).toBe('الرحمن');
    for (const mark of Array.from(marks)) {
      expect(mark.textContent).not.toContain('\n');
      expect(mark.closest('span.ilm-pdf-line')).not.toBeNull();
    }
  });

  it('splits a highlight spanning lines into fragments sharing one data-hid', () => {
    const text = 'بسم الله\nالرحمن الرحيم';
    // Page-level offsets: block anchored at 100, highlight covers 'الله\nالرحمن'.
    const div = render(text, { highlights: [highlight({ char_start: 104, char_end: 115 })] }, 100);
    const marks = div.querySelectorAll('mark[data-hid="5"]');
    expect(marks).toHaveLength(2);
    for (const mark of Array.from(marks)) {
      expect(mark.textContent).not.toContain('\n');
      expect(mark.classList.contains('highlight-green')).toBe(true);
    }
    expect(div.textContent).toBe(text);
  });

  it('marks whole-token phrase occurrences of the query with the strong style', () => {
    const div = render('في العلم فائدة', { searchQuery: 'العلم' });
    const marks = div.querySelectorAll('mark.ilm-pdf-search-mark');
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe('العلم');
    expect(marks[0].classList.contains('ilm-pdf-search-mark--near')).toBe(false);
  });

  it('does not mark sub-word occurrences the backend would never report', () => {
    const div = render('جاء العلماء جميعا', { searchQuery: 'علم' });
    expect(div.querySelectorAll('mark')).toHaveLength(0);
  });

  it('marks matched surface tokens with the lighter --near style', () => {
    const div = render('قرأت كتابهم كله', { searchQuery: 'كتاب', searchTokens: ['كتابهم'] });
    const marks = div.querySelectorAll('mark.ilm-pdf-search-mark--near');
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe('كتابهم');
  });

  it('keeps the strong style where a token coincides with an exact phrase hit', () => {
    const div = render('في العلم فائدة', { searchQuery: 'العلم', searchTokens: ['العلم'] });
    const marks = div.querySelectorAll('mark.ilm-pdf-search-mark');
    expect(marks).toHaveLength(1);
    expect(marks[0].classList.contains('ilm-pdf-search-mark--near')).toBe(false);
  });

  it('nests a search mark around a user highlight on the same segment', () => {
    const div = render('في العلم فائدة', {
      searchQuery: 'العلم',
      highlights: [highlight({ char_start: 3, char_end: 8 })],
    });
    const search = div.querySelector('mark.ilm-pdf-search-mark');
    expect(search).not.toBeNull();
    expect(search?.querySelector('mark[data-hid="5"]')).not.toBeNull();
    expect(div.textContent).toBe('في العلم فائدة');
  });
});

/** Word geometry fixture: one box per `\S+` token laid rtl across the block. */
function wordsFor(text: string): LayoutWord[] {
  return Array.from(text.matchAll(/\S+/g)).map((m, i) => ({
    start: m.index!,
    end: m.index! + m[0].length,
    bbox: [400 - (i + 1) * 50, 0, 400 - i * 50, 50],
    line: 0,
    matched: true,
  }));
}

function renderWords(
  text: string,
  opts: { searchQuery?: string; searchTokens?: readonly string[]; highlights?: ApiHighlight[] } = {},
  charStart = 0,
  direction: 'rtl' | 'ltr' = 'rtl'
): HTMLDivElement {
  const block: LayoutBlock = { ...makeBlock(text, charStart), words: wordsFor(text) };
  const layout = blockWordLayout(block, 1000, perCharMeasurer, direction);
  if (!layout) throw new Error('fixture produced no word layout');
  const html = renderBlockOverlayHtml(block, layout, {
    searchQuery: opts.searchQuery ?? '',
    searchTokens: opts.searchTokens ?? [],
    highlights: opts.highlights ?? [],
  });
  const div = document.createElement('div');
  div.innerHTML = html;
  return div;
}

describe('renderBlockOverlayHtml (word geometry)', () => {
  it('keeps the concatenated DOM text byte-identical for space, newline and NBSP separators', () => {
    const texts = [
      'اب جد',
      'اب\nجد',
      'اب جد',
      'اب  جد',
      'بسم الله\nالرحمن الرحيم',
      'قال & <قيل> "ثم" \'بعد\'\nسطر ثان',
    ];
    for (const text of texts) {
      expect(renderWords(text).textContent).toBe(text);
    }
  });

  it('emits one absolutely-anchored span per word in character order', () => {
    const text = 'بسم الله\nالرحمن الرحيم';
    const div = renderWords(text);
    const spans = Array.from(div.querySelectorAll('span.ilm-pdf-word'));
    expect(spans).toHaveLength(4);
    expect(spans.map((s) => s.textContent)).toEqual(['بسم ', 'الله\n', 'الرحمن ', 'الرحيم']);
    for (const span of spans) {
      expect(span.getAttribute('style')).toMatch(/^right:[\d.]+%;top:[\d.]+%;font-size:[\d.]+cqh;line-height:[\d.]+cqh/);
    }
    expect(div.querySelectorAll('span.ilm-pdf-line')).toHaveLength(0);
    const ltr = renderWords(text, {}, 0, 'ltr');
    expect(ltr.querySelector('span.ilm-pdf-word')?.getAttribute('style')).toMatch(/^left:/);
  });

  it('splits a phrase across words into per-word marks (trailing space allowed, never a newline)', () => {
    const sameLine = renderWords('بسم الله الرحمن الرحيم', { searchQuery: 'الله الرحمن' });
    const marks = Array.from(sameLine.querySelectorAll('mark.ilm-pdf-search-mark'));
    expect(marks.map((m) => m.textContent)).toEqual(['الله ', 'الرحمن']);
    expect(new Set(marks.map((m) => m.closest('span.ilm-pdf-word'))).size).toBe(2);

    const acrossLines = renderWords('بسم الله\nالرحمن الرحيم', { searchQuery: 'الله الرحمن' });
    const lineMarks = Array.from(acrossLines.querySelectorAll('mark.ilm-pdf-search-mark'));
    expect(lineMarks.map((m) => m.textContent)).toEqual(['الله', 'الرحمن']);
    for (const mark of lineMarks) expect(mark.textContent).not.toContain('\n');
    expect(acrossLines.textContent).toBe('بسم الله\nالرحمن الرحيم');
  });

  it('splits a highlight spanning words into fragments sharing one data-hid', () => {
    const text = 'بسم الله\nالرحمن الرحيم';
    // Page-level offsets: block anchored at 100, highlight covers 'الله\nالرحمن'.
    const div = renderWords(text, { highlights: [highlight({ char_start: 104, char_end: 115 })] }, 100);
    const marks = Array.from(div.querySelectorAll('mark[data-hid="5"]'));
    expect(marks).toHaveLength(2);
    for (const mark of marks) {
      expect(mark.textContent).not.toContain('\n');
      expect(mark.classList.contains('highlight-green')).toBe(true);
      expect(mark.closest('span.ilm-pdf-word')).not.toBeNull();
    }
    expect(div.textContent).toBe(text);
  });

  it('nests a search mark around a user highlight and keeps --near marks', () => {
    const div = renderWords('في العلم فائدة', {
      searchQuery: 'العلم',
      searchTokens: ['فائدة'],
      highlights: [highlight({ char_start: 3, char_end: 8 })],
    });
    const search = div.querySelector('mark.ilm-pdf-search-mark:not(.ilm-pdf-search-mark--near)');
    expect(search?.querySelector('mark[data-hid="5"]')).not.toBeNull();
    expect(div.querySelector('mark.ilm-pdf-search-mark--near')?.textContent).toBe('فائدة');
    expect(div.textContent).toBe('في العلم فائدة');
  });
});
