'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';

import { getDocumentsByCountry, Document } from '@/lib/api';
import { useI18n } from '@/components/i18n/I18nProvider';
import { regionColor, regionDisplayName } from '@/lib/atlasRegions';
import { toLocaleDigits } from '@/lib/utils';
import type { CountryInfo } from '@/app/map/page';

interface AtlasRailProps {
  selectedCountry: string | null;
  countryMap: Record<string, CountryInfo>;
  onSelectRegion: (country: string) => void;
}

/** Always-visible right rail for the Atlas: AI summary, region list, author cards. */
export default function AtlasRail({ selectedCountry, countryMap, onSelectRegion }: AtlasRailProps) {
  const { t, locale } = useI18n();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const regions = useMemo(
    () => Object.values(countryMap).sort((a, b) => b.documentCount - a.documentCount),
    [countryMap],
  );
  const totalWorks = useMemo(
    () => regions.reduce((sum, r) => sum + r.documentCount, 0),
    [regions],
  );

  useEffect(() => {
    if (!selectedCountry) {
      setDocuments([]);
      return;
    }
    let mounted = true;
    setIsLoading(true);
    getDocumentsByCountry(selectedCountry)
      .then((res) => {
        if (mounted) setDocuments(res.results);
      })
      .catch((err) => console.error('Failed to load works by country:', err))
      .finally(() => {
        if (mounted) setIsLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [selectedCountry]);

  const num = (n: number) => toLocaleDigits(n, locale);
  const selectedData = selectedCountry ? countryMap[selectedCountry] : null;
  const selectedLabel = selectedData ? regionDisplayName(selectedData.countryName, locale) : '';

  return (
    <aside className="flex w-full flex-col gap-5 p-[22px] lg:w-[432px] lg:flex-shrink-0">
      {/* AI summary card */}
      <div className="atlas-summary p-[18px]">
        <div className="mb-[11px] flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="#9DB6E6" aria-hidden>
            <path d="M12 2 L13.7 9 L21 11 L13.7 13 L12 22 L10.3 13 L3 11 L10.3 9 Z" />
          </svg>
          <span className="text-[12px]" style={{ color: '#AEC2E8' }}>
            {t('map.atlas.understood', 'فهم سؤالك')}
          </span>
        </div>
        {selectedData ? (
          <>
            <div className="text-[15px] leading-[1.8]">
              {t('map.atlas.summarySelected', 'عثرتُ على {count} عملًا من {region}.', {
                count: num(selectedData.documentCount),
                region: selectedLabel,
              })}
            </div>
            <div className="mt-[13px] flex flex-wrap gap-2">
              <span className="rounded-[8px] px-[11px] py-[5px] text-[12px]" style={{ background: 'rgba(255,255,255,.14)' }}>
                {t('map.atlas.regionChip', 'الإقليم: {region}', { region: selectedLabel })}
              </span>
            </div>
          </>
        ) : (
          <div className="text-[15px] leading-[1.8]">
            {t('map.atlas.summaryDefault', 'تصفّح المؤلفين حسب موطنهم عبر {regions} إقليمًا — {total} عملًا في المكتبة.', {
              regions: num(regions.length),
              total: num(totalWorks),
            })}
          </div>
        )}
      </div>

      {/* Region list */}
      <div>
        <div className="mb-3 text-[13px] font-semibold" style={{ color: 'var(--at-ink-2)' }}>
          {t('map.atlas.regions', 'الأقاليم')}
        </div>
        <div className="flex flex-col gap-[3px] text-[13.5px]">
          {regions.length === 0 && (
            <div className="px-[11px] py-2 text-[12.5px]" style={{ color: 'var(--at-ink-4)' }}>
              {t('map.atlas.noRegions', 'لا توجد بيانات إقليمية بعد.')}
            </div>
          )}
          {regions.map((r, i) => {
            const active = r.countryName === selectedCountry;
            return (
              <button
                key={r.countryName}
                type="button"
                onClick={() => onSelectRegion(r.countryName)}
                aria-pressed={active}
                className="atlas-region"
              >
                <span
                  className="h-[9px] w-[9px] flex-shrink-0 rounded-full"
                  style={{ background: active ? 'var(--at-gold)' : regionColor(i) }}
                />
                <span className="flex-1 truncate text-start" style={active ? { fontWeight: 600 } : undefined}>
                  {regionDisplayName(r.countryName, locale)}
                </span>
                <span className="atlas-region-count text-[12px]" style={{ color: active ? undefined : 'var(--at-ink-4)' }}>
                  {num(r.documentCount)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Author / work result cards */}
      <div>
        <div className="mb-3 text-[13px] font-semibold" style={{ color: 'var(--at-ink-2)' }}>
          {selectedData
            ? t('map.atlas.authorsOf', 'أعمال {region}', { region: selectedLabel })
            : t('map.atlas.pickRegion', 'اختر إقليمًا لعرض أعماله')}
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center gap-3 py-8" style={{ color: 'var(--at-ink-3)' }}>
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--at-brand)] border-t-transparent" />
            <p className="text-[13px]">{t('map.atlas.loading', 'جارٍ التحميل…')}</p>
          </div>
        ) : !selectedData ? (
          <div className="rounded-[13px] border border-dashed px-4 py-8 text-center text-[13px]" style={{ borderColor: 'var(--at-line)', color: 'var(--at-ink-3)' }}>
            {t('map.atlas.emptyHint', 'انقر على إقليم في الخريطة أو القائمة لاستكشاف مؤلفيه.')}
          </div>
        ) : documents.length === 0 ? (
          <div className="py-8 text-center text-[13px]" style={{ color: 'var(--at-ink-3)' }}>
            {t('map.atlas.noWorks', 'لا توجد أعمال من هذا الإقليم بعد.')}
          </div>
        ) : (
          <AnimatePresence>
            <div className="flex flex-col gap-[11px]">
              {documents.map((doc, idx) => {
                const authorNames = doc.authors.map((a) => a.name).join('، ') || t('map.atlas.unknownAuthor', 'مؤلف غير معروف');
                const initial = (authorNames.trim()[0] || '؟').toUpperCase();
                const meta = [selectedLabel, doc.written_date].filter(Boolean).join(' · ');
                const cats = (doc.categories ?? []).slice(0, 2).map((c) => c.name);
                return (
                  <motion.div
                    key={doc.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05, duration: 0.28, ease: 'easeOut' }}
                    className="atlas-author"
                  >
                    <span className="atlas-author-avatar" aria-hidden>{initial}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[14.5px] font-semibold" dir="auto">{authorNames}</div>
                      {meta && (
                        <div className="mt-0.5 text-[11.5px]" style={{ color: 'var(--at-ink-3)' }} dir="auto">
                          {meta}
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className="atlas-work-chip" dir="auto">{doc.title}</span>
                        {cats.map((c) => (
                          <span key={c} className="atlas-work-chip" dir="auto">{c}</span>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </AnimatePresence>
        )}
      </div>
    </aside>
  );
}
