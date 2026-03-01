'use client';

import React, { createContext, useContext, useMemo } from 'react';
import { usePathname } from 'next/navigation';

import {
  defaultLocale,
  getLocaleFromPathname,
  localeToDirection,
  type Locale,
} from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/getDictionary';
import type { Dictionary, TranslationValues } from '@/lib/i18n/types';

interface I18nContextValue {
  locale: Locale;
  direction: 'rtl' | 'ltr';
  dictionary: Dictionary;
  t: (key: string, fallback?: string, values?: TranslationValues) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function interpolate(template: string, values?: TranslationValues): string {
  if (!values) return template;

  return template.replace(/\{(\w+)\}/g, (_, token: string) => {
    const value = values[token];
    return value === undefined ? `{${token}}` : String(value);
  });
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const value = useMemo<I18nContextValue>(() => {
    const locale = getLocaleFromPathname(pathname) ?? defaultLocale;
    const direction = localeToDirection(locale);
    const dictionary = getDictionary(locale);

    const t = (key: string, fallback?: string, values?: TranslationValues) => {
      const template = dictionary[key] ?? fallback ?? key;
      return interpolate(template, values);
    };

    return { locale, direction, dictionary, t };
  }, [pathname]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return context;
}
