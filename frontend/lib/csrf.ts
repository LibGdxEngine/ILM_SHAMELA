// Shared CSRF/cookie helpers used by auth.ts and reader API helpers.
// DRF SessionAuthentication enforces CSRF on non-GET requests, so every
// write helper must include the X-CSRFToken header.

/**
 * Read a cookie value by name. Returns null when the cookie is missing
 * or when invoked outside the browser (SSR/Node).
 */
export function getCookie(name: string): string | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const cookies = document.cookie.split(';');
  for (let i = 0; i < cookies.length; i++) {
    const cookie = cookies[i].trim();
    if (cookie.substring(0, name.length + 1) === name + '=') {
      return decodeURIComponent(cookie.substring(name.length + 1));
    }
  }
  return null;
}

/**
 * Return the CSRF token from the `csrftoken` cookie or null when absent.
 */
export function getCsrfToken(): string | null {
  return getCookie('csrftoken');
}

/**
 * Build a header object to spread into fetch options. Returns an empty
 * object when no CSRF token is available so callers can unconditionally
 * spread the result.
 */
export function csrfHeaders(): Record<string, string> {
  const token = getCsrfToken();
  return token ? { 'X-CSRFToken': token } : {};
}
