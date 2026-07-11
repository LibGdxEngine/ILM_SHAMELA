// Maps the fixed set of raw English error strings the Django/dj-rest-auth
// backend returns for the auth flows (login, register, Google login, profile
// update) onto localized dictionary entries. The backend has no i18n wired up,
// so this is where those messages get translated for display.

import { AuthApiError, AuthValidationError, type AuthError } from './auth';
import type { TranslationValues } from './i18n/types';

type TFunction = (key: string, fallback?: string, values?: TranslationValues) => string;

// Exact-match table: raw backend message -> { i18n key, English fallback }.
// The English fallback mirrors the raw backend string so the dictionary stays
// the source of truth while still degrading gracefully if a key is missing.
const EXACT_MESSAGE_MAP: Record<string, { key: string; fallback: string }> = {
  'No account found with this email address.': {
    key: 'auth.error.emailNotFound',
    fallback: 'No account found with this email address.',
  },
  'This account was created using Google login. Please use "Continue with Google" to sign in.': {
    key: 'auth.error.googleOnlyAccount',
    fallback:
      'This account was created using Google login. Please use "Continue with Google" to sign in.',
  },
  'Incorrect password. Please try again.': {
    key: 'auth.error.incorrectPassword',
    fallback: 'Incorrect password. Please try again.',
  },
  'This account has been deactivated.': {
    key: 'auth.error.accountDeactivated',
    fallback: 'This account has been deactivated.',
  },
  'An account with this email already exists. Please sign in instead.': {
    key: 'auth.error.emailTakenSignin',
    fallback: 'An account with this email already exists. Please sign in instead.',
  },
  'An account with this email already exists. Please use a different email.': {
    key: 'auth.error.emailTaken',
    fallback: 'An account with this email already exists. Please use a different email.',
  },
  'Enter a valid email address.': {
    key: 'auth.error.invalidEmail',
    fallback: 'Enter a valid email address.',
  },
  "The two password fields didn't match.": {
    key: 'auth.error.passwordMismatch',
    fallback: "The two password fields didn't match.",
  },
  'New passwords do not match.': {
    key: 'auth.error.newPasswordMismatch',
    fallback: 'New passwords do not match.',
  },
  'Current password is incorrect.': {
    key: 'auth.error.currentPasswordIncorrect',
    fallback: 'Current password is incorrect.',
  },
  'To change your password, provide current_password, new_password, and new_password_confirm.': {
    key: 'auth.error.passwordFieldsRequired',
    fallback:
      'To change your password, provide current_password, new_password, and new_password_confirm.',
  },
  'Avatar updates are not supported for this account.': {
    key: 'auth.error.avatarUnsupported',
    fallback: 'Avatar updates are not supported for this account.',
  },
  'This password is too common.': {
    key: 'auth.error.passwordTooCommon',
    fallback: 'This password is too common.',
  },
  'This password is entirely numeric.': {
    key: 'auth.error.passwordTooNumeric',
    fallback: 'This password is entirely numeric.',
  },
  'First name cannot be empty.': {
    key: 'auth.error.fieldRequired',
    fallback: 'This field cannot be empty.',
  },
  'Last name cannot be empty.': {
    key: 'auth.error.fieldRequired',
    fallback: 'This field cannot be empty.',
  },
  'Email cannot be empty.': {
    key: 'auth.error.fieldRequired',
    fallback: 'This field cannot be empty.',
  },
  'Name cannot be empty.': {
    key: 'auth.error.fieldRequired',
    fallback: 'This field cannot be empty.',
  },
};

// English defaults for the per-flow fallback keys, used when no field message
// can be surfaced (e.g. a network failure or an unrecognized error shape).
const FALLBACK_KEY_DEFAULTS: Record<string, string> = {
  'login.errorFallback': 'Sign-in failed',
  'register.errorFallback': 'Account creation failed',
  'google.errorFallback': 'Google sign-in failed',
  'profile.errorFallback': 'Failed to update profile.',
};

function fallbackText(fallbackKey: string): string {
  return FALLBACK_KEY_DEFAULTS[fallbackKey] ?? 'Something went wrong. Please try again.';
}

/**
 * Translate a single raw backend error message to a localized string. Falls
 * back to a generic localized message for anything unrecognized so raw English
 * is never shown to the user.
 */
export function translateAuthErrorMessage(
  raw: string | undefined | null,
  t: TFunction
): string {
  if (raw) {
    const exact = EXACT_MESSAGE_MAP[raw];
    if (exact) {
      return t(exact.key, exact.fallback);
    }
    // Django validator messages that embed a dynamic parameter and so can't be
    // matched exactly.
    const lower = raw.toLowerCase();
    if (lower.includes('too short')) {
      return t(
        'auth.error.passwordTooShort',
        'This password is too short. Please choose a longer one.'
      );
    }
    if (lower.includes('too similar')) {
      return t(
        'auth.error.passwordTooSimilar',
        'This password is too similar to your personal information.'
      );
    }
  }
  return t('auth.error.generic', 'Something went wrong. Please try again.');
}

// Walk the raw error body in the given field precedence order, take the first
// field that carries messages, and localize (and join) every message it holds
// so stacked validation problems are all surfaced — not just the first.
function translateFieldsWithPrecedence(
  fields: AuthError | undefined,
  precedence: string[],
  t: TFunction,
  fallbackKey: string
): string {
  if (fields) {
    for (const field of precedence) {
      const value = fields[field];
      if (field === 'detail') {
        if (typeof value === 'string' && value.trim().length > 0) {
          return translateAuthErrorMessage(value, t);
        }
        continue;
      }
      if (Array.isArray(value) && value.length > 0) {
        return value.map((entry) => translateAuthErrorMessage(entry, t)).join(' ');
      }
    }
  }
  return t(fallbackKey, fallbackText(fallbackKey));
}

/**
 * Translate an error thrown by the login/register/googleLogin API layer into a
 * single localized banner string. For an AuthApiError it surfaces every message
 * of the highest-precedence field; otherwise it returns the localized fallback.
 */
export function translateAuthError(
  error: unknown,
  t: TFunction,
  fallbackKey: string
): string {
  if (error instanceof AuthApiError) {
    return translateFieldsWithPrecedence(
      error.fields,
      [
        'detail',
        'non_field_errors',
        'email',
        'password',
        'password1',
        'password2',
        'first_name',
        'last_name',
      ],
      t,
      fallbackKey
    );
  }
  return t(fallbackKey, fallbackText(fallbackKey));
}

/**
 * Translate the general-error banner for the profile page's AuthValidationError,
 * walking the profile field precedence over the raw error body.
 */
export function translateAuthValidationError(
  error: AuthValidationError,
  t: TFunction,
  fallbackKey: string
): string {
  return translateFieldsWithPrecedence(
    error.fields,
    [
      'detail',
      'non_field_errors',
      'email',
      'first_name',
      'last_name',
      'avatar',
      'current_password',
      'new_password',
      'new_password_confirm',
      'name',
    ],
    t,
    fallbackKey
  );
}
