'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import AppHeaderAvatarMenu from '@/components/AppHeaderAvatarMenu';
import StarMark from '@/components/landing/StarMark';
import LanguageSwitcher from '@/components/i18n/LanguageSwitcher';
import { useAuth } from '@/lib/AuthContext';
import { useI18n } from '@/components/i18n/I18nProvider';
import { stripLocalePrefix } from '@/lib/i18n/config';
import { useLocalizedPath } from '@/lib/i18n/navigation';

type NavKey = 'library' | 'discover' | 'notes';

type NavItem = { href: string; label: string; key?: NavKey };

export default function Navbar() {
  const { t } = useI18n();
  const { user, isAuthenticated } = useAuth();
  const localizedPath = useLocalizedPath();
  const pathname = usePathname();

  const [elevated, setElevated] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setElevated(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const bare = stripLocalePrefix(pathname ?? '/');

  // The redesigned shells (the landing LandingHeader on `/`, Reading Room /
  // Catalog on /documents, the Atlas on /map, and the two-panel auth screen on
  // /auth) and the reader workspace each ship their own in-page header that
  // matches the mock, so the global navbar is skipped on those routes.
  if (
    /^\/$/.test(bare) ||
    /^\/documents(\/|$)/.test(bare) ||
    /^\/map(\/|$)/.test(bare) ||
    /^\/auth(\/|$)/.test(bare)
  ) {
    return null;
  }

  const activeKey: NavKey | null = bare.startsWith('/documents')
    ? 'library'
    : bare.startsWith('/discover')
      ? 'discover'
      : bare.startsWith('/notes')
        ? 'notes'
        : null;

  const homeHref = localizedPath('/');

  // Center links are chosen by auth state: app sections when signed in, marketing anchors otherwise.
  const navItems: NavItem[] = isAuthenticated
    ? [
        { key: 'library', href: localizedPath('/documents'), label: t('nav.app.library', 'مكتبتي') },
        { key: 'discover', href: localizedPath('/discover'), label: t('nav.app.discover', 'اكتشف') },
        { key: 'notes', href: localizedPath('/notes'), label: t('nav.app.notes', 'ملاحظاتي') },
      ]
    : [
        { href: `${homeHref}#why`, label: t('home.nav.why', 'لماذا علم') },
        { href: `${homeHref}#how`, label: t('home.nav.how', 'كيف تعمل') },
        { href: localizedPath('/documents'), label: t('home.nav.library', 'المكتبة') },
      ];

  const displayName =
    (user?.first_name && user.first_name.trim()) ||
    user?.username ||
    user?.email?.split('@')[0] ||
    '';
  const avatarInitial = (displayName[0] || user?.email?.[0] || 'U').toUpperCase();

  return (
    <header
      className={`sticky top-0 z-50 w-full backdrop-blur-xl transition-shadow duration-300 ${
        elevated
          ? 'bg-[rgba(247,239,220,0.82)] shadow-[0_1px_0_rgba(44,38,32,0.04),0_10px_30px_-20px_rgba(120,80,40,0.18)]'
          : 'bg-[rgba(247,239,220,0.65)]'
      } border-b border-paper-line`}
    >
      <div className="mx-auto flex h-16 max-w-[1280px] items-center gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex flex-1 items-center">
          <Link href={homeHref} className="flex items-center gap-2.5 shrink-0" aria-label="ILM Shamela">
            <StarMark size={30} className="text-gold" holeColor="#efe5ce" />
            <span className="leading-none">
              <span className="block font-reem-kufi font-semibold text-[17px] text-ink-deep">
                {t('brand.name', 'مكتبة عِلم')}
              </span>
              <span className="hidden sm:block text-[8px] tracking-[0.22em] text-ink-mute mt-1">
                ILM SHAMELA
              </span>
            </span>
          </Link>
        </div>

        <nav className="hidden md:flex items-center gap-5 font-arabic" dir="rtl">
          {navItems.map((item) => {
            const isActive = item.key != null && activeKey === item.key;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`relative text-[14px] tracking-wide transition-colors py-1.5 ${
                  isActive
                    ? 'text-ink-deep after:absolute after:inset-x-0 after:-bottom-[14px] after:h-[2px] after:bg-gold after:rounded-full'
                    : 'text-ink-warm hover:text-ink-deep'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex flex-1 justify-end items-center gap-1.5 font-arabic">
          {isAuthenticated ? (
            <>
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                aria-label={t('nav.app.search', 'بحث')}
                title={t('nav.app.search', 'بحث')}
                className="w-9 h-9 inline-flex items-center justify-center rounded-full text-ink-warm hover:bg-black/[0.05] hover:text-ink-deep transition-colors"
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  <circle cx="11" cy="11" r="7" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
              </button>

              <button
                type="button"
                aria-label={t('nav.app.notifications', 'الإشعارات')}
                title={t('nav.app.notifications', 'الإشعارات')}
                className="w-9 h-9 inline-flex items-center justify-center rounded-full text-ink-warm hover:bg-black/[0.05] hover:text-ink-deep transition-colors relative"
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                  <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                </svg>
              </button>

              {user?.can_upload && (
                <Link
                  href={localizedPath('/upload')}
                  className="inline-flex items-center gap-1.5 rounded-full bg-gold text-[#fbf6ea] text-[12.5px] font-medium px-3.5 h-9 shadow-[0_6px_16px_-6px_rgba(176,125,43,0.5)] hover:bg-[#9c6c24] hover:-translate-y-[1px] transition-all"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  {t('nav.app.uploadBook', 'رفع كتاب')}
                </Link>
              )}

              <AppHeaderAvatarMenu displayName={displayName} avatarInitial={avatarInitial} />
            </>
          ) : (
            <>
              <LanguageSwitcher variant="compact" />

              <Link
                href={localizedPath('/auth/login')}
                className="text-[12.5px] text-ink-warm hover:text-ink-deep transition-colors px-3 h-9 inline-flex items-center"
              >
                {t('nav.signIn', 'Sign in')}
              </Link>

              <Link
                href={localizedPath('/auth/register')}
                className="inline-flex items-center rounded-full bg-gold text-[#fbf6ea] text-[12.5px] font-medium px-3.5 h-9 shadow-[0_6px_16px_-6px_rgba(176,125,43,0.5)] hover:bg-[#9c6c24] hover:-translate-y-[1px] transition-all"
              >
                {t('nav.getStarted', 'Get started')}
              </Link>
            </>
          )}
        </div>
      </div>

      {paletteOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-start justify-center bg-black/30 backdrop-blur-sm pt-24"
          onClick={() => setPaletteOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="bg-paper-card rounded-[18px] border border-paper-line p-6 max-w-md w-full mx-4 shadow-2xl font-body-ar"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-3">
              <span className="text-gold" aria-hidden>✦</span>
              <h2 className="font-reem-kufi text-[17px] text-ink-deep">
                {t('nav.app.search.title', 'البحث في كل شيء')}
              </h2>
            </div>
            <p className="text-[13px] text-ink-warm leading-[1.7]">
              {t('nav.app.search.comingSoon', 'لوحة الأوامر قريبًا — ستتمكن من البحث في الكتب والملاحظات والإعدادات من مكان واحد.')}
            </p>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setPaletteOpen(false)}
                className="text-[12.5px] text-ink-mute hover:text-ink-deep transition-colors px-3 py-1.5"
              >
                {t('nav.app.search.close', 'إغلاق')}
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
