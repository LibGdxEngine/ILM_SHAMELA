import { toLocaleDigits } from '@/lib/utils';

/** Arabic ordinal names for hijri centuries 1–15 (the classical range). */
const ORDINALS_AR = [
  '',
  'الأول',
  'الثاني',
  'الثالث',
  'الرابع',
  'الخامس',
  'السادس',
  'السابع',
  'الثامن',
  'التاسع',
  'العاشر',
  'الحادي عشر',
  'الثاني عشر',
  'الثالث عشر',
  'الرابع عشر',
  'الخامس عشر',
];

function englishOrdinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/** Localized display label for a hijri death-century facet value:
 *  ar → "القرن الثامن الهجري", en → "8th century AH", fa → "قرن ۸ هجری". */
export function formatHijriCentury(century: number, locale: string): string {
  if (locale.startsWith('ar')) {
    const ordinal = ORDINALS_AR[century];
    return ordinal
      ? `القرن ${ordinal} الهجري`
      : `القرن ${toLocaleDigits(century, locale)} الهجري`;
  }
  if (locale.startsWith('fa')) {
    return `قرن ${toLocaleDigits(century, locale)} هجری`;
  }
  return `${englishOrdinal(century)} century AH`;
}
