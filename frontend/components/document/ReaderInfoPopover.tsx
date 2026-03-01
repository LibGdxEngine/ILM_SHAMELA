import { useEffect, useMemo, useRef } from 'react';
import { Document } from '@/lib/api';
import { useI18n } from '@/components/i18n/I18nProvider';
import { localeToDateLocale } from '@/lib/i18n/config';
import { useReadingStats } from '@/hooks/useReadingStats';
import ReadingStatsPanel from './ReadingStatsPanel';

interface ReaderInfoPopoverProps {
  readerDocument: Document;
  currentPage: number;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}

export default function ReaderInfoPopover({
  readerDocument,
  currentPage,
  isOpen,
  onToggle,
  onClose,
}: ReaderInfoPopoverProps) {
  const { t, locale, direction } = useI18n();
  const { stats, resetStats } = useReadingStats(readerDocument.id, currentPage);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    window.document.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  const uploadedDate = useMemo(
    () => new Date(readerDocument.uploaded_at).toLocaleDateString(localeToDateLocale(locale)),
    [readerDocument.uploaded_at, locale]
  );

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls="reader-info-popover"
        className={`rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
          isOpen
            ? 'border-teal-300 bg-teal-50 text-teal-800'
            : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-800'
        }`}
      >
        <span className="inline-flex items-center gap-1.5">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {t('reader.info', 'Info')}
        </span>
      </button>

      {isOpen && (
        <div
          id="reader-info-popover"
          className={`absolute top-full z-40 mt-2 w-[22rem] rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl ${
            direction === 'rtl' ? 'left-0' : 'right-0'
          }`}
          role="dialog"
          aria-label={t('reader.info', 'Info')}
        >
          <div className="mb-4 space-y-3">
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                {t('sidebar.title', 'Title')}
              </h3>
              <p className="text-sm font-medium leading-6 text-gray-900">{readerDocument.title}</p>
            </section>

            {readerDocument.authors && readerDocument.authors.length > 0 && (
              <section>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {t('sidebar.authors', 'Authors')}
                </h3>
                <p className="text-sm text-gray-700">{readerDocument.authors.map((author) => author.name).join(', ')}</p>
              </section>
            )}

            {readerDocument.categories && readerDocument.categories.length > 0 && (
              <section>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {t('sidebar.categories', 'Categories')}
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {readerDocument.categories.map((category) => {
                    const key = typeof category === 'string' ? category : String(category.id);
                    const name = typeof category === 'string' ? category : category.name;
                    return (
                      <span key={key} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                        {name}
                      </span>
                    );
                  })}
                </div>
              </section>
            )}

            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                {t('sidebar.details', 'Details')}
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-2">
                  <span className="block text-[10px] uppercase text-gray-500">
                    {t('sidebar.uploaded', 'Uploaded')}
                  </span>
                  <span className="text-xs font-semibold text-gray-800">{uploadedDate}</span>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-2">
                  <span className="block text-[10px] uppercase text-gray-500">
                    {t('docs.language', 'Language')}
                  </span>
                  <span className="text-xs font-semibold text-gray-800">
                    {readerDocument.language || t('sidebar.unknown', 'Unknown')}
                  </span>
                </div>
              </div>
            </section>
          </div>

          <ReadingStatsPanel stats={stats} onReset={resetStats} />
        </div>
      )}
    </div>
  );
}
