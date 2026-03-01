'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import { useAuth } from '@/lib/AuthContext';
import { getLocaleFromPathname, withLocale } from '@/lib/i18n/config';
import { useI18n } from '@/components/i18n/I18nProvider';

interface RequireAuthProps {
  children: ReactNode;
}

export default function RequireAuth({ children }: RequireAuthProps) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useI18n();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      const locale = getLocaleFromPathname(pathname);
      const next = pathname
        ? encodeURIComponent(pathname)
        : encodeURIComponent(withLocale('/documents', locale));
      router.replace(`${withLocale('/auth/login', locale)}?next=${next}`);
    }
  }, [isAuthenticated, isLoading, pathname, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen grid place-items-center bg-stone-50 text-stone-700">
        <div className="text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-b-2 border-amber-700" />
          <p className="mt-3 text-sm">{t('auth.checkingSession', 'جارٍ التحقق من الجلسة...')}</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return <>{children}</>;
}
