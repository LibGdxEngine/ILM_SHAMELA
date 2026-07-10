'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { getDocumentsSearch, type Document } from '@/lib/api';
import { useI18n } from '@/components/i18n/I18nProvider';
import { useLocalizedPath } from '@/lib/i18n/navigation';

interface SimilarWordsModalProps {
  /** The selected text to look up across the corpus. */
  query: string;
  /** The book currently open — excluded from results ("other books"). */
  currentDocumentId: number;
  onClose: () => void;
}

/** Strip ES highlight tags so snippets render as plain text. */
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

export default function SimilarWordsModal({ query, currentDocumentId, onClose }: SimilarWordsModalProps) {
  const { t } = useI18n();
  const localizedPath = useLocalizedPath();
  const [results, setResults] = useState<Document[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Cap the query length — selections can be long; the corpus search is
    // keyword-driven so the first sentence is more than enough.
    const q = query.trim().slice(0, 200);
    setResults(null);
    setError(null);
    getDocumentsSearch({ q })
      .then((res) => {
        if (cancelled) return;
        setResults(res.results.filter((d) => d.id !== currentDocumentId));
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t('reader.similar.error', 'تعذّر البحث'));
      });
    return () => {
      cancelled = true;
    };
  }, [query, currentDocumentId, t]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const modal = (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm sm:p-8"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('reader.similar.title', 'كلمات مشابهة في كتب أخرى')}
        className="mt-8 w-full max-w-lg rounded-2xl border border-border bg-card p-5 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-start justify-between gap-3">
          <h2 className="font-reem-kufi text-[16px] font-medium text-text">
            {t('reader.similar.title', 'كلمات مشابهة في كتب أخرى')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('reader.closePanel', 'إغلاق')}
            className="rounded-full p-1 text-text-3 hover:bg-white/[0.06] hover:text-text"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="mb-4 truncate text-[12.5px] text-text-3">
          <bdi>{query.trim().slice(0, 120)}</bdi>
        </p>

        {error && <p className="py-8 text-center text-[13px] text-red-600">{error}</p>}

        {!error && results === null && (
          <p className="py-10 text-center text-[13px] text-text-2" role="status" aria-live="polite">
            {t('reader.similar.loading', 'جارٍ البحث…')}
          </p>
        )}

        {!error && results !== null && results.length === 0 && (
          <p className="py-10 text-center text-[13px] text-text-2">
            {t('reader.similar.empty', 'لم يتم العثور على نتائج في كتب أخرى')}
          </p>
        )}

        {!error && results !== null && results.length > 0 && (
          <ul className="max-h-[60vh] space-y-2 overflow-y-auto">
            {results.map((doc) => (
              <li key={doc.id}>
                <Link
                  href={localizedPath(`/documents/${doc.id}`)}
                  className="block rounded-xl border border-border bg-card-2 px-3.5 py-3 transition-colors hover:border-accent/30 hover:bg-white/[0.04]"
                >
                  <div className="text-[14px] font-medium text-text">
                    <bdi>{doc.title}</bdi>
                  </div>
                  {doc.authors.length > 0 && (
                    <div className="mt-0.5 text-[12px] text-text-3">
                      <bdi>{doc.authors.map((a) => a.name).join('، ')}</bdi>
                    </div>
                  )}
                  {doc.snippet && (
                    <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-text-2">
                      <bdi>{stripTags(doc.snippet)}</bdi>
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(modal, document.body);
}
