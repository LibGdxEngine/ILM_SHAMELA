'use client';

export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-indigo-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-indigo-900">
      {/* Background decorations */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-gradient-to-br from-indigo-400/20 to-purple-400/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-gradient-to-br from-pink-400/20 to-indigo-400/20 rounded-full blur-3xl" />
      </div>
      
      {/* Content */}
      <div className="flex-1 flex items-center justify-center p-4 relative z-10">
        {children}
      </div>
      
      {/* Footer */}
      <footer className="py-4 text-center text-sm text-gray-500 dark:text-gray-400 relative z-10">
        © 2026 مكتبة علم. All rights reserved.
      </footer>
    </div>
  );
}
