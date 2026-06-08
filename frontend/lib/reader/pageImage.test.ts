import { describe, expect, it } from 'vitest';
import { escapeContentHtml, isRtlLanguage } from './pageImage';

describe('isRtlLanguage', () => {
  it('treats Arabic and Persian as RTL', () => {
    expect(isRtlLanguage('ar')).toBe(true);
    expect(isRtlLanguage('fa')).toBe(true);
  });

  it('handles locale tags and casing', () => {
    expect(isRtlLanguage('AR-EG')).toBe(true);
    expect(isRtlLanguage('fa_IR')).toBe(true);
  });

  it('treats English and other LTR languages as LTR', () => {
    expect(isRtlLanguage('en')).toBe(false);
    expect(isRtlLanguage('fr')).toBe(false);
  });

  it('returns false for empty/nullish input', () => {
    expect(isRtlLanguage(null)).toBe(false);
    expect(isRtlLanguage(undefined)).toBe(false);
    expect(isRtlLanguage('')).toBe(false);
  });
});

describe('escapeContentHtml', () => {
  it('escapes HTML-significant characters', () => {
    expect(escapeContentHtml('<b>a & "b"</b>')).toBe(
      '&lt;b&gt;a &amp; &quot;b&quot;&lt;/b&gt;'
    );
  });

  it('converts newlines to <br /> after escaping', () => {
    expect(escapeContentHtml('line1\nline2')).toBe('line1<br />line2');
  });

  it('preserves Arabic text', () => {
    expect(escapeContentHtml('مرحبا')).toBe('مرحبا');
  });
});
