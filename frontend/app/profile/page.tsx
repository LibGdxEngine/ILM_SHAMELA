'use client';

import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';

import RequireAuth from '@/components/RequireAuth';
import LanguageSwitcher from '@/components/i18n/LanguageSwitcher';
import { useAuth } from '@/lib/AuthContext';
import { AuthValidationError } from '@/lib/auth';
import { useI18n } from '@/components/i18n/I18nProvider';
import { useLocalizedPath } from '@/lib/i18n/navigation';

interface ProfileFormValues {
  first_name: string;
  last_name: string;
  email: string;
  avatar: string;
  current_password: string;
  new_password: string;
  new_password_confirm: string;
}

interface ProfileFieldErrors {
  first_name?: string;
  last_name?: string;
  email?: string;
  avatar?: string;
  current_password?: string;
  new_password?: string;
  new_password_confirm?: string;
}

const EMPTY_FORM: ProfileFormValues = {
  first_name: '',
  last_name: '',
  email: '',
  avatar: '',
  current_password: '',
  new_password: '',
  new_password_confirm: '',
};

const EMPTY_ERRORS: ProfileFieldErrors = {};

const INPUT_BASE =
  'w-full px-4 py-3.5 rounded-[12px] text-[15px] font-fraunces outline-none transition-all bg-white/[0.02] text-text placeholder:text-text-3 focus:border-accent focus:bg-accent-soft focus:shadow-[0_0_0_4px_rgba(192,133,82,0.08)] disabled:opacity-60 disabled:cursor-not-allowed';
const INPUT_BORDER = 'border border-border';
const INPUT_BORDER_ERROR = 'border border-red-500/50';
const LABEL_CLASS = 'block text-[12px] tracking-[0.08em] uppercase text-text-3 mb-2';
const FIELD_ERROR_CLASS = 'mt-2 text-[12.5px] text-red-300';

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

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

