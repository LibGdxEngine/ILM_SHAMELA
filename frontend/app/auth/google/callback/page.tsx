'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/lib/AuthContext';
import { translateAuthError } from '@/lib/authErrorMessages';
import { useI18n } from '@/components/i18n/I18nProvider';
import { useLocalizedPath } from '@/lib/i18n/navigation';
import { isLocale, withLocale, type Locale } from '@/lib/i18n/config';

export default function GoogleCallbackPage() {
  const router = useRouter();
  const { googleLogin } = useAuth();
  const { t } = useI18n();
  const localizedPath = useLocalizedPath();

  const [error, setError] = useState('');
  const [targetLocale, setTargetLocale] = useState<Locale | null>(null);

  useEffect(() => {
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const accessToken = params.get('access_token');
    const stateParam = params.get('state');

    let localeFromState: Locale | null = null;
    if (stateParam) {
      try {
        const parsed = JSON.parse(stateParam) as { locale?: string } | string;
        const maybeLocale = typeof parsed === 'string' ? parsed : parsed?.locale;
        if (isLocale(maybeLocale)) {
          localeFromState = maybeLocale;
        }
      } catch {
        if (isLocale(stateParam)) {
          localeFromState = stateParam;
        }
      }
    }

    if (localeFromState) {
      setTargetLocale(localeFromState);
    }

    if (accessToken) {
      const successPath = localeFromState ? withLocale('/', localeFromState) : localizedPath('/');
      googleLogin(accessToken)
        .then(() => {
          router.push(successPath);
        })
        .catch((err) => {
          setError(translateAuthError(err, t, 'google.errorFallback'));
        });
      return;
    }

    const errorParam = params.get('error');
    setError(errorParam || t('google.noToken', 'لم يتم استلام رمز الدخول من Google.'));
  }, [googleLogin, localizedPath, router, t]);

  if (error) {
    return (
      <div className="w-full max-w-md mx-auto">
        <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-xl">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
            <svg className="h-8 w-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="mb-2 text-xl font-semibold text-gray-900">{t('google.authFailed', 'فشلت المصادقة')}</h2>
          <p className="mb-6 text-gray-600">{error}</p>
          <button
            onClick={() => router.push(targetLocale ? withLocale('/auth/login', targetLocale) : localizedPath('/auth/login'))}
            className="rounded-xl bg-amber-700 px-6 py-2 font-medium text-white transition-colors duration-200 hover:bg-amber-800"
          >
            {t('google.backToLogin', 'العودة لتسجيل الدخول')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-xl">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-teal-100">
          <svg className="h-8 w-8 animate-spin text-teal-700" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </div>
        <h2 className="mb-2 text-xl font-semibold text-gray-900">{t('google.completing', 'جارٍ إكمال تسجيل الدخول')}</h2>
        <p className="text-gray-600">{t('google.wait', 'يرجى الانتظار حتى نُكمل المصادقة...')}</p>
      </div>
    </div>
  );
}
