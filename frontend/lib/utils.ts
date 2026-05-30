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
