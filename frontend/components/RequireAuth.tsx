'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import { useAuth } from '@/lib/AuthContext';
import { getLocaleFromPathname, withLocale } from '@/lib/i18n/config';
import { useI18n } from '@/components/i18n/I18nProvider';

interface RequireAuthProps {
  children: ReactNode;
  /**
   * When true, additionally require upload privileges. Authenticated users who
   * cannot upload (per the backend `can_upload` flag) are redirected to the
   * library instead of seeing an upload form that the API would reject.
   */
  requireUpload?: boolean;
}

export default function RequireAuth({ children, requireUpload = false }: RequireAuthProps) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useI18n();

  const lacksUpload = requireUpload && !user?.can_upload;

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      const locale = getLocaleFromPathname(pathname);
      const next = pathname
        ? encodeURIComponent(pathname)
        : encodeURIComponent(withLocale('/documents', locale));
      router.replace(`${withLocale('/auth/login', locale)}?next=${next}`);
      return;
    }
    if (lacksUpload) {
      const locale = getLocaleFromPathname(pathname);
      router.replace(withLocale('/documents', locale));
    }
  }, [isAuthenticated, isLoading, lacksUpload, pathname, router]);

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

  if (!isAuthenticated || lacksUpload) {
    return null;
  }

  return <>{children}</>;
}
