'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';
import { navTheme } from '@/lib/theme';
import { useAuth } from '@/lib/AuthContext';

export default function Navigation() {
  const pathname = usePathname();
  const { user, isLoading, logout, isAuthenticated } = useAuth();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isActive = (path: string) => pathname === path;

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Hide nav on auth pages
  if (pathname?.startsWith('/auth')) {
    return null;
  }

  const handleLogout = async () => {
    setIsDropdownOpen(false);
    await logout();
  };

  return (
    <nav className={navTheme.shell}>
      <div className={navTheme.container}>
        <div className={navTheme.row}>
          <div className={navTheme.left}>
            <Link href="/" className={navTheme.logoLink}>
              <div className={navTheme.logoIconWrap}>
                <Image
                  src="/logo.png"
                  alt="ILM Shamela Logo"
                  fill
                  className="object-contain"
                  priority
                />
              </div>
              <span className={navTheme.brandText}>
                مكتبة <span className={navTheme.brandAccent}>علم</span>
              </span>
            </Link>

            <div className={navTheme.linksWrap}>
              <Link
                href="/"
                className={`${navTheme.linkBase} ${
                  isActive('/')
                    ? navTheme.linkActive
                    : navTheme.linkInactive
                }`}
              >
                Home
              </Link>
              <Link
                href="/upload"
                className={`${navTheme.linkBase} ${
                  isActive('/upload')
                    ? navTheme.linkActive
                    : navTheme.linkInactive
                }`}
              >
                Upload
              </Link>
              <Link
                href="/documents"
                className={`${navTheme.linkBase} ${
                  isActive('/documents')
                    ? navTheme.linkActive
                    : navTheme.linkInactive
                }`}
              >
                Documents
              </Link>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            {isLoading ? (
              <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse" />
            ) : isAuthenticated && user ? (
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700/60 transition-colors duration-200"
                >
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-medium text-sm">
                    {user.first_name?.[0] || user.email[0].toUpperCase()}
                  </div>
                  <span className="hidden sm:block text-sm font-medium text-gray-700 dark:text-gray-200">
                    {user.first_name || user.email.split('@')[0]}
                  </span>
                  <svg className={`w-4 h-4 text-gray-500 transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {isDropdownOpen && (
                  <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 py-1 z-50">
                    <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        {user.first_name} {user.last_name}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                        {user.email}
                      </p>
                    </div>
                    <button
                      onClick={handleLogout}
                      className="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors duration-200 flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                      </svg>
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Link
                  href="/auth/login"
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:text-gray-900 dark:hover:text-white transition-colors duration-200"
                >
                  Sign in
                </Link>
                <Link
                  href="/auth/register"
                  className="px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white text-sm font-medium rounded-xl shadow-md shadow-indigo-500/20 transition-all duration-200"
                >
                  Get started
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}

