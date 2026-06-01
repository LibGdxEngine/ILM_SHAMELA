const ARABIC_INDIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
const PERSO_ARABIC_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

export function toLocaleDigits(input: string | number, locale: string): string {
  const str = typeof input === 'number' ? String(input) : input;
  if (locale === 'ar') {
    return str.replace(/[0-9]/g, (d) => ARABIC_INDIC_DIGITS[Number(d)]);
  }
  if (locale === 'fa' || locale === 'ur') {
    return str.replace(/[0-9]/g, (d) => PERSO_ARABIC_DIGITS[Number(d)]);
  }
  return str;
}

/**
 * Derive an uppercase file-type label from a file URL/path, e.g. "PDF".
 * Returns '' when no usable extension is present.
 */
export function fileTypeLabel(file?: string | null): string {
  if (!file) return '';
  const clean = file.split('?')[0].split('#')[0];
  const dot = clean.lastIndexOf('.');
  if (dot === -1) return '';
  const ext = clean.slice(dot + 1);
  // Reject "extensions" that contain a path separator (e.g. a dotted folder name)
  // or are implausibly long to be a real file type.
  if (!ext || ext.includes('/') || ext.length > 5) return '';
  return ext.toUpperCase();
}

type TranslateFn = (
  key: string,
  fallback?: string,
  values?: Record<string, string | number>
) => string;

/**
 * Format an ISO timestamp as a localized relative time, e.g. "قبل ٣ أيام".
 * Digits are localized via toLocaleDigits; copy comes from the i18n `time.*` keys.
 */
export function formatRelativeDate(
  iso: string | null | undefined,
  locale: string,
  t: TranslateFn
): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diffSec = Math.round((Date.now() - then) / 1000);
  const MINUTE = 60;
  const HOUR = 3600;
  const DAY = 86_400;
  const MONTH = DAY * 30;
  const YEAR = DAY * 365;

  if (diffSec < MINUTE) return t('time.justNow', 'الآن');
  const n = (value: number) => toLocaleDigits(Math.floor(value), locale);
  if (diffSec < HOUR) return t('time.minutesAgo', 'قبل {n} دقيقة', { n: n(diffSec / MINUTE) });
  if (diffSec < DAY) return t('time.hoursAgo', 'قبل {n} ساعة', { n: n(diffSec / HOUR) });
  if (diffSec < MONTH) return t('time.daysAgo', 'قبل {n} يوم', { n: n(diffSec / DAY) });
  if (diffSec < YEAR) return t('time.monthsAgo', 'قبل {n} شهر', { n: n(diffSec / MONTH) });
  return t('time.yearsAgo', 'قبل {n} سنة', { n: n(diffSec / YEAR) });
}

/**
 * Highlight query terms in text
 */
export function highlightText(text: string, query: string): string {
  if (!text || !query) {
    return text || '';
  }

  // Escape special regex characters in query
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  
  // Create regex with case-insensitive matching
  const regex = new RegExp(`(${escapedQuery})`, 'gi');
  
  // Split text and wrap matches
  const parts = text.split(regex);
  
  return parts
    .map((part, index) => {
      // Check if this part matches the query (case-insensitive)
      if (regex.test(part)) {
        // Reset regex lastIndex for next test
        regex.lastIndex = 0;
        return `<mark>${part}</mark>`;
      }
      return part;
    })
    .join('');
}

/**
 * Extract a snippet from text around the first match
 */
export function extractSnippet(text: string, query: string, maxLength: number = 200): string {
  if (!text) return '';
  
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const queryIndex = lowerText.indexOf(lowerQuery);
  
  if (queryIndex === -1) {
    // No match found, return beginning of text
    return text.substring(0, maxLength) + (text.length > maxLength ? '...' : '');
  }
  
  // Calculate start and end positions
  const start = Math.max(0, queryIndex - maxLength / 2);
  const end = Math.min(text.length, queryIndex + query.length + maxLength / 2);
  
  let snippet = text.substring(start, end);
  
  // Add ellipsis if needed
  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';
  
  return snippet;
}
