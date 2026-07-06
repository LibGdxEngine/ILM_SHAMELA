'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';

import InteractiveWorldMap from '@/components/InteractiveWorldMap';
import AtlasRail from '@/components/AtlasRail';
import ShellHeader from '@/components/ShellHeader';
import NavSearchPopover, { SelectedBook } from '@/components/search/NavSearchPopover';
import { getCountryDocumentStats, CountryDocumentStat } from '@/lib/api';
import type { CorpusSearchMode } from '@/lib/api';
import { buildDocumentsSearchParams } from '@/lib/documentsSearchParams';
import { useAuth } from '@/lib/AuthContext';
import { useI18n } from '@/components/i18n/I18nProvider';
import { useLocalizedPath } from '@/lib/i18n/navigation';
import { regionSearchTerms } from '@/lib/atlasRegions';

export interface CountryInfo {
    countryName: string;
    flag: string;
    documentCount: number;
}

export default function MapPage() {
    const { t } = useI18n();
    const router = useRouter();
    const localizedPath = useLocalizedPath();
    const { isAuthenticated } = useAuth();

    const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
    const [countryMap, setCountryMap] = useState<Record<string, CountryInfo>>({});
    const [, setIsLoading] = useState(true);
    const [queryValue, setQueryValue] = useState('');
    const [searchMode, setSearchMode] = useState<CorpusSearchMode>('hybrid');
    const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
    const [selectedAuthors, setSelectedAuthors] = useState<string[]>([]);
    const [selectedBooks, setSelectedBooks] = useState<SelectedBook[]>([]);
    const [popoverOpen, setPopoverOpen] = useState(false);
    const searchTriggerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        getCountryDocumentStats()
            .then((stats: CountryDocumentStat[]) => {
                const map: Record<string, CountryInfo> = {};
                for (const s of stats) {
                    map[s.country] = {
                        countryName: s.country,
                        flag: '',
                        documentCount: s.document_count,
                    };
                }
                setCountryMap(map);
            })
            .catch((err) => console.error('Failed to load country stats:', err))
            .finally(() => setIsLoading(false));
    }, []);

    const regions = useMemo(() => Object.values(countryMap), [countryMap]);

    // Navigate to the catalog with the current query + popup filters applied,
    // serialized identically to every other surface that links into /documents.
    const goToDocuments = () => {
        const params = buildDocumentsSearchParams({
            q: queryValue,
            mode: searchMode,
            documents: selectedBooks.map((b) => b.id),
            authors: selectedAuthors,
            categories: selectedCategories,
        });
        router.push(localizedPath(`/documents?${params.toString()}`));
    };

    // "Smart search": when no popup filter is engaged, match a typed region
    // (Arabic historical or English name) and select it on the map; otherwise fall
    // back to the library catalog. When any popup filter *is* engaged, skip the
    // region match entirely and jump straight to the filtered catalog.
    const onSearch = () => {
        const q = queryValue.trim();
        if (!q) return;

        const hasPopupFilter =
            searchMode !== 'hybrid' ||
            selectedCategories.length > 0 ||
            selectedAuthors.length > 0 ||
            selectedBooks.length > 0;
        if (hasPopupFilter) {
            goToDocuments();
            return;
        }

        const lower = q.toLowerCase();
        const match =
            regions.find((c) =>
                regionSearchTerms(c.countryName).some(
                    (n) => n === q || n.toLowerCase() === lower,
                ),
            ) ??
            regions.find(
                (c) =>
                    regionSearchTerms(c.countryName).some((n) => n.includes(q)) ||
                    c.countryName.toLowerCase().includes(lower),
            );
        if (match) {
            setSelectedCountry(match.countryName);
            return;
        }
        goToDocuments();
    };

    const searchEl = (
        <div className="relative w-full" ref={searchTriggerRef}>
            <form
                className="flex w-full items-center gap-[11px] rounded-[12px] border-[1.5px] px-4 py-[11px]"
                style={{
                    background: 'var(--at-surface)',
                    borderColor: 'var(--at-brand)',
                    boxShadow: '0 4px 16px rgba(44,76,130,.10)',
                }}
                onSubmit={(e) => {
                    e.preventDefault();
                    onSearch();
                }}
            >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#2c4c82" aria-hidden>
                    <path d="M12 2 L13.7 9 L21 11 L13.7 13 L12 22 L10.3 13 L3 11 L10.3 9 Z" />
                </svg>
                <input
                    type="text"
                    value={queryValue}
                    onChange={(e) => setQueryValue(e.target.value)}
                    onFocus={() => setPopoverOpen(true)}
                    placeholder={t('map.atlas.searchPlaceholder', 'أرني علماء الأندلس في القرن الخامس الهجري')}
                    className="min-w-0 flex-1 bg-transparent text-[14.5px] outline-none"
                    style={{ color: '#3a342b' }}
                    aria-label={t('map.atlas.searchLabel', 'بحث ذكي في الأطلس')}
                />
                <span
                    className="rounded-[6px] px-[9px] py-[3px] text-[11px] font-semibold"
                    style={{ background: '#e7ecf6', color: '#2c4c82' }}
                >
                    {t('map.atlas.smartSearch', 'بحث ذكي')}
                </span>
            </form>

            <NavSearchPopover
                open={popoverOpen}
                onOpenChange={setPopoverOpen}
                anchorRef={searchTriggerRef}
                showQueryField={false}
                queryValue={queryValue}
                onQueryChange={setQueryValue}
                onSubmit={onSearch}
                mode={searchMode}
                onModeChange={setSearchMode}
                selectedCategories={selectedCategories}
                onToggleCategory={(name) =>
                    setSelectedCategories((prev) =>
                        prev.includes(name) ? prev.filter((c) => c !== name) : [...prev, name],
                    )
                }
                selectedAuthors={selectedAuthors}
                onToggleAuthor={(name) =>
                    setSelectedAuthors((prev) =>
                        prev.includes(name) ? prev.filter((a) => a !== name) : [...prev, name],
                    )
                }
                selectedBooks={selectedBooks}
                onToggleBook={(book) =>
                    setSelectedBooks((prev) =>
                        prev.some((b) => b.id === book.id)
                            ? prev.filter((b) => b.id !== book.id)
                            : [...prev, book],
                    )
                }
                isAuthenticated={isAuthenticated}
            />
        </div>
    );

    return (
        <main className="atlas min-h-screen">
            <ShellHeader search={searchEl} languages={['ar', 'en', 'fa']} />

            {/* Mode tabs */}
            <div
                className="flex items-center gap-1.5 px-6 py-[11px]"
                style={{ borderBottom: '1px solid var(--at-line-2)' }}
                dir="rtl"
            >
                <button type="button" className="atlas-tab" onClick={() => router.push(localizedPath('/documents'))}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                        <rect x="3" y="4" width="6" height="16" rx="1" />
                        <rect x="10" y="4" width="5" height="16" rx="1" />
                        <rect x="16" y="4" width="5" height="16" rx="1" />
                    </svg>
                    {t('map.atlas.tabShelves', 'الرفوف')}
                </button>
                <span className="atlas-tab is-active" aria-current="true">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                        <path d="M12 21 C12 21 5 14.5 5 9.2 a7 7 0 0 1 14 0 c0 5.3 -7 11.8 -7 11.8 Z" />
                        <circle cx="12" cy="9.2" r="2.4" />
                    </svg>
                    {t('map.atlas.tabAtlas', 'الأطلس')}
                </span>
                <button type="button" className="atlas-tab" onClick={() => router.push(localizedPath('/documents'))}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                        <circle cx="11" cy="11" r="7" />
                        <line x1="21" y1="21" x2="16.5" y2="16.5" />
                    </svg>
                    {t('map.atlas.tabAdvanced', 'بحث متقدّم')}
                </button>
            </div>

            {/* Body: rail (right in RTL) + map */}
            <div className="flex flex-col-reverse lg:flex-row" dir="rtl">
                <div style={{ borderInlineStart: '1px solid var(--at-line-2)', background: 'var(--at-header)' }}>
                    <AtlasRail
                        selectedCountry={selectedCountry}
                        countryMap={countryMap}
                        onSelectRegion={(c) => setSelectedCountry((prev) => (prev === c ? null : c))}
                    />
                </div>

                <div className="relative min-w-0 flex-1">
                    <div className="h-[520px] w-full sm:h-[620px] lg:h-[780px]">
                        <InteractiveWorldMap
                            selectedCountry={selectedCountry}
                            onCountrySelect={setSelectedCountry}
                            countryMap={countryMap}
                        />
                    </div>
                </div>
            </div>
        </main>
    );
}
