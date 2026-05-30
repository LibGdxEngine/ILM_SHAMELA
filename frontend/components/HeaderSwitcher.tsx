'use client';

import { usePathname } from 'next/navigation';

import AppHeader from '@/components/AppHeader';
import SiteHeader from '@/components/SiteHeader';
import { useAuth } from '@/lib/AuthContext';
import { stripLocalePrefix } from '@/lib/i18n/config';

const APP_ROUTE_PREFIXES = ['/documents', '/profile', '/upload', '/discover', '/notes'];

export default function HeaderSwitcher() {
  const pathname = usePathname();
  const { isAuthenticated } = useAuth();

  const bare = stripLocalePrefix(pathname ?? '/');

  if (/^\/documents\/[^/]+/.test(bare)) {
    return null;
  }

  const isAppRoute = APP_ROUTE_PREFIXES.some((prefix) => bare === prefix || bare.startsWith(`${prefix}/`));

  if (isAuthenticated && isAppRoute) {
    return <AppHeader />;
  }

  return <SiteHeader />;
}
