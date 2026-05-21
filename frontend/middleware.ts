import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { defaultLocale, isLocale } from '@/lib/i18n/config';

const PUBLIC_FILE = /\.[^/]+$/;

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/media') ||
    pathname === '/auth/google/callback' ||
    pathname === '/auth/google/callback/' ||
    pathname.startsWith('/favicon.ico') ||
    pathname.startsWith('/robots.txt') ||
    pathname.startsWith('/sitemap.xml') ||
    PUBLIC_FILE.test(pathname)
  ) {
    return NextResponse.next();
  }

  const segments = pathname.split('/').filter(Boolean);
  const localeSegment = segments[0];

  if (!isLocale(localeSegment)) {
    const url = request.nextUrl.clone();
    url.pathname = pathname === '/' ? `/${defaultLocale}` : `/${defaultLocale}${pathname}`;
    return NextResponse.redirect(url);
  }

  const url = request.nextUrl.clone();
  const remaining = segments.slice(1);
  url.pathname = remaining.length === 0 ? '/' : `/${remaining.join('/')}`;

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-ilm-locale', localeSegment);

  return NextResponse.rewrite(url, {
    request: { headers: requestHeaders },
  });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
