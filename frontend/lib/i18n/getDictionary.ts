import ar from '@/lib/i18n/dictionaries/ar.json';
import en from '@/lib/i18n/dictionaries/en.json';
import fa from '@/lib/i18n/dictionaries/fa.json';
import ur from '@/lib/i18n/dictionaries/ur.json';
import { defaultLocale, isLocale, type Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/types';

const dictionaries: Record<Locale, Dictionary> = {
  ar: ar as Dictionary,
  en: en as Dictionary,
  fa: fa as Dictionary,
  ur: ur as Dictionary,
};

export function getDictionary(locale: string): Dictionary {
  const resolved = isLocale(locale) ? locale : defaultLocale;
  return dictionaries[resolved];
}
