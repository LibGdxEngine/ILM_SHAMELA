import { describe, expect, it } from 'vitest';

import { extractSnippet, highlightText } from './utils';

describe('utils', () => {
  it('highlights query matches case-insensitively', () => {
    const result = highlightText('Islamic Knowledge Library', 'knowledge');
    expect(result).toContain('<mark>Knowledge</mark>');
  });

  it('extracts snippet around first match', () => {
    const text =
      'This is a long text that contains contextual language and eventually the target token appears right here in the sentence.';
    const snippet = extractSnippet(text, 'target', 40);
    expect(snippet.toLowerCase()).toContain('target');
    expect(snippet.length).toBeLessThanOrEqual(46); // includes optional ellipsis
  });

  it('falls back to beginning when query is missing', () => {
    const snippet = extractSnippet('abcdefghi', 'zzz', 4);
    expect(snippet).toBe('abcd...');
  });
});
