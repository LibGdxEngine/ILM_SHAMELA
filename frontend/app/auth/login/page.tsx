'use client';

import { Suspense, useEffect, useState, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, Variants } from 'framer-motion';
import { Fraunces, Noto_Kufi_Arabic, Manrope } from 'next/font/google';

import { useAuth } from '@/lib/AuthContext';
import { useI18n } from '@/components/i18n/I18nProvider';
import { useLocalizedPath } from '@/lib/i18n/navigation';

const fraunces = Fraunces({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-fraunces',
});
const amiri = Noto_Kufi_Arabic({
  subsets: ['arabic'],
  weight: ['400', '700'],
  variable: '--font-amiri',
});
const manropeFont = Manrope({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-login-sans',
});

const stagger: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.1 },
  },
};

const item: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] },
  },
};

const leftPanel: Variants = {
  hidden: { opacity: 0, x: -20 },
  show: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.05 },
  },
};

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageContent />
    </Suspense>
  );
}

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, isLoading, isAuthenticated } = useAuth();
  const { t, locale } = useI18n();
  const localizedPath = useLocalizedPath();

  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace(localizedPath('/'));
    }
  }, [isAuthenticated, isLoading, localizedPath, router]);

  if (!isLoading && isAuthenticated) {
    return null;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await login({ email, password });
      const next = searchParams.get('next');
      router.push(next || localizedPath('/'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('login.errorFallback', 'فشل تسجيل الدخول'));
    }
  };

  const handleGoogleLogin = () => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) {
      setError(t('login.googleNotConfigured', 'تسجيل الدخول عبر Google غير مهيأ.'));
      return;
    }

    const callbackPath = '/auth/google/callback';
    const redirectUri = encodeURIComponent(window.location.origin + callbackPath);
    const scope = encodeURIComponent('email profile');
    const state = encodeURIComponent(JSON.stringify({ locale }));
    const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=token&scope=${scope}&state=${state}`;

    window.location.href = googleAuthUrl;
  };

  return (
    <div
      className={`auth-shell ${fraunces.variable} ${amiri.variable} ${manropeFont.variable} min-h-screen w-full flex flex-col lg:flex-row lg:justify-end lg:gap-16 p-6 lg:p-12`}
    >
      <motion.aside
        variants={leftPanel}
        initial="hidden"
        animate="show"
        className="auth-left hidden lg:flex lg:w-1/2 flex-col justify-between p-12 relative overflow-hidden"
      >
        <div className="auth-left-stars absolute inset-0 pointer-events-none opacity-40" />

        <Link href={localizedPath('/')} className="relative z-10 flex items-center gap-2 w-fit">
          <span className="auth-brand-letter text-[26px] leading-none">ع</span>
          <span className="auth-brand-name text-[19px] tracking-tight">
            ILM <em className="auth-brand-italic">Shamela</em>
          </span>
        </Link>

        <motion.div
          variants={stagger}
          initial="hidden"
          animate="show"
          className="relative z-10 max-w-lg"
        >
          <motion.div variants={item} className="ornament mb-10">
            <span className="line" />
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" />
            </svg>
            <span className="line r" />
          </motion.div>

          <motion.p
            variants={item}
            className="auth-verse text-[64px] leading-[1.4] font-bold"
            dir="rtl"
          >
            ﴿ اقْرَأْ بِاسْمِ رَبِّكَ
            <br />
            الَّذِي خَلَقَ ﴾
          </motion.p>

          <motion.p variants={item} className="auth-verse-translation mt-8 text-[16px] leading-relaxed italic max-w-md">
            {t('login.verseTranslation', '“Read in the name of your Lord who created.”')}
          </motion.p>

          <motion.p variants={item} className="auth-verse-citation mt-2 text-[12px] tracking-[0.18em] uppercase">
            {t('login.verseCitation', 'Sūrat Al-ʿAlaq · 96:1')}
          </motion.p>
        </motion.div>

        <div className="auth-left-footer relative z-10 flex items-center justify-between text-[11px] tracking-[0.16em] uppercase">
          <span>{t('login.leftFooter', 'The library, after hours')}</span>
          <span>{t('login.leftPage', 'Page · 01')}</span>
        </div>
      </motion.aside>

      <main className="auth-right flex flex-col lg:w-1/2 px-6 sm:px-10 lg:px-16 py-10 lg:py-12 relative">
        <motion.div
          variants={stagger}
          initial="hidden"
          animate="show"
          className="flex-1 flex items-center justify-center"
        >
          <div className="w-full max-w-md">
            <motion.div variants={item} className="mb-7">
              <span className="auth-eyebrow inline-flex items-center gap-2.5 text-[11.5px] tracking-[0.16em] uppercase">
                <span className="auth-eyebrow-line block" />
                {t('login.eyebrow', 'Sign in')}
              </span>
            </motion.div>

            <motion.h1 variants={item} className="auth-headline text-[44px] leading-[1.05] tracking-[-0.02em] mb-4">
              {t('login.headlineLead', 'Welcome')}{' '}
              <em className="auth-headline-em">{t('login.headlineEmphasis', 'back.')}</em>
            </motion.h1>

            <motion.p variants={item} className="auth-subhead text-[15px] leading-relaxed mb-9">
              {t('login.subhead', 'Resume your reading where you left off — your notes, highlights, and citations are waiting.')}
            </motion.p>

            <motion.div variants={item} className="space-y-2.5 mb-7">
              <SocialButton
                onClick={handleGoogleLogin}
                disabled={isLoading}
                icon={<GoogleIcon />}
                label={t('login.googleContinue', 'المتابعة عبر Google')}
              />
            </motion.div>

            <motion.div variants={item} className="auth-divider flex items-center gap-4 mb-7">
              <span className="auth-divider-line flex-1 h-px" />
              <span className="auth-divider-label text-[11px] tracking-[0.16em] uppercase">
                {t('login.orEmail', 'أو بالبريد الإلكتروني')}
              </span>
              <span className="auth-divider-line flex-1 h-px" />
            </motion.div>

            {error && (
              <motion.div
                variants={item}
                role="alert"
                className="auth-error mb-5 rounded-[12px] px-4 py-3 text-[13px]"
              >
                {error}
              </motion.div>
            )}

            <form onSubmit={handleSubmit}>
              <motion.div variants={item} className="mb-4">
                <label htmlFor="email" className="auth-field-label block text-[12px] tracking-[0.08em] uppercase mb-2">
                  {t('login.email', 'البريد الإلكتروني')}
                </label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('auth.placeholder.email', 'you@example.com')}
                  disabled={isLoading}
                  autoComplete="email"
                />
              </motion.div>

              <motion.div variants={item} className="mb-3">
                <div className="flex items-center justify-between mb-2">
                  <label htmlFor="password" className="auth-field-label text-[12px] tracking-[0.08em] uppercase">
                    {t('login.password', 'كلمة المرور')}
                  </label>
                  <Link href="/forgot-password" className="auth-link text-[12px] hover:underline underline-offset-4">
                    {t('login.forgot', 'Forgot it?')}
                  </Link>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t('auth.placeholder.password', '••••••••')}
                    disabled={isLoading}
                    autoComplete="current-password"
                    className="pr-12"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="auth-password-toggle absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-md transition-colors"
                  >
                    {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
              </motion.div>

              <motion.label
                variants={item}
                className="flex items-center gap-2.5 mb-7 cursor-pointer select-none w-fit"
              >
                <span
                  className={`auth-checkbox-box relative w-[18px] h-[18px] rounded-[5px] flex items-center justify-center transition-colors ${
                    remember ? 'is-checked' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                  {remember && (
                    <motion.svg
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ duration: 0.18, ease: 'easeOut' }}
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#1a0e05"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M20 6 9 17l-5-5" />
                    </motion.svg>
                  )}
                </span>
                <span className="auth-checkbox-label text-[13.5px]">
                  {t('login.rememberMe', 'Keep me signed in for 30 days')}
                </span>
              </motion.label>

              <motion.div variants={item}>
                <motion.button
                  type="submit"
                  disabled={isLoading}
                  whileHover={isLoading ? undefined : { y: -1 }}
                  whileTap={isLoading ? undefined : { y: 0, scale: 0.99 }}
                  transition={{ duration: 0.15 }}
                  className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-wait"
                >
                  {isLoading ? (
                    <>
                      <Spinner /> {t('login.openingLibrary', 'Opening the library…')}
                    </>
                  ) : (
                    <>
                      {t('login.signIn', 'تسجيل الدخول')}
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M5 12h14M13 5l7 7-7 7" />
                      </svg>
                    </>
                  )}
                </motion.button>
              </motion.div>
            </form>

            <motion.p variants={item} className="auth-cta mt-9 text-center text-[14px]">
              {t('login.signupCta', 'New to ILM Shamela?')}{' '}
              <Link
                href={localizedPath('/auth/register')}
                className="auth-link-strong hover:underline underline-offset-4"
              >
                {t('login.signupAction', 'Create an account →')}
              </Link>
            </motion.p>
          </div>
        </motion.div>

        <motion.div
          variants={item}
          initial="hidden"
          animate="show"
          transition={{ delay: 0.7 }}
          className="auth-fineprint mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[11.5px] tracking-[0.06em]"
        >
          <span>✦ {t('login.fineEncrypted', 'End-to-end encrypted')}</span>
          <span>✦ {t('login.fineNoTraining', 'No training on your reading')}</span>
          <span>✦ {t('login.fineDeletion', 'Account deletion in one click')}</span>
        </motion.div>
      </main>
    </div>
  );
}

