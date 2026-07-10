'use client';

import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion, type Variants } from 'framer-motion';

import { useAuth } from '@/lib/AuthContext';
import { useI18n } from '@/components/i18n/I18nProvider';
import { useLocalizedPath } from '@/lib/i18n/navigation';
import ShellLanguagePills from '@/components/ShellLanguagePills';
import StarMark from '@/components/landing/StarMark';

type Mode = 'signin' | 'signup';

const stagger: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.05, delayChildren: 0.04 } },
};

const item: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } },
};

const brandPanel: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.8, ease: [0.22, 1, 0.36, 1] } },
};

/** 0–4 strength score from length + character classes. */
function passwordScore(pw: string): number {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8) score += 1;
  if (pw.length >= 12) score += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1;
  if (/\d/.test(pw)) score += 1;
  if (/[^A-Za-z0-9]/.test(pw)) score += 1;
  return Math.min(score, 4);
}

export default function AuthPanel({ initialMode }: { initialMode: Mode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, register, isLoading, isAuthenticated } = useAuth();
  const { t, locale, direction } = useI18n();
  const localizedPath = useLocalizedPath();

  const [mode, setMode] = useState<Mode>(initialMode);

  // Shared / per-mode form state.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [remember, setRemember] = useState(true);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace(localizedPath('/'));
    }
  }, [isAuthenticated, isLoading, localizedPath, router]);

  const score = useMemo(() => passwordScore(password), [password]);
  const fieldAlign: CSSProperties['textAlign'] = direction === 'rtl' ? 'right' : 'left';

  if (!isLoading && isAuthenticated) {
    return null;
  }

  // Switch sign-in ⇄ sign-up in place. We update the address bar via
  // history.replaceState (not the Next router) so the panel keeps its mounted
  // state and the AnimatePresence transition runs — a real route navigation
  // would remount the component and reset the animation.
  const switchMode = (next: Mode) => {
    if (next === mode) return;
    setError('');
    setShowPassword(false);
    setMode(next);
    if (typeof window !== 'undefined') {
      const href = localizedPath(next === 'signin' ? '/auth/login' : '/auth/register');
      window.history.replaceState(window.history.state, '', href);
    }
  };

  const handleSignin = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await login({ email, password });
      const next = searchParams.get('next');
      router.push(next || localizedPath('/'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('login.errorFallback', 'Sign-in failed'));
    }
  };

  const handleSignup = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!agreeTerms) return;
    const parts = fullName.trim().split(/\s+/).filter(Boolean);
    const firstName = parts[0] ?? '';
    // A whitespace-only name would send an empty first_name and be rejected by
    // the backend with an opaque 400 — surface a clear inline error instead.
    if (!firstName) {
      setError(t('auth.nameRequired', 'Please enter your name.'));
      return;
    }
    // A single-word name leaves last_name empty (the backend allows blank) —
    // don't duplicate the first name into it.
    const lastName = parts.slice(1).join(' ');
    try {
      await register({
        email,
        password1: password,
        password2: password,
        first_name: firstName,
        last_name: lastName,
      });
      router.push(localizedPath('/'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('register.errorFallback', 'Account creation failed'));
    }
  };

  const handleGoogleLogin = () => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) {
      setError(t('login.googleNotConfigured', 'Google sign-in is not configured.'));
      return;
    }
    const callbackPath = '/auth/google/callback';
    const redirectUri = encodeURIComponent(window.location.origin + callbackPath);
    const scope = encodeURIComponent('email profile');
    const state = encodeURIComponent(JSON.stringify({ locale }));
    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=token&scope=${scope}&state=${state}`;
  };

  const headlineLead = mode === 'signin' ? 'auth.brand.headlineSigninLead' : 'auth.brand.headlineSignupLead';
  const headlineAccent = mode === 'signin' ? 'auth.brand.headlineSigninAccent' : 'auth.brand.headlineSignupAccent';

  return (
    <div className="auth-shell flex min-h-screen w-full">
      {/* ─── Brand panel ─── */}
      <motion.aside
        variants={brandPanel}
        initial="hidden"
        animate="show"
        className="auth-brand relative hidden lg:flex lg:flex-1 flex-col p-12 xl:p-[50px]"
      >
        <KhatimMotif />
        <span className="auth-brand-glow" aria-hidden />

        {/* top: brand + back home */}
        <div className="relative z-10 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <StarMark size={40} holeColor="#234038" className="text-[#E9C77A]" />
            <div className="leading-none">
              <div className="auth-brand-name text-[21px]">{t('auth.brand.name', 'ILM Library')}</div>
              <div className="auth-brand-sub mt-1 text-[8.5px]">ILM SHAMELA</div>
            </div>
          </div>
          <Link href={localizedPath('/')} className="auth-back-home inline-flex items-center gap-2 text-[12.5px]">
            {t('login.backHome', 'Back to home')}
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="rtl:rotate-180">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </Link>
        </div>

        {/* middle: headline + intro + features */}
        <div className="relative z-10 my-auto max-w-[430px]">
          <AnimatePresence mode="wait">
            <motion.h1
              key={mode}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="auth-headline text-[40px] xl:text-[46px] leading-[1.32]"
            >
              {t(headlineLead, '')}{' '}
              <span className="auth-headline-accent">{t(headlineAccent, '')}</span>
            </motion.h1>
          </AnimatePresence>

          <p className="auth-brand-intro mt-6 text-[15px] leading-[1.9]">{t('auth.brand.intro', '')}</p>

          <div className="mt-8 flex flex-col gap-4">
            <Feature icon={<BookIcon />} text={t('auth.brand.feature1', '')} />
            <Feature icon={<BadgeCheckIcon />} text={t('auth.brand.feature2', '')} />
            <Feature icon={<LockIcon />} text={t('auth.brand.feature3', '')} />
          </div>
        </div>

        {/* bottom: cited proof card */}
        <div className="auth-proof-card relative z-10 px-[17px] py-4">
          <div className="mb-2.5 flex items-center gap-2">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="#E9C77A" aria-hidden>
              <path d="M12 2l1.7 7L21 11l-7.3 2L12 22l-1.7-9L3 11l7.3-2z" />
            </svg>
            <span className="auth-proof-label text-[12.5px]">{t('auth.card.label', 'AI Assistant')}</span>
            <span className="auth-proof-cites text-[11px] ms-auto">{t('auth.card.cites', 'Cites the source')}</span>
          </div>
          <div className="auth-proof-quote text-[15px] leading-[1.85]">{t('auth.card.quote', '')}</div>
          <div className="auth-proof-citation mt-3 inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px]">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M4 5a2 2 0 0 1 2-2h11a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2z" />
            </svg>
            {t('auth.card.citation', '')}
          </div>
        </div>
      </motion.aside>

      {/* ─── Form panel ─── */}
      <main className="auth-form-panel flex w-full flex-col px-6 py-8 sm:px-10 lg:w-[560px] lg:flex-shrink-0 lg:px-14">
        {/* language pills */}
        <div className="flex justify-start">
          <ShellLanguagePills />
        </div>

        <div className="mx-auto flex w-full max-w-[404px] flex-1 flex-col justify-center py-8">
          {/* tabs */}
          <div className="auth-tabs mb-7 grid grid-cols-2 gap-[5px] p-[5px]">
            {(['signin', 'signup'] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                className={`auth-tab flex items-center justify-center py-[11px] text-[14.5px] ${mode === m ? 'is-active' : ''}`}
                aria-pressed={mode === m}
              >
                {mode === m && (
                  <motion.span
                    layoutId="authTabIndicator"
                    className="auth-tab-indicator"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  />
                )}
                <span className="auth-tab-label">
                  {t(m === 'signin' ? 'auth.tab.signin' : 'auth.tab.signup', m === 'signin' ? 'Sign in' : 'Sign up')}
                </span>
              </button>
            ))}
          </div>

          {error && (
            <div role="alert" className="auth-error mb-5 rounded-[12px] px-4 py-3 text-[13px]">
              {error}
            </div>
          )}

          <AnimatePresence mode="wait" initial={false}>
            {mode === 'signin' ? (
              <motion.div
                key="signin"
                variants={stagger}
                initial="hidden"
                animate="show"
                exit={{ opacity: 0, x: direction === 'rtl' ? 24 : -24, transition: { duration: 0.2 } }}
              >
                <motion.h2 variants={item} className="auth-form-heading text-[27px]">
                  {t('auth.signin.heading', 'Welcome back')}
                </motion.h2>
                <motion.p variants={item} className="auth-form-subhead mt-2.5 mb-6 text-[14px]">
                  {t('auth.signin.subhead', 'Sign in to continue reading where you left off.')}
                </motion.p>

                <motion.div variants={item}>
                  <GoogleButton onClick={handleGoogleLogin} disabled={isLoading} label={t('login.googleContinue', 'Continue with Google')} />
                </motion.div>

                <Divider label={t('login.orEmail', 'Or with email')} />

                <form onSubmit={handleSignin}>
                  <motion.div variants={item} className="mb-4">
                    <FieldLabel htmlFor="email">{t('login.email', 'Email address')}</FieldLabel>
                    <Field icon={<MailIcon />}>
                      <input
                        id="email"
                        type="email"
                        required
                        dir="ltr"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder={t('auth.placeholder.email', 'you@example.com')}
                        disabled={isLoading}
                        autoComplete="email"
                        className="auth-input text-[14.5px]"
                        style={{ paddingBlock: 13, paddingInlineStart: 44, paddingInlineEnd: 15, textAlign: fieldAlign }}
                      />
                    </Field>
                  </motion.div>

                  <motion.div variants={item} className="mb-4">
                    <div className="mb-1.5 flex items-center justify-between">
                      <FieldLabel htmlFor="password" inline>{t('login.password', 'Password')}</FieldLabel>
                      <Link href={localizedPath('/forgot-password')} className="auth-link text-[12.5px]">
                        {t('login.forgot', 'Forgot it?')}
                      </Link>
                    </div>
                    <PasswordField
                      id="password"
                      value={password}
                      onChange={setPassword}
                      show={showPassword}
                      onToggle={() => setShowPassword((v) => !v)}
                      disabled={isLoading}
                      placeholder={t('auth.placeholder.password', '••••••••')}
                      autoComplete="current-password"
                      align={fieldAlign}
                    />
                  </motion.div>

                  <motion.label variants={item} className="mb-6 flex w-fit cursor-pointer select-none items-center gap-2.5">
                    <Checkbox checked={remember} onChange={setRemember} />
                    <span className="auth-checkbox-label text-[13.5px]">{t('auth.rememberDevice', 'Remember me on this device')}</span>
                  </motion.label>

                  <motion.div variants={item}>
                    <SubmitButton
                      loading={isLoading}
                      loadingLabel={t('login.openingLibrary', 'Opening the library…')}
                      label={t('login.signIn', 'Sign in')}
                    />
                  </motion.div>
                </form>

                <motion.p variants={item} className="auth-cta mt-5 text-center text-[13.5px]">
                  {t('auth.signinCtaLead', "Don’t have an account?")}{' '}
                  <button type="button" onClick={() => switchMode('signup')} className="auth-cta-action">
                    {t('auth.signinCtaAction', 'Create one free')}
                  </button>
                </motion.p>
              </motion.div>
            ) : (
              <motion.div
                key="signup"
                variants={stagger}
                initial="hidden"
                animate="show"
                exit={{ opacity: 0, x: direction === 'rtl' ? -24 : 24, transition: { duration: 0.2 } }}
              >
                <motion.h2 variants={item} className="auth-form-heading text-[27px]">
                  {t('auth.signup.heading', 'Create your account')}
                </motion.h2>
                <motion.p variants={item} className="auth-form-subhead mt-2.5 mb-6 text-[14px]">
                  {t('auth.signup.subhead', 'Ready in under a minute. No card.')}
                </motion.p>

                <motion.div variants={item}>
                  <GoogleButton onClick={handleGoogleLogin} disabled={isLoading} label={t('auth.googleSignup', 'Sign up with Google')} />
                </motion.div>

                <Divider label={t('login.orEmail', 'Or with email')} />

                <form onSubmit={handleSignup}>
                  <motion.div variants={item} className="mb-3.5">
                    <FieldLabel htmlFor="fullName">{t('auth.fullName', 'Full name')}</FieldLabel>
                    <Field icon={<UserIcon />}>
                      <input
                        id="fullName"
                        type="text"
                        required
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder={t('auth.fullNamePlaceholder', 'e.g. Ahmad ibn Abdullah')}
                        disabled={isLoading}
                        autoComplete="name"
                        className="auth-input text-[14.5px]"
                        style={{ paddingBlock: 13, paddingInlineStart: 44, paddingInlineEnd: 15 }}
                      />
                    </Field>
                  </motion.div>

                  <motion.div variants={item} className="mb-3.5">
                    <FieldLabel htmlFor="email-signup">{t('login.email', 'Email address')}</FieldLabel>
                    <Field icon={<MailIcon />}>
                      <input
                        id="email-signup"
                        type="email"
                        required
                        dir="ltr"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder={t('auth.placeholder.email', 'you@example.com')}
                        disabled={isLoading}
                        autoComplete="email"
                        className="auth-input text-[14.5px]"
                        style={{ paddingBlock: 13, paddingInlineStart: 44, paddingInlineEnd: 15, textAlign: fieldAlign }}
                      />
                    </Field>
                  </motion.div>

                  <motion.div variants={item} className="mb-2.5">
                    <FieldLabel htmlFor="password-signup">{t('login.password', 'Password')}</FieldLabel>
                    <PasswordField
                      id="password-signup"
                      value={password}
                      onChange={setPassword}
                      show={showPassword}
                      onToggle={() => setShowPassword((v) => !v)}
                      disabled={isLoading}
                      placeholder={t('auth.passwordHint8', 'At least 8 characters')}
                      autoComplete="new-password"
                      minLength={8}
                      align={fieldAlign}
                    />
                  </motion.div>

                  {/* strength meter */}
                  <motion.div variants={item} className="mb-4">
                    <div className="flex gap-1.5">
                      {[0, 1, 2, 3].map((i) => (
                        <span
                          key={i}
                          className={`auth-strength-seg ${i < score ? strengthClass(score) : ''}`}
                        />
                      ))}
                    </div>
                    {password.length > 0 && (
                      <p className="auth-strength-label mt-1.5 text-[11.5px]">{t(strengthLabelKey(score), '')}</p>
                    )}
                  </motion.div>

                  <motion.label variants={item} className="mb-5 flex cursor-pointer select-none items-start gap-2.5">
                    <Checkbox checked={agreeTerms} onChange={setAgreeTerms} className="mt-0.5" />
                    <span className="auth-checkbox-label text-[12.5px] leading-[1.7]">
                      {t('auth.terms.lead', 'I agree to the')}{' '}
                      <Link href={localizedPath('/terms')} className="auth-link font-semibold">
                        {t('auth.terms.tos', 'Terms of Service')}
                      </Link>
                      {t('auth.terms.and', ' and ')}
                      <Link href={localizedPath('/privacy')} className="auth-link font-semibold">
                        {t('auth.terms.privacy', 'Privacy Policy')}
                      </Link>
                      {t('auth.terms.trailing', '')}
                    </span>
                  </motion.label>

                  <motion.div variants={item}>
                    <SubmitButton
                      loading={isLoading}
                      disabled={!agreeTerms}
                      loadingLabel={t('register.creating', 'Creating account...')}
                      label={t('auth.signupSubmit', 'Create account — free')}
                    />
                  </motion.div>
                </form>

                <motion.p variants={item} className="auth-cta mt-5 text-center text-[13.5px]">
                  {t('auth.signupCtaLead', 'Already have an account?')}{' '}
                  <button type="button" onClick={() => switchMode('signin')} className="auth-cta-action">
                    {t('auth.signupCtaAction', 'Sign in')}
                  </button>
                </motion.p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* footer trust row */}
        <div className="auth-trust flex flex-wrap items-center justify-center gap-x-3.5 gap-y-2 text-[12px]">
          <span className="flex items-center gap-1.5">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="auth-trust-icon" aria-hidden>
              <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
            </svg>
            {t('login.fineEncrypted', 'End-to-end encrypted')}
          </span>
          <span className="auth-trust-dot" aria-hidden />
          <span>{t('auth.trust.noCard', 'No card')}</span>
          <span className="auth-trust-dot" aria-hidden />
          <span>{t('login.fineNoTraining', 'No training on your reading')}</span>
        </div>
      </main>
    </div>
  );
}

function strengthClass(score: number): string {
  if (score <= 1) return 'is-weak';
  if (score === 2) return 'is-fair';
  return 'is-good';
}
function strengthLabelKey(score: number): string {
  if (score <= 1) return 'auth.strength.weak';
  if (score === 2) return 'auth.strength.fair';
  if (score === 3) return 'auth.strength.good';
  return 'auth.strength.strong';
}

function FieldLabel({ htmlFor, children, inline }: { htmlFor: string; children: ReactNode; inline?: boolean }) {
  return (
    <label htmlFor={htmlFor} className={`auth-field-label text-[13px] ${inline ? '' : 'mb-1.5 block'}`}>
      {children}
    </label>
  );
}

function Field({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="relative">
      {icon && (
        <span className="auth-field-icon absolute top-1/2 flex -translate-y-1/2" style={{ insetInlineStart: 14 }} aria-hidden>
          {icon}
        </span>
      )}
      {children}
    </div>
  );
}

function PasswordField({
  id,
  value,
  onChange,
  show,
  onToggle,
  disabled,
  placeholder,
  autoComplete,
  minLength,
  align,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
  disabled?: boolean;
  placeholder?: string;
  autoComplete?: string;
  minLength?: number;
  align?: CSSProperties['textAlign'];
}) {
  return (
    <div className="relative">
      <span className="auth-field-icon absolute top-1/2 flex -translate-y-1/2" style={{ insetInlineStart: 14 }} aria-hidden>
        <LockIcon small />
      </span>
      <input
        id={id}
        type={show ? 'text' : 'password'}
        required
        minLength={minLength}
        dir="ltr"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete={autoComplete}
        className="auth-input text-[14.5px]"
        style={{ paddingBlock: 13, paddingInlineStart: 44, paddingInlineEnd: 44, textAlign: align }}
      />
      <button
        type="button"
        onClick={onToggle}
        aria-label={show ? 'Hide password' : 'Show password'}
        className="auth-password-toggle absolute top-1/2 flex -translate-y-1/2 p-1"
        style={{ insetInlineEnd: 12 }}
      >
        {show ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}

function Checkbox({ checked, onChange, className = '' }: { checked: boolean; onChange: (v: boolean) => void; className?: string }) {
  return (
    <span className={`auth-checkbox-box ${checked ? '' : 'is-unchecked'} ${className}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="absolute h-[18px] w-[18px] cursor-pointer opacity-0"
      />
      {checked && (
        <motion.svg
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#FCF8EE"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20 6 9 17l-5-5" />
        </motion.svg>
      )}
    </span>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <div className="my-5 flex items-center gap-3.5">
      <span className="auth-divider-line h-px flex-1" />
      <span className="auth-divider-label text-[12.5px]">{label}</span>
      <span className="auth-divider-line h-px flex-1" />
    </div>
  );
}

