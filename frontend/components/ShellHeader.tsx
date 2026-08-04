'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

import AppHeaderAvatarMenu from '@/components/AppHeaderAvatarMenu';
import ShellLanguagePills from '@/components/ShellLanguagePills';
import Logo from '@/components/brand/Logo';
import { useAuth } from '@/lib/AuthContext';
import { useI18n } from '@/components/i18n/I18nProvider';
import { useLocalizedPath } from '@/lib/i18n/navigation';
import type { Locale } from '@/lib/i18n/config';

interface ShellHeaderProps {
  /** Center search element — varies per screen (Reading Room ⌘K, Atlas NL, …). */
  search?: ReactNode;
  /** Optional center nav (the Catalog top bar links). */
  nav?: ReactNode;
  /** Subset of locales to show as pills (defaults to all four). */
  languages?: Locale[];
  /** Render the cosmetic light/dark segmented control from the mock. */
  showThemeToggle?: boolean;
  /** Logo box size in px (mock uses 32, the Catalog slim bar uses 30). */
  logoSize?: number;
  /** Center the header content to max-w-[1400px] so it aligns with a contained body. */
  contained?: boolean;
  /** Extra classes on the <header> element. */
  className?: string;
}

/**
 * The unified in-page header shared by the redesigned shells (Reading Room,
 * Catalog, Atlas). It mirrors the standalone mock — star logo + wordmark,
 * a search slot, language pills, an optional theme toggle, and the avatar —
 * and themes itself entirely from the surrounding shell's CSS variables
 * (`--accent`, `--shell-surface`, `--shell-line`, `--shell-muted`, …), so the
 * same component reads gold / crimson / indigo without per-screen props.
 */
export default function ShellHeader({
  search,
  nav,
  languages,
  showThemeToggle = false,
  logoSize = 32,
  contained = false,
  className = '',
}: ShellHeaderProps) {
  const { t } = useI18n();
  const { user, isAuthenticated } = useAuth();
  const localizedPath = useLocalizedPath();

  const displayName =
    (user?.first_name && user.first_name.trim()) ||
    user?.username ||
    user?.email?.split('@')[0] ||
    '';
  const avatarInitial = (displayName[0] || user?.email?.[0] || 'أ').toUpperCase();

  return (
    <header
      className={className}
      style={{
        background: 'var(--shell-surface)',
        borderBottom: '1px solid var(--shell-line)',
        color: 'var(--shell-ink)',
      }}
    >
      <div
        className={`flex items-center gap-5 py-[15px] ${
          contained ? 'mx-auto max-w-[1400px] px-5 sm:px-9 lg:px-12' : 'px-6'
        }`}
      >
      {/* Brand */}
      <Link href={localizedPath('/documents')} className="flex shrink-0 items-center" aria-label="ILM Shamela">
        <Logo className="w-auto" style={{ height: logoSize + 14 }} />
      </Link>

      {/* Center: search and/or nav */}
      {search ? <div className="flex min-w-0 flex-1 items-center">{search}</div> : <div className="flex-1" />}
      {nav}

      {/* Right cluster */}
      <div className="flex shrink-0 items-center gap-3.5">
        {!isAuthenticated && <ShellLanguagePills only={languages} />}

        {showThemeToggle && (
          <div
            className="inline-flex items-center overflow-hidden rounded-[9px] border"
            style={{ borderColor: 'var(--shell-line)' }}
            aria-hidden
          >
            <span className="flex px-[9px] py-[7px]" style={{ background: 'var(--accent)', color: 'var(--shell-on-accent)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="4.5" />
                <path
                  d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <span className="flex px-[9px] py-[7px]" style={{ color: 'var(--shell-muted)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12.8A8 8 0 1 1 11.2 3a6.4 6.4 0 0 0 9.8 9.8Z" />
              </svg>
            </span>
          </div>
        )}

        {isAuthenticated ? (
          <AppHeaderAvatarMenu displayName={displayName} avatarInitial={avatarInitial} />
        ) : (
          <Link
            href={localizedPath('/auth/login')}
            className="flex h-[38px] w-[38px] items-center justify-center rounded-[10px] text-[15px] font-semibold"
            style={{ background: 'var(--accent)', color: 'var(--shell-on-accent)' }}
            aria-label={t('nav.signIn', 'تسجيل الدخول')}
          >
            {avatarInitial}
          </Link>
        )}
      </div>
      </div>
    </header>
  );
}
