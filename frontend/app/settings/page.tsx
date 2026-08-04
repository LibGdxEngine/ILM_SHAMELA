'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode } from 'react';
import { motion } from 'framer-motion';

import RequireAuth from '@/components/RequireAuth';
import { useI18n } from '@/components/i18n/I18nProvider';
import { useLocalizedPath } from '@/lib/i18n/navigation';
import { locales, stripLocalePrefix, withLocale, type Locale } from '@/lib/i18n/config';

const LOCALE_LABEL: Record<Locale, string> = {
  ar: 'ar',
  en: 'en',
  fa: 'fa',
  ur: 'ur',
};

function FadeIn({
  children,
  delay = 0,
  className = '',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1], delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export default function SettingsPage() {
  const { t, locale } = useI18n();
  const localizedPath = useLocalizedPath();
  const router = useRouter();
  const pathname = usePathname();

  const changeLocale = (target: Locale) => {
    if (!pathname) return;
    const bare = stripLocalePrefix(pathname);
    const search = typeof window !== 'undefined' ? window.location.search : '';
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    router.push(`${withLocale(bare, target)}${search}${hash}`);
  };

  return (
    <RequireAuth>
      <main className="landing-shell min-h-screen">
        <div className="mx-auto max-w-3xl px-6 sm:px-10 lg:px-16 py-14 relative z-10">
          {/* Header */}
          <header className="mb-10 flex items-start justify-between gap-6">
            <div>
              <FadeIn>
                <span className="section-eyebrow">{t('settings.eyebrow', 'Settings')}</span>
              </FadeIn>
              <FadeIn delay={0.05}>
                <h1 className="font-fraunces font-light text-[clamp(36px,5vw,56px)] leading-[1.05] tracking-tight mt-5 text-text">
                  {t('settings.title', 'Settings')}
                </h1>
              </FadeIn>
              <FadeIn delay={0.1}>
                <p className="mt-4 text-[16px] leading-relaxed text-text-2 max-w-xl">
                  {t('settings.subtitle', 'Customize your app.')}
                </p>
              </FadeIn>
            </div>
            <Link
              href={localizedPath('/profile')}
              className="shrink-0 inline-flex items-center gap-2 rounded-full border border-border-strong px-4 py-2 text-[13px] text-text-2 hover:text-accent-2 hover:border-accent transition-colors"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
              </svg>
              {t('nav.profile', 'Profile')}
            </Link>
          </header>

          {/* Language Section */}
          <FadeIn delay={0.12}>
            <section className="bg-gradient-to-b from-card-2 to-card border border-border rounded-[22px] p-7 md:p-9 relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-white/5 to-transparent" />

              <div className="mb-6">
                <span className="text-[11px] tracking-[0.18em] uppercase text-accent font-medium">
                  {t('settings.language', 'Language')}
                </span>
                <p className="mt-2 text-[14px] text-text-2">
                  {t('settings.languageHint', 'Choose your preferred interface language.')}
                </p>
              </div>

              <ul role="menu" className="space-y-0 rounded-[14px] border border-border overflow-hidden bg-bg/40">
                {locales.map((target, index) => {
                  const isActive = target === locale;
                  return (
                    <li key={target} role="none">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => changeLocale(target)}
                        className={`w-full flex items-center justify-between gap-3 px-4 py-3.5 text-[14px] transition-colors border-b border-border last:border-b-0 ${
                          isActive
                            ? 'bg-accent-soft text-accent-2 font-medium'
                            : 'text-text-2 hover:bg-white/4 hover:text-text'
                        }`}
                      >
                        <span className="flex items-center gap-3">
                          <span className="flex items-center justify-center w-8 h-8 rounded-full bg-bg text-[12px] font-semibold text-text-3 tabular-nums">
                            {LOCALE_LABEL[target].toUpperCase()}
                          </span>
                          <span className="font-fraunces">{t(`nav.locale.${target}`, target.toUpperCase())}</span>
                        </span>
                        {isActive && (
                          <svg className="w-4 h-4 text-accent-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden>
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
            </section>
          </FadeIn>
        </div>
      </main>
    </RequireAuth>
  );
}
