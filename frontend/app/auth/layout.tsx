'use client';

import { useI18n } from '@/components/i18n/I18nProvider';

export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { t } = useI18n();

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-amber-50 via-white to-teal-50 dark:from-gray-900 dark:via-gray-800 dark:to-teal-900">
      {/* Background decorations */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-gradient-to-br from-amber-400/20 to-teal-400/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-gradient-to-br from-teal-400/20 to-amber-400/20 rounded-full blur-3xl" />
      </div>
      
      {/* Content */}
      <div className="flex-1 flex items-center justify-center p-4 relative z-10">
        {children}
      </div>
      
      {/* Footer */}
      <footer className="py-4 text-center text-sm text-gray-500 dark:text-gray-400 relative z-10">
        {t('auth.footerRights', '© {year} مكتبة علم. جميع الحقوق محفوظة.', {
          year: new Date().getFullYear(),
        })}
      </footer>
    </div>
  );
}
