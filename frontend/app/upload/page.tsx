'use client';

import { useRouter } from 'next/navigation';
import { ReactNode, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';

import UploadZone from '@/components/UploadZone';
import RequireAuth from '@/components/RequireAuth';
import LanguageSwitcher from '@/components/i18n/LanguageSwitcher';
import { useLocalizedPath } from '@/lib/i18n/navigation';
import { useI18n } from '@/components/i18n/I18nProvider';

function FadeIn({
  children,
  delay = 0,
  className = '',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1], delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export default function UploadPage() {
  const router = useRouter();
  const localizedPath = useLocalizedPath();
  const { t } = useI18n();
  const [uploadSuccess, setUploadSuccess] = useState(false);

  const handleUploadSuccess = () => {
    setUploadSuccess(true);
    setTimeout(() => {
      router.push(localizedPath('/documents'));
    }, 2000);
  };

  return (
    <RequireAuth>
      <main className="landing-shell min-h-screen">
        {/* Top bar — brand mark + back to home */}
        <div className="px-6 sm:px-10 lg:px-16 pt-8 flex items-center justify-between relative z-10">
          <Link href={localizedPath('/')} className="flex items-center gap-2">
            <span className="font-fraunces text-[24px] text-accent-2 leading-none">ع</span>
            <span className="font-fraunces text-[18px] tracking-tight">
              ILM <em className="italic text-text-2">Shamela</em>
            </span>
          </Link>
          <div className="flex items-center gap-5 sm:gap-7">
            <Link
              href={localizedPath('/documents')}
              className="hidden sm:flex items-center gap-2 text-[13px] text-text-3 hover:text-text-2 transition-colors"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
              </svg>
              {t('upload.openLibrary', 'Open Library')}
            </Link>
            <Link
              href={localizedPath('/')}
              className="flex items-center gap-2 text-[13px] text-text-3 hover:text-text-2 transition-colors"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <path d="m15 18-6-6 6-6" />
              </svg>
              {t('login.backHome', 'Back to home')}
            </Link>
            <LanguageSwitcher />
          </div>
        </div>

        <div className="mx-auto max-w-3xl px-6 sm:px-10 lg:px-16 py-14 relative z-10">
          {/* Header */}
          <header className="mb-10">
            <FadeIn>
              <span className="section-eyebrow">{t('upload.eyebrow', 'Upload')}</span>
            </FadeIn>
            <FadeIn delay={0.05}>
              <h1 className="font-fraunces font-light text-[clamp(36px,5vw,56px)] leading-[1.05] tracking-tight mt-5 text-text">
                {t('upload.pageTitle', 'رفع الكتب والمخطوطات')}
              </h1>
            </FadeIn>
            <FadeIn delay={0.1}>
              <p className="mt-4 text-[16px] leading-relaxed text-text-2 max-w-xl">
                {t(
                  'upload.pageSubtitle',
                  'ارفع ملفات PDF أو DOC أو DOCX أو TXT لإضافتها إلى مكتبتك.'
                )}
              </p>
            </FadeIn>
          </header>

          {uploadSuccess && (
            <FadeIn className="mb-5">
              <div
                role="status"
                className="rounded-[12px] px-4 py-3 text-[13px] bg-accent-soft border border-accent/40 text-accent-2"
              >
                {t('upload.successRedirect', 'تم الرفع بنجاح. جارٍ تحويلك إلى صفحة المكتبة...')}
              </div>
            </FadeIn>
          )}

          <FadeIn delay={0.15}>
            <UploadZone onUploadSuccess={handleUploadSuccess} />
          </FadeIn>
        </div>
      </main>
    </RequireAuth>
  );
}
