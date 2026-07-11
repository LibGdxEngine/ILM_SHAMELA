'use client';

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import {
  User,
  login as apiLogin,
  register as apiRegister,
  logout as apiLogout,
  getUser,
  googleLogin as apiGoogleLogin,
  refreshAccessToken,
  updateUserProfile as apiUpdateUserProfile,
  LoginRequest,
  RegisterRequest,
  UserProfileUpdateRequest,
} from './auth';
import { migrateAllReaderLocalStorage } from './reader/migrate';

// Comfortably under the 60-minute access-token TTL (SIMPLE_JWT.ACCESS_TOKEN_LIFETIME),
// tolerant of a missed cycle from background-tab timer throttling.
const REFRESH_INTERVAL_MS = 20 * 60 * 1000;

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (credentials: LoginRequest) => Promise<void>;
  register: (data: RegisterRequest) => Promise<void>;
  logout: () => Promise<void>;
  googleLogin: (accessToken: string) => Promise<void>;
  updateProfile: (data: UserProfileUpdateRequest) => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // StrictMode mounts effects twice in dev; this ref ensures the
  // localStorage sweep runs only once per signed-in session.
  const migrationStartedRef = useRef(false);

  const refreshUser = useCallback(async () => {
    try {
      const userData = await getUser();
      setUser(userData);
    } catch {
      setUser(null);
    }
  }, []);

  // Check auth status on mount. The access-token cookie may have expired while
  // the tab was closed (its 60-minute TTL is well under the 1-day refresh-token
  // TTL), so try one silent refresh before treating the user as signed out.
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const userData = await getUser();
        setUser(userData);
      } catch {
        const refreshed = await refreshAccessToken().catch(() => false);
        if (refreshed) {
          try {
            const userData = await getUser();
            setUser(userData);
          } catch {
            setUser(null);
          }
        } else {
          setUser(null);
        }
      } finally {
        setIsLoading(false);
      }
    };
    checkAuth();
  }, []);

  // While signed in, proactively refresh the access-token cookie so long-lived
  // sessions don't silently expire: a periodic timer, plus an immediate refresh
  // when the tab regains visibility (covers the timer being throttled while
  // backgrounded). A clean refresh failure means the refresh token itself is
  // gone/expired, so sign the user out; a thrown error (network blip) is left
  // for the next cycle to retry.
  useEffect(() => {
    if (!user) return;

    const attemptRefresh = async () => {
      try {
        const ok = await refreshAccessToken();
        if (!ok) setUser(null);
      } catch {
        // transient network error - don't sign the user out over this
      }
    };

    const interval = setInterval(attemptRefresh, REFRESH_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void attemptRefresh();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [user]);

  // Once authenticated, push any legacy reader localStorage data to the API.
  // Best-effort: the helper itself swallows errors and sets a flag to prevent
  // re-running on subsequent renders or page loads.
  useEffect(() => {
    if (!user || migrationStartedRef.current) return;
    migrationStartedRef.current = true;
    void migrateAllReaderLocalStorage();
  }, [user]);

  const login = useCallback(async (credentials: LoginRequest) => {
    setIsLoading(true);
    try {
      const userData = await apiLogin(credentials);
      setUser(userData);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const register = useCallback(async (data: RegisterRequest) => {
    setIsLoading(true);
    try {
      const userData = await apiRegister(data);
      setUser(userData);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setIsLoading(true);
    try {
      await apiLogout();
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const googleLogin = useCallback(async (accessToken: string) => {
    setIsLoading(true);
    try {
      const userData = await apiGoogleLogin(accessToken);
      setUser(userData);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const updateProfile = useCallback(async (data: UserProfileUpdateRequest) => {
    const userData = await apiUpdateUserProfile(data);
    setUser(userData);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        register,
        logout,
        googleLogin,
        updateProfile,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
