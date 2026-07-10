'use client';

import { usePathname, useRouter } from 'next/navigation';

import { useI18n } from '@/components/i18n/I18nProvider';
import { locales, stripLocalePrefix, withLocale, type Locale } from '@/lib/i18n/config';

/**
 * Inline language pills (ع / EN / فا / اردو) matching the standalone mock's
 * header switcher. Reuses the same locale-rewrite logic as LanguageSwitcher
 * (strip → withLocale → push, preserving query + hash) so switching is real.
 * Themes itself from the surrounding shell via `--accent` / `--shell-*` vars.
 */
const SHORT: Record<Locale, string> = { ar: 'ع', en: 'EN', fa: 'فا', ur: 'اردو' };

interface ShellLanguagePillsProps {
  /** Restrict to a subset of locales (e.g. the Atlas mock shows only ع/EN/فا). */
  only?: Locale[];
}

export default function ShellLanguagePills({ only }: ShellLanguagePillsProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { locale } = useI18n();

  const shown = only ?? locales;

  const change = (target: Locale) => {
    if (!pathname || target === locale) return;
    const bare = stripLocalePrefix(pathname);
    const search = typeof window !== 'undefined' ? window.location.search : '';
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    router.push(`${withLocale(bare, target)}${search}${hash}`);
  };

  return (
    <div
      className="inline-flex items-center overflow-hidden rounded-[9px] border text-[12.5px] font-semibold"
      style={{ borderColor: 'var(--shell-line, rgba(0,0,0,0.10))' }}
    >
      {shown.map((l) => {
        const active = l === locale;
        return (
          <button
            key={l}
            type="button"
            onClick={() => change(l)}
            aria-current={active ? 'true' : undefined}
            lang={l}
            className="px-[10px] py-[6px] transition-colors"
            style={
              active
                ? { background: 'var(--accent)', color: 'var(--shell-on-accent, #fff)' }
                : { color: 'var(--shell-muted, currentColor)' }
            }
          >
            {SHORT[l]}
          </button>
        );
      })}
    </div>
  );
}
