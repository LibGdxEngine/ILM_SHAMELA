'use client';

import { useCallback } from 'react';
import { usePathname } from 'next/navigation';

import { getLocaleFromPathname, stripLocalePrefix, withLocale } from '@/lib/i18n/config';

export function useLocalizedPath() {
  const pathname = usePathname();
  const locale = getLocaleFromPathname(pathname);

  return useCallback(
    (path: string) => {
      const normalized = path.startsWith('/') ? path : `/${path}`;
      return withLocale(stripLocalePrefix(normalized), locale);
    },
    [locale]
  );
}