export default function ProfilePage() {
  const { user, isLoading, updateProfile, logout } = useAuth();
  const { t } = useI18n();
  const localizedPath = useLocalizedPath();
  const router = useRouter();

  const [formValues, setFormValues] = useState<ProfileFormValues>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<ProfileFieldErrors>(EMPTY_ERRORS);
  const [generalError, setGeneralError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await logout();
      router.push(localizedPath('/'));
    } catch {
      setIsLoggingOut(false);
    }
  };

  useEffect(() => {
    if (!user) return;

    setFormValues({
      first_name: user.first_name ?? '',
      last_name: user.last_name ?? '',
      email: user.email ?? '',
      avatar: user.avatar ?? '',
      current_password: '',
      new_password: '',
      new_password_confirm: '',
    });
    setFieldErrors(EMPTY_ERRORS);
    setGeneralError('');
  }, [user]);

  const normalizedCurrent = useMemo(
    () => ({
      first_name: (user?.first_name ?? '').trim(),
      last_name: (user?.last_name ?? '').trim(),
      email: (user?.email ?? '').trim().toLowerCase(),
      avatar: (user?.avatar ?? '').trim(),
    }),
    [user]
  );

  const normalizedDraft = useMemo(
    () => ({
      first_name: formValues.first_name.trim(),
      last_name: formValues.last_name.trim(),
      email: formValues.email.trim().toLowerCase(),
      avatar: formValues.avatar.trim(),
    }),
    [formValues.first_name, formValues.last_name, formValues.email, formValues.avatar]
  );

  const hasAnyPasswordValue =
    formValues.current_password.length > 0 ||
    formValues.new_password.length > 0 ||
    formValues.new_password_confirm.length > 0;

  const hasAllPasswordValues =
    formValues.current_password.length > 0 &&
    formValues.new_password.length > 0 &&
    formValues.new_password_confirm.length > 0;

  const isProfileDirty =
    normalizedCurrent.first_name !== normalizedDraft.first_name ||
    normalizedCurrent.last_name !== normalizedDraft.last_name ||
    normalizedCurrent.email !== normalizedDraft.email ||
    normalizedCurrent.avatar !== normalizedDraft.avatar;

  const hasRequiredValues =
    normalizedDraft.first_name.length > 0 &&
    normalizedDraft.last_name.length > 0 &&
    normalizedDraft.email.length > 0;

  const canSubmit =
    ((isProfileDirty && hasRequiredValues) || hasAllPasswordValues) &&
    !isLoading &&
    !isSaving;

  const handleChange = (field: keyof ProfileFormValues, value: string) => {
    setFormValues((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
    setGeneralError('');
    setSuccessMessage('');
  };

  const validateForm = (): ProfileFieldErrors => {
    const nextErrors: ProfileFieldErrors = {};

    if (!normalizedDraft.first_name) {
      nextErrors.first_name = t('profile.firstNameRequired', 'First name is required.');
    }

    if (!normalizedDraft.last_name) {
      nextErrors.last_name = t('profile.lastNameRequired', 'Last name is required.');
    }

    if (!normalizedDraft.email) {
      nextErrors.email = t('profile.emailRequired', 'Email is required.');
    }

    if (normalizedDraft.avatar && !isValidUrl(normalizedDraft.avatar)) {
      nextErrors.avatar = t('profile.avatarInvalid', 'Please enter a valid URL.');
    }

    if (hasAnyPasswordValue && !hasAllPasswordValues) {
      if (!formValues.current_password) {
        nextErrors.current_password = t(
          'profile.currentPasswordRequired',
          'Current password is required.'
        );
      }
      if (!formValues.new_password) {
        nextErrors.new_password = t('profile.newPasswordRequired', 'New password is required.');
      }
      if (!formValues.new_password_confirm) {
        nextErrors.new_password_confirm = t(
          'profile.confirmPasswordRequired',
          'Please confirm your new password.'
        );
      }
    }

    if (hasAllPasswordValues && formValues.new_password !== formValues.new_password_confirm) {
      nextErrors.new_password_confirm = t(
        'profile.passwordMismatch',
        'New password and confirmation do not match.'
      );
    }

    return nextErrors;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSuccessMessage('');
    setGeneralError('');

    const nextErrors = validateForm();
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      return;
    }

    const payload: {
      first_name?: string;
      last_name?: string;
      email?: string;
      avatar?: string | null;
      current_password?: string;
      new_password?: string;
      new_password_confirm?: string;
    } = {};

    if (isProfileDirty) {
      payload.first_name = normalizedDraft.first_name;
      payload.last_name = normalizedDraft.last_name;
      payload.email = normalizedDraft.email;
      payload.avatar = normalizedDraft.avatar || null;
    }

    if (hasAllPasswordValues) {
      payload.current_password = formValues.current_password;
      payload.new_password = formValues.new_password;
      payload.new_password_confirm = formValues.new_password_confirm;
    }

    if (Object.keys(payload).length === 0) {
      return;
    }

    setFieldErrors(EMPTY_ERRORS);
    setIsSaving(true);

    try {
      await updateProfile(payload);
      setSuccessMessage(t('profile.saved', 'Profile updated successfully.'));
      setFormValues((prev) => ({
        ...prev,
        current_password: '',
        new_password: '',
        new_password_confirm: '',
      }));
    } catch (error) {
      if (error instanceof AuthValidationError) {
        const nextFieldErrors = error.fieldErrors as ProfileFieldErrors;
        setFieldErrors(nextFieldErrors);

        const hasMatchingFieldMessage = Object.values(nextFieldErrors)
          .filter((value): value is string => Boolean(value))
          .includes(error.message);

        if (!hasMatchingFieldMessage) {
          setGeneralError(error.message);
        }
      } else {
        setGeneralError(
          error instanceof Error
            ? error.message
            : t('profile.errorFallback', 'Failed to update profile.')
        );
      }
    } finally {
      setIsSaving(false);
    }
  };

  const displayName = `${normalizedDraft.first_name} ${normalizedDraft.last_name}`.trim();
  const avatarLabel = displayName || normalizedDraft.email || 'U';
  const avatarPreviewUrl =
    normalizedDraft.avatar && isValidUrl(normalizedDraft.avatar) ? normalizedDraft.avatar : null;

  return (
    <RequireAuth>
      <main className="landing-shell min-h-screen">
        {/* Top bar — brand mark + back to home */}
        <div className="px-6 sm:px-10 lg:px-16 pt-8 flex items-center justify-between relative z-10">
          <Link href={localizedPath('/')} className="flex items-center gap-2">
            <span className="font-fraunces text-[24px] text-accent-2 leading-none">ع</span>
            <span className="font-fraunces text-[18px] tracking-tight">
              ILM <em className="italic text-text-2">Shamela</em>
            </span>
          </Link>
          <div className="flex items-center gap-5 sm:gap-7">
            <Link
              href={localizedPath('/')}
              className="hidden sm:flex items-center gap-2 text-[13px] text-text-3 hover:text-text-2 transition-colors"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <path d="m15 18-6-6 6-6" />
              </svg>
              {t('login.backHome', 'Back to home')}
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="inline-flex items-center gap-2 text-[13px] text-text-2 hover:text-accent-2 transition-colors disabled:opacity-60 disabled:cursor-wait"
            >
              {isLoggingOut ? (
                <Spinner />
              ) : (
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
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <path d="m16 17 5-5-5-5" />
                  <path d="M21 12H9" />
                </svg>
              )}
              {t('nav.signOut', 'Sign out')}
            </button>
            <LanguageSwitcher />
          </div>
        </div>

        <div className="mx-auto max-w-3xl px-6 sm:px-10 lg:px-16 py-14 relative z-10">
          {/* Header */}
          <header className="mb-10">
            <FadeIn>
              <span className="section-eyebrow">{t('profile.eyebrow', 'Account')}</span>
            </FadeIn>
            <FadeIn delay={0.05}>
              <h1 className="font-fraunces font-light text-[clamp(36px,5vw,56px)] leading-[1.05] tracking-tight mt-5 text-text">
                {t('profile.title', 'Profile')}
              </h1>
            </FadeIn>
            <FadeIn delay={0.1}>
              <p className="mt-4 text-[16px] leading-relaxed text-text-2 max-w-xl">
                {t('profile.subtitle', 'Manage your account details.')}
              </p>
            </FadeIn>
          </header>

          {generalError && (
            <FadeIn className="mb-5">
              <div
                role="alert"
                className="rounded-[12px] px-4 py-3 text-[13px] bg-red-500/10 border border-red-500/40 text-red-200"
              >
                {generalError}
              </div>
            </FadeIn>
          )}

          {successMessage && (
            <FadeIn className="mb-5">
              <div
                role="status"
                className="rounded-[12px] px-4 py-3 text-[13px] bg-accent-soft border border-accent/40 text-accent-2"
              >
                {successMessage}
              </div>
            </FadeIn>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Identity + account details */}
            <FadeIn delay={0.12}>
              <section className="bg-gradient-to-b from-card-2 to-card border border-border rounded-[22px] p-7 md:p-9 relative overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-white/5 to-transparent" />

                {/* Avatar + display name strip */}
                <div className="mb-8 flex items-center gap-5 border-b border-border pb-7">
                  <div className="h-16 w-16 overflow-hidden rounded-full border border-accent/30 bg-gradient-to-br from-accent-2 to-accent text-[#1a0e05] shadow-[0_4px_20px_-4px_rgba(192,133,82,0.4)]">
                    {avatarPreviewUrl ? (
                      <img
                        src={avatarPreviewUrl}
                        alt={t('profile.avatarAlt', 'Profile avatar')}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[20px] font-fraunces font-semibold">
                        {avatarLabel[0]?.toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="font-fraunces text-[20px] text-text truncate">
                      {displayName || t('profile.noName', 'No name yet')}
                    </p>
                    <p className="text-[13px] text-text-3 truncate">
                      {normalizedDraft.email || t('profile.email', 'Email')}
                    </p>
                  </div>
                </div>

                {/* Account details heading */}
                <div className="mb-6">
                  <span className="text-[11px] tracking-[0.18em] uppercase text-accent font-medium">
                    {t('profile.accountDetails', 'Account details')}
                  </span>
                  <p className="mt-2 text-[14px] text-text-2">
                    {t('profile.accountDetailsHint', 'Update your personal information and avatar.')}
                  </p>
                </div>

                <div className="grid gap-5 md:grid-cols-2">
                  <div>
                    <label htmlFor="first_name" className={LABEL_CLASS}>
                      {t('profile.firstName', 'First name')}
                    </label>
                    <input
                      id="first_name"
                      type="text"
                      value={formValues.first_name}
                      onChange={(event) => handleChange('first_name', event.target.value)}
                      aria-invalid={Boolean(fieldErrors.first_name)}
                      className={`${INPUT_BASE} ${
                        fieldErrors.first_name ? INPUT_BORDER_ERROR : INPUT_BORDER
                      }`}
                      disabled={isLoading || isSaving}
                    />
                    {fieldErrors.first_name && (
                      <p className={FIELD_ERROR_CLASS}>{fieldErrors.first_name}</p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="last_name" className={LABEL_CLASS}>
                      {t('profile.lastName', 'Last name')}
                    </label>
                    <input
                      id="last_name"
                      type="text"
                      value={formValues.last_name}
                      onChange={(event) => handleChange('last_name', event.target.value)}
                      aria-invalid={Boolean(fieldErrors.last_name)}
                      className={`${INPUT_BASE} ${
                        fieldErrors.last_name ? INPUT_BORDER_ERROR : INPUT_BORDER
                      }`}
                      disabled={isLoading || isSaving}
                    />
                    {fieldErrors.last_name && (
                      <p className={FIELD_ERROR_CLASS}>{fieldErrors.last_name}</p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="email" className={LABEL_CLASS}>
                      {t('profile.email', 'Email')}
                    </label>
                    <input
                      id="email"
                      type="email"
                      value={formValues.email}
                      onChange={(event) => handleChange('email', event.target.value)}
                      aria-invalid={Boolean(fieldErrors.email)}
                      className={`${INPUT_BASE} ${
                        fieldErrors.email ? INPUT_BORDER_ERROR : INPUT_BORDER
                      }`}
                      disabled={isLoading || isSaving}
                    />
                    {fieldErrors.email && (
                      <p className={FIELD_ERROR_CLASS}>{fieldErrors.email}</p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="avatar" className={LABEL_CLASS}>
                      {t('profile.avatar', 'Avatar URL')}{' '}
                      <span className="text-text-3 normal-case tracking-normal">
                        {t('profile.optional', '(optional)')}
                      </span>
                    </label>
                    <input
                      id="avatar"
                      type="url"
                      value={formValues.avatar}
                      onChange={(event) => handleChange('avatar', event.target.value)}
                      aria-invalid={Boolean(fieldErrors.avatar)}
                      placeholder={t('profile.avatarPlaceholder', 'https://example.com/avatar.jpg')}
                      className={`${INPUT_BASE} ${
                        fieldErrors.avatar ? INPUT_BORDER_ERROR : INPUT_BORDER
                      }`}
                      disabled={isLoading || isSaving}
                    />
                    {fieldErrors.avatar ? (
                      <p className={FIELD_ERROR_CLASS}>{fieldErrors.avatar}</p>
                    ) : (
                      <p className="mt-2 text-[12px] text-text-3">
                        {t('profile.avatarHelp', 'Use a public image URL (http or https).')}
                      </p>
                    )}
                  </div>
                </div>
              </section>
            </FadeIn>

            {/* Security */}
            <FadeIn delay={0.18}>
              <section className="bg-gradient-to-b from-card-2 to-card border border-border rounded-[22px] p-7 md:p-9 relative overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-white/5 to-transparent" />

                <div className="mb-6">
                  <span className="text-[11px] tracking-[0.18em] uppercase text-accent font-medium">
                    {t('profile.security', 'Security')}
                  </span>
                  <p className="mt-2 text-[14px] text-text-2">
                    {t(
                      'profile.securityHint',
                      'Leave these fields empty if you do not want to change your password.'
                    )}
                  </p>
                </div>

                <div className="grid gap-5 md:grid-cols-2">
                  <div className="md:col-span-2">
                    <label htmlFor="current_password" className={LABEL_CLASS}>
                      {t('profile.currentPassword', 'Current password')}
                    </label>
                    <input
                      id="current_password"
                      type="password"
                      value={formValues.current_password}
                      onChange={(event) => handleChange('current_password', event.target.value)}
                      aria-invalid={Boolean(fieldErrors.current_password)}
                      className={`${INPUT_BASE} ${
                        fieldErrors.current_password ? INPUT_BORDER_ERROR : INPUT_BORDER
                      }`}
                      disabled={isLoading || isSaving}
                      autoComplete="current-password"
                    />
                    {fieldErrors.current_password && (
                      <p className={FIELD_ERROR_CLASS}>{fieldErrors.current_password}</p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="new_password" className={LABEL_CLASS}>
                      {t('profile.newPassword', 'New password')}
                    </label>
                    <input
                      id="new_password"
                      type="password"
                      value={formValues.new_password}
                      onChange={(event) => handleChange('new_password', event.target.value)}
                      aria-invalid={Boolean(fieldErrors.new_password)}
                      className={`${INPUT_BASE} ${
                        fieldErrors.new_password ? INPUT_BORDER_ERROR : INPUT_BORDER
                      }`}
                      disabled={isLoading || isSaving}
                      autoComplete="new-password"
                    />
                    {fieldErrors.new_password && (
                      <p className={FIELD_ERROR_CLASS}>{fieldErrors.new_password}</p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="new_password_confirm" className={LABEL_CLASS}>
                      {t('profile.confirmPassword', 'Confirm new password')}
                    </label>
                    <input
                      id="new_password_confirm"
                      type="password"
                      value={formValues.new_password_confirm}
                      onChange={(event) =>
                        handleChange('new_password_confirm', event.target.value)
                      }
                      aria-invalid={Boolean(fieldErrors.new_password_confirm)}
                      className={`${INPUT_BASE} ${
                        fieldErrors.new_password_confirm ? INPUT_BORDER_ERROR : INPUT_BORDER
                      }`}
                      disabled={isLoading || isSaving}
                      autoComplete="new-password"
                    />
                    {fieldErrors.new_password_confirm && (
                      <p className={FIELD_ERROR_CLASS}>{fieldErrors.new_password_confirm}</p>
                    )}
                  </div>
                </div>
              </section>
            </FadeIn>

            {/* Submit */}
            <FadeIn delay={0.24}>
              <motion.button
                type="submit"
                disabled={!canSubmit}
                whileHover={canSubmit ? { y: -1 } : undefined}
                whileTap={canSubmit ? { y: 0, scale: 0.99 } : undefined}
                transition={{ duration: 0.15 }}
                className="btn-primary w-full !rounded-[14px] !px-6 !py-3.5 !text-[14.5px] flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSaving ? (
                  <>
                    <Spinner />
                    {t('profile.saving', 'Saving...')}
                  </>
                ) : (
                  <>
                    {t('profile.save', 'Save changes')}
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M5 12h14M13 5l7 7-7 7" />
                    </svg>
                  </>
                )}
              </motion.button>
            </FadeIn>
          </form>
        </div>
      </main>
    </RequireAuth>
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
