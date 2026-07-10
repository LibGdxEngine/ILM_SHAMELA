'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '@/components/i18n/I18nProvider';

interface ReportErrorModalProps {
  selectedText: string;
  /** Persist the report; resolve on success, reject to surface an error. */
  onSubmit: (description: string, suggestedCorrection: string) => Promise<void>;
  onClose: () => void;
}

export default function ReportErrorModal({ selectedText, onSubmit, onClose }: ReportErrorModalProps) {
  const { t } = useI18n();
  const [description, setDescription] = useState('');
  const [correction, setCorrection] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const canSubmit = description.trim().length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!description.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(description.trim(), correction.trim());
      setDone(true);
      window.setTimeout(onClose, 1100);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('reader.report.error', 'تعذّر إرسال البلاغ'));
    } finally {
      setSubmitting(false);
    }
  };

  const modal = (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onMouseDown={submitting ? undefined : onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('reader.report.title', 'الإبلاغ عن خطأ')}
        className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 font-reem-kufi text-[16px] font-medium text-text">
          {t('reader.report.title', 'الإبلاغ عن خطأ')}
        </h2>

        {done ? (
          <p className="py-6 text-center text-[13.5px] text-text-2">
            {t('reader.report.thanks', 'شكرًا لك، تم إرسال البلاغ.')}
          </p>
        ) : (
          <>
            <blockquote className="mb-4 max-h-24 overflow-y-auto rounded-lg border-s-2 border-accent/40 bg-black/[0.03] px-3 py-2 text-[12.5px] leading-relaxed text-text-2">
              <bdi>{selectedText}</bdi>
            </blockquote>

            <label className="mb-1 block text-[12px] text-text-2">
              {t('reader.report.descLabel', 'ما المشكلة في هذا النص؟')}
            </label>
            <textarea
              autoFocus
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder={t('reader.report.descPlaceholder', 'صف الخطأ…')}
              className="w-full resize-y rounded-lg border border-border bg-card-2 px-3 py-2 text-[13.5px] text-text placeholder:text-text-3 focus:border-accent/50 focus:outline-none"
            />

            <label className="mb-1 mt-3 block text-[12px] text-text-2">
              {t('reader.report.correctionLabel', 'التصحيح المقترح (اختياري)')}
            </label>
            <textarea
              value={correction}
              onChange={(e) => setCorrection(e.target.value)}
              rows={2}
              placeholder={t('reader.report.correctionPlaceholder', 'النص الصحيح…')}
              className="w-full resize-y rounded-lg border border-border bg-card-2 px-3 py-2 text-[13.5px] text-text placeholder:text-text-3 focus:border-accent/50 focus:outline-none"
            />

            {error && <p className="mt-3 text-[12.5px] text-red-600">{error}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="rounded-full px-4 py-2 text-[13px] text-text-2 transition-colors hover:bg-white/[0.06] disabled:opacity-50"
              >
                {t('common.cancel', 'إلغاء')}
              </button>
              <button
                type="button"
                disabled={!canSubmit}
                onClick={handleSubmit}
                className="rounded-full bg-accent px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? t('reader.report.sending', 'جارٍ الإرسال…') : t('reader.report.submit', 'إرسال البلاغ')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(modal, document.body);
}
