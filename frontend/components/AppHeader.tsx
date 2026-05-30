'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import AppHeaderAvatarMenu from '@/components/AppHeaderAvatarMenu';
import { useAuth } from '@/lib/AuthContext';
import { useI18n } from '@/components/i18n/I18nProvider';
import { stripLocalePrefix } from '@/lib/i18n/config';
import { useLocalizedPath } from '@/lib/i18n/navigation';

type NavKey = 'library' | 'discover' | 'notes';

export default function AppHeader() {
  const { t } = useI18n();
  const { user } = useAuth();
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
  const activeKey: NavKey | null = bare.startsWith('/documents')
    ? 'library'
    : bare.startsWith('/discover')
      ? 'discover'
      : bare.startsWith('/notes')
        ? 'notes'
        : null;

  const navItems: { key: NavKey; href: string; label: string }[] = [
    { key: 'library', href: localizedPath('/documents'), label: t('nav.app.library', 'مكتبتي') },
    { key: 'discover', href: localizedPath('/discover'), label: t('nav.app.discover', 'اكتشف') },
    { key: 'notes', href: localizedPath('/notes'), label: t('nav.app.notes', 'ملاحظاتي') },
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
          ? 'bg-bg/80 shadow-[0_1px_0_rgba(0,0,0,0.04),0_10px_30px_-20px_rgba(120,80,40,0.18)]'
          : 'bg-bg/65'
      } border-b border-border`}
    >
      <div className="mx-auto flex h-14 max-w-[1280px] items-center gap-4 px-4 sm:px-6 lg:px-8">
        <Link href={localizedPath('/')} className="flex items-center shrink-0" aria-label="ILM Shamela">
          <Image src="/logo.svg" alt="" width={28} height={28} priority className="h-7 w-7 object-contain" />
        </Link>

        <nav className="hidden md:flex flex-1 justify-center items-center gap-5 font-arabic" dir="rtl">
          {navItems.map((item) => {
            const isActive = activeKey === item.key;
            return (
              <Link
                key={item.key}
                href={item.href}
                className={`relative text-[13.5px] tracking-wide transition-colors py-1.5 ${
                  isActive
                    ? 'text-text after:absolute after:inset-x-0 after:-bottom-[14px] after:h-[2px] after:bg-accent after:rounded-full'
                    : 'text-text-2 hover:text-text'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-1.5 font-arabic">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label={t('nav.app.search', 'بحث')}
            title={t('nav.app.search', 'بحث')}
            className="w-9 h-9 inline-flex items-center justify-center rounded-full text-text-2 hover:bg-black/[0.05] hover:text-text transition-colors"
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
            className="w-9 h-9 inline-flex items-center justify-center rounded-full text-text-2 hover:bg-black/[0.05] hover:text-text transition-colors relative"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
          </button>

          <Link
            href={localizedPath('/upload')}
            className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-b from-accent-2 to-accent text-white text-[12.5px] font-medium px-3.5 h-9 shadow-[0_4px_14px_-4px_rgba(185,115,64,0.45),inset_0_1px_0_rgba(255,255,255,0.22)] hover:-translate-y-[1px] transition-transform"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            {t('nav.app.uploadBook', 'رفع كتاب')}
          </Link>

          <AppHeaderAvatarMenu displayName={displayName} avatarInitial={avatarInitial} />
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
            className="bg-card rounded-[18px] border border-border-strong p-6 max-w-md w-full mx-4 shadow-2xl font-arabic"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-3">
              <span className="text-accent" aria-hidden>✦</span>
              <h2 className="font-fraunces text-[17px] text-text">
                {t('nav.app.search.title', 'البحث في كل شيء')}
              </h2>
            </div>
            <p className="text-[13px] text-text-3 leading-[1.7]">
              {t('nav.app.search.comingSoon', 'لوحة الأوامر قريبًا — ستتمكن من البحث في الكتب والملاحظات والإعدادات من مكان واحد.')}
            </p>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setPaletteOpen(false)}
                className="text-[12.5px] text-text-3 hover:text-text transition-colors px-3 py-1.5"
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
