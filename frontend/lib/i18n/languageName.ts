'use client';

import { useCallback } from 'react';
import { useI18n } from '@/components/i18n/I18nProvider';

export function useLanguageName() {
  const { t, dictionary } = useI18n();

  return useCallback(
    (code: string | null | undefined): string => {
      if (!code) return '';
      const key = `upload.languageName.${code.toLowerCase()}`;
      const resolved = dictionary[key];
      if (resolved) return resolved;
      return t(key, code.toUpperCase());
    },
    [t, dictionary]
  );
}
