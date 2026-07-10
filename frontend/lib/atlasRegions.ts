/**
 * Atlas region helpers — maps backend country names to the historical-region
 * labels used in the standalone mock, per locale, and supplies the per-region
 * dot colours. Data stays country-keyed (from `getCountryDocumentStats`); this
 * is purely presentational naming/colour.
 */

import { type Locale } from '@/lib/i18n/config';

/** Ordered palette for region dots/markers (from the mock). */
export const REGION_DOT_COLORS = [
  '#2C4C82', // indigo (primary)
  '#B07D2B', // gold
  '#9C4A2E', // terracotta
  '#946F1B', // ochre
  '#1E5F56', // teal
  '#7A2E2A', // crimson
  '#57374F', // plum
  '#3E4B59', // slate
];

/** English country name → historical Arabic region name from the mock. */
const AR_REGION_NAMES: Record<string, string> = {
  Spain: 'الأندلس',
  Portugal: 'الأندلس',
  Morocco: 'المغرب',
  Algeria: 'المغرب الأوسط',
  Tunisia: 'إفريقية',
  Libya: 'برقة',
  Egypt: 'مصر',
  Syria: 'الشام',
  Lebanon: 'الشام',
  Jordan: 'الشام',
  Palestine: 'الشام',
  Iraq: 'العراق',
  'Saudi Arabia': 'الحجاز',
  Yemen: 'اليمن',
  Oman: 'عُمان',
  Iran: 'بلاد فارس',
  Turkey: 'الأناضول',
  Uzbekistan: 'ما وراء النهر',
  Tajikistan: 'ما وراء النهر',
  Afghanistan: 'خراسان',
  Pakistan: 'السند',
  India: 'الهند',
  Sudan: 'السودان',
  Mauritania: 'شنقيط',
  Mali: 'تكرور',
  Nigeria: 'بلاد التكرور',
  Senegal: 'تكرور',
  Somalia: 'الصومال',
};

/** Persian historical-region names (Arabic-script, without the Arabic article). */
const FA_REGION_NAMES: Record<string, string> = {
  Spain: 'اندلس',
  Portugal: 'اندلس',
  Morocco: 'مغرب',
  Algeria: 'مغرب میانه',
  Tunisia: 'افریقیه',
  Libya: 'برقه',
  Egypt: 'مصر',
  Syria: 'شام',
  Lebanon: 'شام',
  Jordan: 'شام',
  Palestine: 'شام',
  Iraq: 'عراق',
  'Saudi Arabia': 'حجاز',
  Yemen: 'یمن',
  Oman: 'عمان',
  Iran: 'فارس',
  Turkey: 'آناتولی',
  Uzbekistan: 'ماوراءالنهر',
  Tajikistan: 'ماوراءالنهر',
  Afghanistan: 'خراسان',
  Pakistan: 'سند',
  India: 'هند',
  Sudan: 'سودان',
  Mauritania: 'شنقیط',
  Mali: 'تکرور',
  Nigeria: 'تکرور',
  Senegal: 'تکرور',
  Somalia: 'سومالی',
};

/** Urdu historical-region names. */
const UR_REGION_NAMES: Record<string, string> = {
  Spain: 'اندلس',
  Portugal: 'اندلس',
  Morocco: 'مغرب',
  Algeria: 'مغربِ اوسط',
  Tunisia: 'افریقیہ',
  Libya: 'برقہ',
  Egypt: 'مصر',
  Syria: 'شام',
  Lebanon: 'شام',
  Jordan: 'شام',
  Palestine: 'شام',
  Iraq: 'عراق',
  'Saudi Arabia': 'حجاز',
  Yemen: 'یمن',
  Oman: 'عمان',
  Iran: 'فارس',
  Turkey: 'اناطولیہ',
  Uzbekistan: 'ماوراء النہر',
  Tajikistan: 'ماوراء النہر',
  Afghanistan: 'خراسان',
  Pakistan: 'سندھ',
  India: 'ہند',
  Sudan: 'سوڈان',
  Mauritania: 'شنقیط',
  Mali: 'تکرور',
  Nigeria: 'تکرور',
  Senegal: 'تکرور',
  Somalia: 'صومالیہ',
};

const REGION_NAMES_BY_LOCALE: Partial<Record<Locale, Record<string, string>>> = {
  ar: AR_REGION_NAMES,
  fa: FA_REGION_NAMES,
  ur: UR_REGION_NAMES,
};

/**
 * Display label for a region in the active locale. `en` keeps the source
 * country name; `ar`/`fa`/`ur` use their own historical-region names (falling
 * back to the Arabic form, then the raw country name, when one is missing).
 */
export function regionDisplayName(countryName: string, locale: Locale): string {
  const map = REGION_NAMES_BY_LOCALE[locale];
  if (!map) return countryName;
  return map[countryName] ?? AR_REGION_NAMES[countryName] ?? countryName;
}

/**
 * All searchable name variants for a region — every localized form plus the
 * English country name — so the Atlas smart-search matches a query typed in
 * any language.
 */
export function regionSearchTerms(countryName: string): string[] {
  return [
    countryName,
    AR_REGION_NAMES[countryName],
    FA_REGION_NAMES[countryName],
    UR_REGION_NAMES[countryName],
  ].filter((n): n is string => Boolean(n));
}

/** Stable colour for a region by its position in the sorted list. */
export function regionColor(index: number): string {
  return REGION_DOT_COLORS[index % REGION_DOT_COLORS.length];
}
