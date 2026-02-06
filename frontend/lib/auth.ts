// Auth API layer for dj-rest-auth backend integration

export interface User {
  pk: number;
  email: string;
  first_name: string;
  last_name: string;
  username: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password1: string;
  password2: string;
  first_name: string;
  last_name: string;
}

export interface AuthResponse {
  access: string;
  refresh: string;
  user: User;
}

export interface AuthError {
  detail?: string;
  non_field_errors?: string[];
  email?: string[];
  password?: string[];
  password1?: string[];
  password2?: string[];
  first_name?: string[];
  last_name?: string[];
}

// Get API base URL - same logic as api.ts
function getApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    return ''; // Relative URLs in browser
  }
  const envUrl = process.env.NEXT_PUBLIC_API_URL;
  return envUrl || 'http://localhost:8000';
}

const API_BASE_URL = getApiBaseUrl();

function buildUrl(path: string): string {
  if (API_BASE_URL) {
    return `${API_BASE_URL}${API_BASE_URL.endsWith('/') ? '' : '/'}${path.startsWith('/') ? path.slice(1) : path}`;
  }
  return path.startsWith('/') ? path : `/${path}`;
}

/**
 * Login with email and password
 */
export async function login(credentials: LoginRequest): Promise<User> {
  // Ensure we have a fresh CSRF token before login
  await ensureCsrfToken();

  const response = await fetch(buildUrl('/api/auth/login/'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(credentials),
  });

  if (!response.ok) {
    const error: AuthError = await response.json().catch(() => ({}));
    throw new Error(
      error.detail ||
      error.non_field_errors?.[0] ||
      error.email?.[0] ||
      error.password?.[0] ||
      'Login failed'
    );
  }

  // dj-rest-auth sets JWT cookies automatically
  // Fetch user data after login
  return getUser();
}

/**
 * Register a new user
 */
export async function register(data: RegisterRequest): Promise<User> {
  const response = await fetch(buildUrl('/api/auth/registration/'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({
      ...data,
      username: `${data.first_name}${data.last_name}`,
    }),
  });

  if (!response.ok) {
    const error: AuthError = await response.json().catch(() => ({}));
    throw new Error(
      error.detail ||
      error.non_field_errors?.[0] ||
      error.email?.[0] ||
      error.password1?.[0] ||
      error.password2?.[0] ||
      error.first_name?.[0] ||
      error.last_name?.[0] ||
      'Registration failed'
    );
  }

  // dj-rest-auth sets JWT cookies automatically
  // Fetch user data after registration
  return getUser();
}

// Helper to get cookie by name
function getCookie(name: string): string | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const cookies = document.cookie.split(';');
  for (let i = 0; i < cookies.length; i++) {
    const cookie = cookies[i].trim();
    if (cookie.substring(0, name.length + 1) === (name + '=')) {
      return decodeURIComponent(cookie.substring(name.length + 1));
    }
  }
  return null;
}

// Helper to delete cookie by name
function deleteCookie(name: string): void {
  if (typeof document === 'undefined') return;
  // Delete for multiple paths to ensure cleanup
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${window.location.hostname}`;
}

// Helper to clear all auth-related cookies
function clearAuthCookies(): void {
  deleteCookie('csrftoken');
  deleteCookie('jwt-auth');
  deleteCookie('jwt-refresh-token');
  deleteCookie('sessionid');
}

// Fetch fresh CSRF token from backend
async function ensureCsrfToken(): Promise<void> {
  // Make a GET request to trigger CSRF cookie refresh
  await fetch(buildUrl('/api/auth/user/'), {
    method: 'GET',
    credentials: 'include',
  }).catch(() => {
    // Ignore errors - we just need the CSRF cookie to be set
  });
}

/**
 * Logout the current user
 */
export async function logout(): Promise<void> {
  const csrfToken = getCookie('csrftoken');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (csrfToken) {
    headers['X-CSRFToken'] = csrfToken;
  }

  try {
    const response = await fetch(buildUrl('/api/auth/logout/'), {
      method: 'POST',
      headers: headers,
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      console.error('Logout error:', error);
    }
  } catch (error) {
    console.error('Logout request failed:', error);
  } finally {
    // Always clear auth cookies regardless of response
    // This ensures clean state even if backend has issues
    clearAuthCookies();
  }
}

/**
 * Get the current authenticated user
 */
export async function getUser(): Promise<User> {
  const response = await fetch(buildUrl('/api/auth/user/'), {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error('Not authenticated');
  }

  return response.json();
}

/**
 * Login with Google OAuth access token
 */
export async function googleLogin(accessToken: string): Promise<User> {
  const response = await fetch(buildUrl('/api/auth/google/'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ access_token: accessToken }),
  });

  if (!response.ok) {
    const error: AuthError = await response.json().catch(() => ({}));
    // Map common error scenarios to user-friendly messages
    const errorMessage = 
      error.detail ||
      error.non_field_errors?.[0] ||
      error.email?.[0] ||
      'Google login failed. Please try again.';
    throw new Error(errorMessage);
  }

  // Fetch user data after Google login
  return getUser();
}