function GoogleButton({ onClick, disabled, label }: { onClick: () => void; disabled?: boolean; label: string }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileHover={disabled ? undefined : { y: -1 }}
      whileTap={disabled ? undefined : { scale: 0.99 }}
      transition={{ duration: 0.15 }}
      className="auth-social-button flex items-center justify-center gap-3 px-5 py-[13px] text-[14.5px]"
    >
      <svg width="19" height="19" viewBox="0 0 48 48" aria-hidden>
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
      </svg>
      {label}
    </motion.button>
  );
}

function SubmitButton({
  loading,
  disabled,
  loadingLabel,
  label,
}: {
  loading?: boolean;
  disabled?: boolean;
  loadingLabel: string;
  label: string;
}) {
  const blocked = loading || disabled;
  return (
    <motion.button
      type="submit"
      disabled={blocked}
      whileHover={blocked ? undefined : { y: -1 }}
      whileTap={blocked ? undefined : { scale: 0.99 }}
      transition={{ duration: 0.15 }}
      className="auth-primary-btn flex items-center justify-center gap-2 px-5 py-[14px] text-[15.5px]"
    >
      {loading ? (
        <>
          <Spinner /> {loadingLabel}
        </>
      ) : (
        label
      )}
    </motion.button>
  );
}

function Feature({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-3.5">
      <span className="auth-feature-icon">{icon}</span>
      <span className="auth-feature-text text-[14px]">{text}</span>
    </div>
  );
}

function KhatimMotif() {
  return (
    <svg className="auth-khatim" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <pattern id="auth-khatim" width="94" height="94" patternUnits="userSpaceOnUse">
          <path
            d="M47 7 L55 27 L75 19 L67 39 L87 47 L67 55 L75 75 L55 67 L47 87 L39 67 L19 75 L27 55 L7 47 L27 39 L19 19 L39 27 Z"
            fill="none"
            stroke="#E9C77A"
            strokeWidth="1.1"
          />
          <circle cx="47" cy="47" r="9" fill="none" stroke="#E9C77A" strokeWidth="1.1" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#auth-khatim)" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 3v18M3 8l9-5 9 5M5 11v7M19 11v7M3 18h18" />
    </svg>
  );
}
function BadgeCheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}
function LockIcon({ small }: { small?: boolean }) {
  const s = small ? 17 : 16;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={small ? 1.9 : 2} aria-hidden>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
function MailIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </svg>
  );
}
function UserIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
    </svg>
  );
}
function EyeIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function EyeOffIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
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
      aria-hidden
    >
      <path d="M21 12a9 9 0 1 1-6.22-8.56" />
    </motion.svg>
  );
}
