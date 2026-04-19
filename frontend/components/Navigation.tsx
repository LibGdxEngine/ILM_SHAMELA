'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { useI18n } from '@/components/i18n/I18nProvider';
import { useAuth } from '@/lib/AuthContext';
import { locales, stripLocalePrefix, withLocale, type Locale } from '@/lib/i18n/config';
import { useLocalizedPath } from '@/lib/i18n/navigation';
import { navTheme } from '@/lib/theme';

export default function Navigation() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isLoading, logout, isAuthenticated } = useAuth();
  const { t, locale } = useI18n();
  const localizedPath = useLocalizedPath();

  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);
  const [isLangDropdownOpen, setIsLangDropdownOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const userDropdownRef = useRef<HTMLDivElement>(null);
  const langDropdownRef = useRef<HTMLDivElement>(null);

  const barePathname = stripLocalePrefix(pathname ?? '/');
  const navItems = [
    { path: '/', label: t('nav.home', 'الرئيسية') },
    { path: '/upload', label: t('nav.upload', 'رفع كتاب') },
    { path: '/documents', label: t('nav.documents', 'المكتبة') },
  ];

  const isActive = (path: string) =>
    path === '/' ? barePathname === '/' : barePathname === path || barePathname.startsWith(`${path}/`);

  const closeAllMenus = () => {
    setIsUserDropdownOpen(false);
    setIsLangDropdownOpen(false);
    setIsMobileMenuOpen(false);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (userDropdownRef.current && !userDropdownRef.current.contains(target)) {
        setIsUserDropdownOpen(false);
      }
      if (langDropdownRef.current && !langDropdownRef.current.contains(target)) {
        setIsLangDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    closeAllMenus();
  }, [barePathname]);

  if (barePathname.startsWith('/auth')) {
    return null;
  }

  const handleLogout = async () => {
    closeAllMenus();
    await logout();
  };

  const changeLocale = (targetLocale: Locale) => {
    closeAllMenus();
    if (!pathname) return;
    router.push(withLocale(barePathname, targetLocale));
  };

  const localeLabel = (targetLocale: Locale) => t(`nav.locale.${targetLocale}`, targetLocale.toUpperCase());
  const displayName = user?.first_name || user?.email.split('@')[0] || '';
  const initial = user?.first_name?.[0] || user?.email?.[0]?.toUpperCase() || '?';
  const inactiveMobileLinkClass =
    'text-olive-gray hover:bg-warm-sand hover:text-near-black dark:text-warm-silver dark:hover:bg-dark-surface dark:hover:text-ivory';

  return (
    <nav className={navTheme.shell}>
      <div className={navTheme.container}>
        <div className="pointer-events-none absolute inset-0 opacity-[0.2] dark:opacity-[0.08] islamic-pattern-bg" aria-hidden />

        <div className={`relative ${navTheme.row}`}>
          <div className={navTheme.left}>
            <Link href={localizedPath('/')} className={navTheme.logoLink} onClick={closeAllMenus}>
              <div className={navTheme.logoIconWrap}>
                <Image src="/images/brand/navbar-logo.svg" alt={t('brand.logoAlt', 'ILM Shamela Logo')} fill className="object-contain" priority />
              </div>
              <span className={navTheme.brandText}>
                {t('brand.word1', 'مكتبة')} <span className={navTheme.brandAccent}>{t('brand.word2', 'علم')}</span>
              </span>
            </Link>

            <div className={`${navTheme.linksWrap} md:flex`}>
              {navItems.map((item) => (
                <Link
                  key={item.path}
                  href={localizedPath(item.path)}
                  onClick={closeAllMenus}
                  className={`${navTheme.linkBase} ${isActive(item.path) ? navTheme.linkActive : navTheme.linkInactive}`}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>

          <div className={navTheme.rightCluster}>
            <div className="relative" ref={langDropdownRef}>
              <button
                type="button"
                onClick={() => setIsLangDropdownOpen((prev) => !prev)}
                className={navTheme.controlButton}
                aria-expanded={isLangDropdownOpen}
                aria-haspopup="listbox"
                aria-label={t('nav.language', 'Language')}
              >
                <svg className={navTheme.controlIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m12.319 0a18.022 18.022 0 01-3.657 7.5M9 12l3 3 3-3" />
                </svg>
                <span className="max-w-[6rem] truncate sm:max-w-none">{localeLabel(locale)}</span>
                <svg
                  className={`h-4 w-4 text-stone-gray transition-transform duration-200 ${isLangDropdownOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {isLangDropdownOpen && (
                <ul role="listbox" className={navTheme.dropdownMenu} style={{ insetInlineEnd: 0 }}>
                  {locales.map((supportedLocale) => (
                    <li key={supportedLocale} role="option" aria-selected={locale === supportedLocale}>
                      <button
                        type="button"
                        onClick={() => changeLocale(supportedLocale)}
                        className={`${navTheme.dropdownItem} ${locale === supportedLocale ? navTheme.dropdownItemActive : ''}`}
                      >
                        {localeLabel(supportedLocale)}
                        {locale === supportedLocale && (
                          <svg className="ms-auto h-4 w-4 text-terracotta" fill="currentColor" viewBox="0 0 20 20" aria-hidden>
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <span className={navTheme.divider} aria-hidden />

            <div className="hidden items-center gap-2 md:flex">
              {isLoading ? (
                <div className="h-8 w-8 animate-pulse rounded-full bg-warm-sand dark:bg-dark-surface" />
              ) : isAuthenticated && user ? (
                <div className="relative" ref={userDropdownRef}>
                  <button
                    type="button"
                    onClick={() => setIsUserDropdownOpen((prev) => !prev)}
                    className={navTheme.userTrigger}
                    aria-expanded={isUserDropdownOpen}
                    aria-haspopup="menu"
                  >
                    <div className={navTheme.userAvatar}>{initial}</div>
                    <span className={navTheme.userName}>{displayName}</span>
                    <svg
                      className={`h-4 w-4 text-stone-gray transition-transform duration-200 ${isUserDropdownOpen ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {isUserDropdownOpen && (
                    <div className={navTheme.userMenu} style={{ insetInlineEnd: 0 }} role="menu">
                      <div className={navTheme.userMenuHeader}>
                        <p className="text-sm font-medium text-near-black dark:text-ivory">
                          {user.first_name} {user.last_name}
                        </p>
                        <p className="truncate text-xs text-stone-gray">{user.email}</p>
                      </div>
                      <Link
                        href={localizedPath('/profile')}
                        onClick={closeAllMenus}
                        className="flex w-full items-center gap-2 px-4 py-2 text-start text-sm font-medium text-charcoal-warm transition-colors hover:bg-warm-sand dark:text-warm-silver dark:hover:bg-dark-warm"
                        role="menuitem"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.121 17.804A10.966 10.966 0 0112 15c2.506 0 4.816.84 6.879 2.255M15 10a3 3 0 11-6 0 3 3 0 016 0zM21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {t('nav.profile', 'الملف الشخصي')}
                      </Link>
                      <button
                        type="button"
                        onClick={handleLogout}
                        className="flex w-full items-center gap-2 px-4 py-2 text-start text-sm font-medium text-error-crimson transition-colors hover:bg-error-crimson/5"
                        role="menuitem"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                          />
                        </svg>
                        {t('nav.signOut', 'تسجيل الخروج')}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <Link href={localizedPath('/auth/login')} className={navTheme.signInLink} onClick={closeAllMenus}>
                    {t('nav.signIn', 'تسجيل الدخول')}
                  </Link>
                  <Link href={localizedPath('/auth/register')} className={navTheme.signUpButton} onClick={closeAllMenus}>
                    {t('nav.getStarted', 'ابدأ الآن')}
                  </Link>
                </>
              )}
            </div>

            <button
              type="button"
              className={`${navTheme.mobileToggle} md:hidden`}
              onClick={() => setIsMobileMenuOpen((prev) => !prev)}
              aria-controls="mobile-nav-panel"
              aria-expanded={isMobileMenuOpen}
              aria-label={isMobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            >
              {isMobileMenuOpen ? (
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {isMobileMenuOpen && (
          <div id="mobile-nav-panel" className={`${navTheme.mobilePanel} md:hidden`}>
            <div className={navTheme.mobileLinksWrap}>
              {navItems.map((item) => (
                <Link
                  key={item.path}
                  href={localizedPath(item.path)}
                  onClick={closeAllMenus}
                  className={`${navTheme.mobileLinkBase} ${isActive(item.path) ? navTheme.mobileLinkActive : inactiveMobileLinkClass}`}
                >
                  {item.label}
                </Link>
              ))}
            </div>

            <div className={navTheme.mobileAuthWrap}>
              {isLoading ? (
                <div className="h-10 animate-pulse rounded-xl bg-warm-sand dark:bg-dark-surface" />
              ) : isAuthenticated && user ? (
                <>
                  <div className={navTheme.mobileUserCard}>
                    <p className="text-sm font-medium text-near-black dark:text-ivory">{displayName}</p>
                    <p className="truncate text-xs text-stone-gray">{user.email}</p>
                  </div>
                  <Link
                    href={localizedPath('/profile')}
                    onClick={closeAllMenus}
                    className="inline-flex items-center justify-center rounded-xl border border-border-warm bg-ivory px-4 py-2.5 text-sm font-medium text-charcoal-warm transition-all hover:bg-warm-sand dark:border-dark-surface dark:bg-dark-surface dark:text-warm-silver"
                  >
                    {t('nav.profile', 'الملف الشخصي')}
                  </Link>
                  <button type="button" onClick={handleLogout} className={navTheme.mobileSignOutButton}>
                    {t('nav.signOut', 'تسجيل الخروج')}
                  </button>
                </>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <Link
                    href={localizedPath('/auth/login')}
                    onClick={closeAllMenus}
                    className="inline-flex items-center justify-center rounded-xl border border-border-warm bg-ivory px-4 py-2.5 text-sm font-medium text-charcoal-warm transition-all hover:bg-warm-sand dark:border-dark-surface dark:bg-dark-surface dark:text-warm-silver"
                  >
                    {t('nav.signIn', 'تسجيل الدخول')}
                  </Link>
                  <Link href={localizedPath('/auth/register')} onClick={closeAllMenus} className={navTheme.signUpButton}>
                    {t('nav.getStarted', 'ابدأ الآن')}
                  </Link>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
