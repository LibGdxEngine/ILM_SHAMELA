'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import UploadZone from '@/components/UploadZone';
import RequireAuth from '@/components/RequireAuth';
import { useLocalizedPath } from '@/lib/i18n/navigation';
import { useI18n } from '@/components/i18n/I18nProvider';

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
      <main className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="container mx-auto max-w-4xl px-4 py-8">
          <div className="mb-8">
            <h1 className="mb-2 text-3xl font-bold text-gray-900 dark:text-white">
              {t('upload.pageTitle', 'رفع الكتب والمخطوطات')}
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              {t('upload.pageSubtitle', 'ارفع ملفات PDF أو DOC أو DOCX أو TXT لإضافتها إلى مكتبتك.')}
            </p>
          </div>

          <div className="rounded-lg bg-white p-8 shadow-sm dark:bg-gray-800">
            <UploadZone onUploadSuccess={handleUploadSuccess} />
          </div>

          {uploadSuccess && (
            <div className="mt-4 rounded-lg border border-green-400 bg-green-100 p-4 text-green-700">
              <p className="font-medium">
                {t('upload.successRedirect', 'تم الرفع بنجاح. جارٍ تحويلك إلى صفحة المكتبة...')}
              </p>
            </div>
          )}
        </div>
      </main>
    </RequireAuth>
  );
}
