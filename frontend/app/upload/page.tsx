'use client';

import { useRouter } from 'next/navigation';
import { ReactNode, useState } from 'react';
import { motion } from 'framer-motion';

import UploadZone from '@/components/UploadZone';
import RequireAuth from '@/components/RequireAuth';
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
    <RequireAuth requireUpload>
      <main className="landing-shell min-h-screen">
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
