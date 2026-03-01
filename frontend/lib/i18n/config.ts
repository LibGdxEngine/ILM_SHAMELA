export const locales = ['ar', 'en', 'fa', 'ur'] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'ar';

export function isLocale(value: string | null | undefined): value is Locale {
  return !!value && locales.includes(value as Locale);
}

export function localeToDirection(locale: Locale): 'rtl' | 'ltr' {
  return locale === 'ar' || locale === 'fa' || locale === 'ur' ? 'rtl' : 'ltr';
}

export function localeToDateLocale(locale: Locale): string {
  switch (locale) {
    case 'ar':
      return 'ar';
    case 'fa':
      return 'fa-IR';
    case 'ur':
      return 'ur-PK';
    case 'en':
    default:
      return 'en-US';
  }
}

export function getLocaleFromPathname(pathname: string | null | undefined): Locale {
  if (!pathname) return defaultLocale;

  const [first] = pathname.split('/').filter(Boolean);
  return isLocale(first) ? first : defaultLocale;
}

export function stripLocalePrefix(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 0) return '/';

  if (isLocale(parts[0])) {
    const rest = parts.slice(1);
    return rest.length === 0 ? '/' : `/${rest.join('/')}`;
  }

  return pathname.startsWith('/') ? pathname : `/${pathname}`;
}

export function withLocale(pathname: string, locale: Locale): string {
  const normalized = stripLocalePrefix(pathname);
  if (normalized === '/') {
    return `/${locale}`;
  }
  return `/${locale}${normalized}`;
}