function Input(
  props: React.InputHTMLAttributes<HTMLInputElement> & { className?: string }
) {
  const { className = '', ...rest } = props;
  return (
    <input
      {...rest}
      className={`auth-input w-full px-4 py-3.5 rounded-[12px] text-[15px] outline-none transition-all ${className}`}
    />
  );
}

function SocialButton({
  onClick,
  icon,
  label,
  disabled,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileHover={disabled ? undefined : { y: -1 }}
      whileTap={disabled ? undefined : { y: 0, scale: 0.99 }}
      transition={{ duration: 0.15 }}
      className="auth-social-button w-full flex items-center justify-center gap-3 px-5 py-3.5 rounded-[12px] text-[14px]"
    >
      {icon}
      {label}
    </motion.button>
  );
}

function GoogleIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 16 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.4-4.5 2.4-7.2 2.4-5.3 0-9.7-3.4-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.2 5.2c-.4.4 6.5-4.7 6.5-14.7 0-1.3-.1-2.3-.4-3.5z" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}

function Spinner() {
  return (
    <motion.svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      animate={{ rotate: 360 }}
      transition={{ duration: 0.9, ease: 'linear', repeat: Infinity }}
    >
      <path d="M21 12a9 9 0 1 1-6.22-8.56" />
    </motion.svg>
  );
}
