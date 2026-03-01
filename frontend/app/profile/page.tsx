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
}

interface ProfileFieldErrors {
  first_name?: string;
  last_name?: string;
  email?: string;
}

const EMPTY_FORM: ProfileFormValues = {
  first_name: '',
  last_name: '',
  email: '',
};

const EMPTY_ERRORS: ProfileFieldErrors = {};

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
    });
    setFieldErrors(EMPTY_ERRORS);
    setGeneralError('');
  }, [user]);

  const normalizedCurrent = useMemo(
    () => ({
      first_name: (user?.first_name ?? '').trim(),
      last_name: (user?.last_name ?? '').trim(),
      email: (user?.email ?? '').trim().toLowerCase(),
    }),
    [user]
  );

  const normalizedDraft = useMemo(
    () => ({
      first_name: formValues.first_name.trim(),
      last_name: formValues.last_name.trim(),
      email: formValues.email.trim().toLowerCase(),
    }),
    [formValues]
  );

  const isDirty =
    normalizedCurrent.first_name !== normalizedDraft.first_name ||
    normalizedCurrent.last_name !== normalizedDraft.last_name ||
    normalizedCurrent.email !== normalizedDraft.email;

  const hasRequiredValues =
    normalizedDraft.first_name.length > 0 &&
    normalizedDraft.last_name.length > 0 &&
    normalizedDraft.email.length > 0;

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

    setFieldErrors(EMPTY_ERRORS);
    setIsSaving(true);

    try {
      await updateProfile(normalizedDraft);
      setSuccessMessage(t('profile.saved', 'Profile updated successfully.'));
    } catch (error) {
      if (error instanceof AuthValidationError) {
        setFieldErrors(error.fieldErrors);
        setGeneralError(error.message);
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

  return (
    <RequireAuth>
      <main className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="mx-auto max-w-2xl px-4 py-8">
          <header className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              {t('profile.title', 'Profile')}
            </h1>
            <p className="mt-2 text-gray-600 dark:text-gray-400">
              {t('profile.subtitle', 'Manage your account details.')}
            </p>
          </header>

          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="mb-6 flex items-center gap-4 border-b border-gray-100 pb-6 dark:border-gray-700">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-lg font-semibold text-white">
                {avatarLabel[0]?.toUpperCase()}
              </div>
              <div>
                <p className="text-base font-semibold text-gray-900 dark:text-white">
                  {displayName || t('profile.noName', 'No name yet')}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">{normalizedDraft.email}</p>
              </div>
            </div>

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
              <div>
                <label htmlFor="first_name" className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('profile.firstName', 'First name')}
                </label>
                <input
                  id="first_name"
                  type="text"
                  value={formValues.first_name}
                  onChange={(event) => handleChange('first_name', event.target.value)}
                  className={`w-full rounded-xl border bg-gray-50 px-4 py-3 text-gray-900 transition-colors duration-200 placeholder-gray-500 focus:border-amber-600 focus:ring-2 focus:ring-amber-500/30 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 ${
                    fieldErrors.first_name
                      ? 'border-red-300 dark:border-red-800'
                      : 'border-gray-200 dark:border-gray-600'
                  }`}
                  disabled={isLoading || isSaving}
                />
                {fieldErrors.first_name && (
                  <p className="mt-2 text-sm text-red-600 dark:text-red-400">{fieldErrors.first_name}</p>
                )}
              </div>

              <div>
                <label htmlFor="last_name" className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('profile.lastName', 'Last name')}
                </label>
                <input
                  id="last_name"
                  type="text"
                  value={formValues.last_name}
                  onChange={(event) => handleChange('last_name', event.target.value)}
                  className={`w-full rounded-xl border bg-gray-50 px-4 py-3 text-gray-900 transition-colors duration-200 placeholder-gray-500 focus:border-amber-600 focus:ring-2 focus:ring-amber-500/30 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 ${
                    fieldErrors.last_name
                      ? 'border-red-300 dark:border-red-800'
                      : 'border-gray-200 dark:border-gray-600'
                  }`}
                  disabled={isLoading || isSaving}
                />
                {fieldErrors.last_name && (
                  <p className="mt-2 text-sm text-red-600 dark:text-red-400">{fieldErrors.last_name}</p>
                )}
              </div>

              <div>
                <label htmlFor="email" className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('profile.email', 'Email')}
                </label>
                <input
                  id="email"
                  type="email"
                  value={formValues.email}
                  onChange={(event) => handleChange('email', event.target.value)}
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

              <button
                type="submit"
                disabled={!isDirty || !hasRequiredValues || isLoading || isSaving}
                className="w-full rounded-xl bg-gradient-to-r from-amber-700 to-teal-700 px-4 py-3 font-semibold text-white shadow-lg shadow-amber-700/25 transition-all duration-200 hover:from-amber-800 hover:to-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSaving ? t('profile.saving', 'Saving...') : t('profile.save', 'Save changes')}
              </button>
            </form>
          </section>
        </div>
      </main>
    </RequireAuth>
  );
}
