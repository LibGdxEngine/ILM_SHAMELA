'use client';

import { useMemo } from 'react';

import { useI18n } from '@/components/i18n/I18nProvider';
import { Document } from '@/lib/api';
import { localeToDateLocale } from '@/lib/i18n/config';
import { useReadingStats } from '@/hooks/useReadingStats';

import ReadingStatsPanel from './ReadingStatsPanel';

interface ReaderInfoContentProps {
  document: Document;
  currentPage: number;
}

/**
 * Document metadata + reading stats shown in the header's "More / Info" panel.
 * Themed with the reader design tokens (card / text / border) rather than the
 * light palette used by the legacy ReaderInfoPopover.
 */
export default function ReaderInfoContent({ document, currentPage }: ReaderInfoContentProps) {
  const { t, locale } = useI18n();
  const { stats, resetStats } = useReadingStats(document.id, currentPage);

  const uploadedDate = useMemo(
    () => new Date(document.uploaded_at).toLocaleDateString(localeToDateLocale(locale)),
    [document.uploaded_at, locale],
  );

  const authors = document.authors?.map((author) => author.name).join('، ');
  const edition = document.editions?.[0];

  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-3">
          {t('sidebar.title', 'Title')}
        </h3>
        <p className="text-[14px] font-medium leading-6 text-text">
          <bdi>{document.title}</bdi>
        </p>
      </section>

      {authors && (
        <section>
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-3">
            {t('sidebar.authors', 'Authors')}
          </h3>
          <p className="text-[13px] text-text-2">
            <bdi>{authors}</bdi>
          </p>
        </section>
      )}

      {document.categories && document.categories.length > 0 && (
        <section>
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">
            {t('sidebar.categories', 'Categories')}
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {document.categories.map((category) => {
              const key = typeof category === 'string' ? category : String(category.id);
              const name = typeof category === 'string' ? category : category.name;
              return (
                <span
                  key={key}
                  className="rounded-full border border-border bg-card-2 px-2.5 py-0.5 text-[12px] text-text-2"
                >
                  {name}
                </span>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">
          {t('sidebar.details', 'Details')}
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-border bg-card-2 p-2.5">
            <span className="block text-[10px] uppercase text-text-3">
              {t('sidebar.uploaded', 'Uploaded')}
            </span>
            <span className="text-[12.5px] font-semibold text-text">{uploadedDate}</span>
          </div>
          <div className="rounded-lg border border-border bg-card-2 p-2.5">
            <span className="block text-[10px] uppercase text-text-3">
              {t('docs.language', 'Language')}
            </span>
            <span className="text-[12.5px] font-semibold text-text">
              {document.language || t('sidebar.unknown', 'Unknown')}
            </span>
          </div>
        </div>
      </section>

      {edition && (
        <section>
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">
            {t('sidebar.edition', 'Edition')}
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {edition.editor && (
              <div className="rounded-lg border border-border bg-card-2 p-2.5">
                <span className="block text-[10px] uppercase text-text-3">
                  {t('sidebar.editionEditor', 'Editor (muhaqqiq)')}
                </span>
                <span className="text-[12.5px] font-semibold text-text">
                  <bdi>{edition.editor}</bdi>
                </span>
              </div>
            )}
            {edition.publisher && (
              <div className="rounded-lg border border-border bg-card-2 p-2.5">
                <span className="block text-[10px] uppercase text-text-3">
                  {t('sidebar.editionPublisher', 'Publisher')}
                </span>
                <span className="text-[12.5px] font-semibold text-text">
                  <bdi>{edition.publisher}</bdi>
                </span>
              </div>
            )}
            {(edition.publication_year_hijri || edition.publication_year_gregorian) && (
              <div className="rounded-lg border border-border bg-card-2 p-2.5">
                <span className="block text-[10px] uppercase text-text-3">
                  {t('sidebar.editionYear', 'Published')}
                </span>
                <span className="text-[12.5px] font-semibold text-text">
                  <bdi>
                    {[
                      edition.publication_year_hijri &&
                        t('sidebar.editionYearHijri', '{year}هـ', {
                          year: edition.publication_year_hijri,
                        }),
                      edition.publication_year_gregorian &&
                        t('sidebar.editionYearGregorian', '{year}م', {
                          year: edition.publication_year_gregorian,
                        }),
                    ]
                      .filter(Boolean)
                      .join(' / ')}
                  </bdi>
                </span>
              </div>
            )}
            {edition.volume_count != null && (
              <div className="rounded-lg border border-border bg-card-2 p-2.5">
                <span className="block text-[10px] uppercase text-text-3">
                  {t('sidebar.editionVolumes', 'Volumes')}
                </span>
                <span className="text-[12.5px] font-semibold text-text">
                  {edition.volume_count}
                </span>
              </div>
            )}
          </div>
        </section>
      )}

      {document.provenance_source && (
        <section>
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-3">
            {t('sidebar.provenance', 'Source')}
          </h3>
          <p className="text-[13px] text-text-2">
            <bdi>{document.provenance_source}</bdi>
          </p>
        </section>
      )}

      <ReadingStatsPanel stats={stats} onReset={resetStats} />
    </div>
  );
}
