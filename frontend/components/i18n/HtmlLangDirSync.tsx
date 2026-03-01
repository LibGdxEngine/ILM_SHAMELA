'use client';

import { useEffect } from 'react';

import { useI18n } from '@/components/i18n/I18nProvider';

export default function HtmlLangDirSync() {
  const { locale, direction, t } = useI18n();

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = direction;
    document.title = t('meta.title', document.title);

    const description = document.querySelector('meta[name="description"]');
    if (description) {
      description.setAttribute(
        'content',
        t('meta.description', description.getAttribute('content') || '')
      );
    }
  }, [locale, direction, t]);

  return null;
}
