'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';

import RequireAuth from '@/components/RequireAuth';
import { useAuth } from '@/lib/AuthContext';
import { AuthValidationError } from '@/lib/auth';
import { useI18n } from '@/components/i18n/I18nProvider';

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

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export default function ProfilePage() {
  const { user, isLoading, updateProfile } = useAuth();
  const { t } = useI18n();

  const [formValues, setFormValues] = useState<ProfileFormValues>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<ProfileFieldErrors>(EMPTY_ERRORS);
  const [generalError, setGeneralError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);

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
  const avatarPreviewUrl = normalizedDraft.avatar && isValidUrl(normalizedDraft.avatar)
    ? normalizedDraft.avatar
    : null;

  return (
    <RequireAuth>
      <main className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="mx-auto max-w-3xl px-4 py-8">
          <header className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              {t('profile.title', 'Profile')}
            </h1>
            <p className="mt-2 text-gray-600 dark:text-gray-400">
              {t('profile.subtitle', 'Manage your account details.')}
            </p>
          </header>

          {generalError && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
              {generalError}
            </div>
          )}

          {successMessage && (
            <div className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-300">
              {successMessage}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <div className="mb-5 flex items-center gap-4 border-b border-gray-100 pb-5 dark:border-gray-700">
                <div className="h-16 w-16 overflow-hidden rounded-full border border-white/70 bg-gradient-to-br from-amber-600 to-teal-700 text-white shadow-md">
                  {avatarPreviewUrl ? (
                    <img
                      src={avatarPreviewUrl}
                      alt={t('profile.avatarAlt', 'Profile avatar')}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-lg font-semibold">
                      {avatarLabel[0]?.toUpperCase()}
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-base font-semibold text-gray-900 dark:text-white">
                    {displayName || t('profile.noName', 'No name yet')}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {normalizedDraft.email || t('profile.email', 'Email')}
                  </p>
                </div>
              </div>

              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {t('profile.accountDetails', 'Account details')}
              </h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {t('profile.accountDetailsHint', 'Update your personal information and avatar.')}
              </p>

              <div className="mt-5 grid gap-5 md:grid-cols-2">
                <div>
                  <label
                    htmlFor="first_name"
                    className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    {t('profile.firstName', 'First name')}
                  </label>
                  <input
                    id="first_name"
                    type="text"
                    value={formValues.first_name}
                    onChange={(event) => handleChange('first_name', event.target.value)}
                    aria-invalid={Boolean(fieldErrors.first_name)}
                    className={`w-full rounded-xl border bg-gray-50 px-4 py-3 text-gray-900 transition-colors duration-200 placeholder-gray-500 focus:border-amber-600 focus:ring-2 focus:ring-amber-500/30 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 ${
                      fieldErrors.first_name
                        ? 'border-red-300 dark:border-red-800'
                        : 'border-gray-200 dark:border-gray-600'
                    }`}
                    disabled={isLoading || isSaving}
                  />
                  {fieldErrors.first_name && (
                    <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                      {fieldErrors.first_name}
                    </p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="last_name"
                    className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    {t('profile.lastName', 'Last name')}
                  </label>
                  <input
                    id="last_name"
                    type="text"
                    value={formValues.last_name}
                    onChange={(event) => handleChange('last_name', event.target.value)}
                    aria-invalid={Boolean(fieldErrors.last_name)}
                    className={`w-full rounded-xl border bg-gray-50 px-4 py-3 text-gray-900 transition-colors duration-200 placeholder-gray-500 focus:border-amber-600 focus:ring-2 focus:ring-amber-500/30 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 ${
                      fieldErrors.last_name
                        ? 'border-red-300 dark:border-red-800'
                        : 'border-gray-200 dark:border-gray-600'
                    }`}
                    disabled={isLoading || isSaving}
                  />
                  {fieldErrors.last_name && (
                    <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                      {fieldErrors.last_name}
                    </p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="email"
                    className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    {t('profile.email', 'Email')}
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={formValues.email}
                    onChange={(event) => handleChange('email', event.target.value)}
                    aria-invalid={Boolean(fieldErrors.email)}
                    className={`w-full rounded-xl border bg-gray-50 px-4 py-3 text-gray-900 transition-colors duration-200 placeholder-gray-500 focus:border-amber-600 focus:ring-2 focus:ring-amber-500/30 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 ${
                      fieldErrors.email
                        ? 'border-red-300 dark:border-red-800'
                        : 'border-gray-200 dark:border-gray-600'
                    }`}
                    disabled={isLoading || isSaving}
                  />
                  {fieldErrors.email && (
                    <p className="mt-2 text-sm text-red-600 dark:text-red-400">{fieldErrors.email}</p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="avatar"
                    className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    {t('profile.avatar', 'Avatar URL')} <span className="text-gray-500">{t('profile.optional', '(optional)')}</span>
                  </label>
                  <input
                    id="avatar"
                    type="url"
                    value={formValues.avatar}
                    onChange={(event) => handleChange('avatar', event.target.value)}
                    aria-invalid={Boolean(fieldErrors.avatar)}
                    placeholder={t('profile.avatarPlaceholder', 'https://example.com/avatar.jpg')}
                    className={`w-full rounded-xl border bg-gray-50 px-4 py-3 text-gray-900 transition-colors duration-200 placeholder-gray-500 focus:border-amber-600 focus:ring-2 focus:ring-amber-500/30 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 ${
                      fieldErrors.avatar
                        ? 'border-red-300 dark:border-red-800'
                        : 'border-gray-200 dark:border-gray-600'
                    }`}
                    disabled={isLoading || isSaving}
                  />
                  {fieldErrors.avatar ? (
                    <p className="mt-2 text-sm text-red-600 dark:text-red-400">{fieldErrors.avatar}</p>
                  ) : (
                    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                      {t('profile.avatarHelp', 'Use a public image URL (http or https).')}
                    </p>
                  )}
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {t('profile.security', 'Security')}
              </h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {t('profile.securityHint', 'Leave these fields empty if you do not want to change your password.')}
              </p>

              <div className="mt-5 grid gap-5 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label
                    htmlFor="current_password"
                    className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    {t('profile.currentPassword', 'Current password')}
                  </label>
                  <input
                    id="current_password"
                    type="password"
                    value={formValues.current_password}
                    onChange={(event) => handleChange('current_password', event.target.value)}
                    aria-invalid={Boolean(fieldErrors.current_password)}
                    className={`w-full rounded-xl border bg-gray-50 px-4 py-3 text-gray-900 transition-colors duration-200 placeholder-gray-500 focus:border-amber-600 focus:ring-2 focus:ring-amber-500/30 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 ${
                      fieldErrors.current_password
                        ? 'border-red-300 dark:border-red-800'
                        : 'border-gray-200 dark:border-gray-600'
                    }`}
                    disabled={isLoading || isSaving}
                  />
                  {fieldErrors.current_password && (
                    <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                      {fieldErrors.current_password}
                    </p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="new_password"
                    className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    {t('profile.newPassword', 'New password')}
                  </label>
                  <input
                    id="new_password"
                    type="password"
                    value={formValues.new_password}
                    onChange={(event) => handleChange('new_password', event.target.value)}
                    aria-invalid={Boolean(fieldErrors.new_password)}
                    className={`w-full rounded-xl border bg-gray-50 px-4 py-3 text-gray-900 transition-colors duration-200 placeholder-gray-500 focus:border-amber-600 focus:ring-2 focus:ring-amber-500/30 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 ${
                      fieldErrors.new_password
                        ? 'border-red-300 dark:border-red-800'
                        : 'border-gray-200 dark:border-gray-600'
                    }`}
                    disabled={isLoading || isSaving}
                  />
                  {fieldErrors.new_password && (
                    <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                      {fieldErrors.new_password}
                    </p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="new_password_confirm"
                    className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    {t('profile.confirmPassword', 'Confirm new password')}
                  </label>
                  <input
                    id="new_password_confirm"
                    type="password"
                    value={formValues.new_password_confirm}
                    onChange={(event) => handleChange('new_password_confirm', event.target.value)}
                    aria-invalid={Boolean(fieldErrors.new_password_confirm)}
                    className={`w-full rounded-xl border bg-gray-50 px-4 py-3 text-gray-900 transition-colors duration-200 placeholder-gray-500 focus:border-amber-600 focus:ring-2 focus:ring-amber-500/30 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 ${
                      fieldErrors.new_password_confirm
                        ? 'border-red-300 dark:border-red-800'
                        : 'border-gray-200 dark:border-gray-600'
                    }`}
                    disabled={isLoading || isSaving}
                  />
                  {fieldErrors.new_password_confirm && (
                    <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                      {fieldErrors.new_password_confirm}
                    </p>
                  )}
                </div>
              </div>
            </section>

            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full rounded-xl bg-gradient-to-r from-amber-700 to-teal-700 px-4 py-3 font-semibold text-white shadow-lg shadow-amber-700/25 transition-all duration-200 hover:from-amber-800 hover:to-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving ? t('profile.saving', 'Saving...') : t('profile.save', 'Save changes')}
            </button>
          </form>
        </div>
      </main>
    </RequireAuth>
  );
}
