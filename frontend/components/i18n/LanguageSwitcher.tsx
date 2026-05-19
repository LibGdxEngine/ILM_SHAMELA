'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { useI18n } from '@/components/i18n/I18nProvider';
import { locales, stripLocalePrefix, withLocale, type Locale } from '@/lib/i18n/config';

interface LanguageSwitcherProps {
  variant?: 'default' | 'compact';
}

export default function LanguageSwitcher({ variant = 'default' }: LanguageSwitcherProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { t, locale } = useI18n();

  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const localeLabel = (target: Locale) =>
    t(`nav.locale.${target}`, target.toUpperCase());

  const localeShort: Record<Locale, string> = {
    ar: 'AR',
    en: 'EN',
    fa: 'FA',
    ur: 'UR',
  };

  const changeLocale = (target: Locale) => {
    setIsOpen(false);
    if (!pathname) return;
    const bare = stripLocalePrefix(pathname);
    const search = typeof window !== 'undefined' ? window.location.search : '';
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    router.push(`${withLocale(bare, target)}${search}${hash}`);
  };

  const buttonClass =
    variant === 'compact'
      ? 'inline-flex items-center gap-1.5 rounded-full border border-border-strong bg-white/[0.03] px-2.5 py-1 text-[12px] text-text-2 hover:border-accent hover:text-accent-2 transition-all'
      : 'inline-flex items-center gap-2 rounded-full border border-border-strong bg-white/[0.03] px-3 py-1.5 text-[12.5px] text-text-2 hover:border-accent hover:text-accent-2 transition-all';

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={t('nav.language', 'Language')}
        className={buttonClass}
      >
        <svg
          width={variant === 'compact' ? '13' : '14'}
          height={variant === 'compact' ? '13' : '14'}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
        <span className="font-medium tracking-wide">{localeShort[locale]}</span>
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <ul
          role="listbox"
          className="absolute top-full mt-2 z-50 min-w-[160px] rounded-[14px] border border-border-strong bg-card-2/95 backdrop-blur-md p-1 shadow-[0_18px_42px_-10px_rgba(0,0,0,0.55)]"
          style={{ insetInlineEnd: 0 }}
        >
          {locales.map((supportedLocale) => {
            const isActive = locale === supportedLocale;
            return (
              <li key={supportedLocale} role="option" aria-selected={isActive}>
                <button
                  type="button"
                  onClick={() => changeLocale(supportedLocale)}
                  className={`flex w-full items-center justify-between gap-3 rounded-[10px] px-3 py-2 text-[13px] transition-colors ${
                    isActive
                      ? 'bg-accent-soft text-accent-2'
                      : 'text-text-2 hover:bg-white/[0.04] hover:text-text'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="font-medium tracking-wide text-[11px] w-7 text-center text-text-3">
                      {localeShort[supportedLocale]}
                    </span>
                    <span className="font-fraunces">{localeLabel(supportedLocale)}</span>
                  </span>
                  {isActive && (
                    <svg
                      className="h-4 w-4 text-accent-2"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                      aria-hidden
                    >
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
    </div>
  );
}
