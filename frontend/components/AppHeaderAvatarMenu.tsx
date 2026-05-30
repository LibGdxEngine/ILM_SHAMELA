'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { useAuth } from '@/lib/AuthContext';
import { useI18n } from '@/components/i18n/I18nProvider';
import { useLocalizedPath } from '@/lib/i18n/navigation';
import { locales, stripLocalePrefix, withLocale, type Locale } from '@/lib/i18n/config';

interface AppHeaderAvatarMenuProps {
  displayName: string;
  avatarInitial: string;
}

const LOCALE_SHORT: Record<Locale, string> = {
  ar: 'AR',
  en: 'EN',
  fa: 'FA',
  ur: 'UR',
};

export default function AppHeaderAvatarMenu({ displayName, avatarInitial }: AppHeaderAvatarMenuProps) {
  const { t, locale } = useI18n();
  const { user, logout } = useAuth();
  const localizedPath = useLocalizedPath();
  const router = useRouter();
  const pathname = usePathname();

  const [open, setOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
        setLangOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        setLangOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const changeLocale = (target: Locale) => {
    setOpen(false);
    setLangOpen(false);
    if (!pathname) return;
    const bare = stripLocalePrefix(pathname);
    const search = typeof window !== 'undefined' ? window.location.search : '';
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    router.push(`${withLocale(bare, target)}${search}${hash}`);
  };

  const handleLogout = async () => {
    setOpen(false);
    try {
      await logout();
    } finally {
      router.push(localizedPath('/auth/login'));
    }
  };

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={displayName ? `${t('nav.profile', 'الملف الشخصي')} — ${displayName}` : t('nav.profile', 'الملف الشخصي')}
        className="flex items-center rounded-full p-0.5 transition-colors hover:bg-black/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        {user?.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.avatar}
            alt=""
            className="w-8 h-8 rounded-full object-cover border border-border-strong"
          />
        ) : (
          <span className="w-8 h-8 rounded-full bg-gradient-to-br from-accent-2 to-accent flex items-center justify-center text-white font-arabic text-[12.5px] font-semibold leading-none shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]">
            {avatarInitial}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-full mt-2 z-50 min-w-[240px] rounded-[14px] border border-border-strong bg-card-2/95 backdrop-blur-md p-1.5 shadow-[0_18px_42px_-10px_rgba(0,0,0,0.18)] font-arabic"
          style={{ insetInlineEnd: 0 }}
        >
          <div className="px-3 py-2.5 border-b border-border mb-1">
            <p className="text-[13px] text-text truncate font-medium">{displayName || t('nav.profile', 'الملف الشخصي')}</p>
            {user?.email && (
              <p className="mt-0.5 text-[11.5px] text-text-3 truncate">{user.email}</p>
            )}
          </div>

          <Link
            href={localizedPath('/profile')}
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-[13px] text-text-2 hover:bg-accent-soft hover:text-accent-2 transition-colors"
            role="menuitem"
          >
            <svg className="w-4 h-4 text-text-3" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden>
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
            </svg>
            {t('nav.profile', 'الملف الشخصي')}
          </Link>

          <button
            type="button"
            onClick={() => setLangOpen((prev) => !prev)}
            className="w-full flex items-center justify-between gap-2.5 rounded-[10px] px-3 py-2 text-[13px] text-text-2 hover:bg-accent-soft hover:text-accent-2 transition-colors"
            aria-expanded={langOpen}
            role="menuitem"
          >
            <span className="flex items-center gap-2.5">
              <svg className="w-4 h-4 text-text-3" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden>
                <circle cx="12" cy="12" r="10" />
                <path d="M2 12h20" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              {t('nav.language', 'اللغة')}
            </span>
            <span className="flex items-center gap-1.5 text-[11.5px] text-text-3">
              {LOCALE_SHORT[locale]}
              <svg
                className={`w-3 h-3 transition-transform ${langOpen ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
                aria-hidden
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </span>
          </button>

          {langOpen && (
            <ul role="menu" className="mt-0.5 mb-1 mx-1 rounded-[10px] bg-bg/60 p-1">
              {locales.map((target) => {
                const isActive = target === locale;
                return (
                  <li key={target} role="none">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => changeLocale(target)}
                      className={`w-full flex items-center justify-between gap-2 rounded-[8px] px-2.5 py-1.5 text-[12.5px] transition-colors ${
                        isActive ? 'bg-accent-soft text-accent-2' : 'text-text-2 hover:bg-white/40 hover:text-text'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span className="font-medium tracking-wide text-[11px] w-7 text-center text-text-3">
                          {LOCALE_SHORT[target]}
                        </span>
                        <span className="font-fraunces">{t(`nav.locale.${target}`, target.toUpperCase())}</span>
                      </span>
                      {isActive && (
                        <svg className="w-3.5 h-3.5 text-accent-2" fill="currentColor" viewBox="0 0 20 20" aria-hidden>
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="border-t border-border my-1" />
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-[13px] text-text-2 hover:bg-accent-soft hover:text-accent-2 transition-colors"
            role="menuitem"
          >
            <svg className="w-4 h-4 text-text-3" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden>
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="M16 17l5-5-5-5" />
              <path d="M21 12H9" />
            </svg>
            {t('nav.signOut', 'تسجيل الخروج')}
          </button>
        </div>
      )}
    </div>
  );
}
