'use client';

import { useState, useEffect } from 'react';
import InteractiveWorldMap from '@/components/InteractiveWorldMap';
import MapSidePanel from '@/components/MapSidePanel';
import { getCountryDocumentStats, CountryDocumentStat } from '@/lib/api';

/** Country-name → flag emoji (extend as needed). */
const COUNTRY_FLAGS: Record<string, string> = {
    Egypt: '🇪🇬',
    Iraq: '🇮🇶',
    'Saudi Arabia': '🇸🇦',
    Syria: '🇸🇾',
    Morocco: '🇲🇦',
    Tunisia: '🇹🇳',
    Iran: '🇮🇷',
    Spain: '🇪🇸',
    Turkey: '🇹🇷',
    India: '🇮🇳',
    Libya: '🇱🇾',
    'United States of America': '🇺🇸',
    Algeria: '🇩🇿',
    Jordan: '🇯🇴',
    Lebanon: '🇱🇧',
    Palestine: '🇵🇸',
    Yemen: '🇾🇪',
    Oman: '🇴🇲',
    Kuwait: '🇰🇼',
    'United Arab Emirates': '🇦🇪',
    Qatar: '🇶🇦',
    Bahrain: '🇧🇭',
    Sudan: '🇸🇩',
    Pakistan: '🇵🇰',
    Afghanistan: '🇦🇫',
    Indonesia: '🇮🇩',
    Malaysia: '🇲🇾',
    Somalia: '🇸🇴',
    Mauritania: '🇲🇷',
    Uzbekistan: '🇺🇿',
    Tajikistan: '🇹🇯',
    Bangladesh: '🇧🇩',
    Nigeria: '🇳🇬',
    Senegal: '🇸🇳',
    Mali: '🇲🇱',
    China: '🇨🇳',
    Japan: '🇯🇵',
    Germany: '🇩🇪',
    France: '🇫🇷',
    'United Kingdom': '🇬🇧',
    Italy: '🇮🇹',
    Russia: '🇷🇺',
    Canada: '🇨🇦',
    Australia: '🇦🇺',
    Brazil: '🇧🇷',
    Mexico: '🇲🇽',
    'South Africa': '🇿🇦',
};

export interface CountryInfo {
    countryName: string;
    flag: string;
    documentCount: number;
}

export default function MapPage() {
    const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
    const [countryMap, setCountryMap] = useState<Record<string, CountryInfo>>({});
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        getCountryDocumentStats()
            .then((stats: CountryDocumentStat[]) => {
                const map: Record<string, CountryInfo> = {};
                for (const s of stats) {
                    map[s.country] = {
                        countryName: s.country,
                        flag: COUNTRY_FLAGS[s.country] ?? '🏳️',
                        documentCount: s.document_count,
                    };
                }
                setCountryMap(map);
            })
            .catch((err) => console.error('Failed to load country stats:', err))
            .finally(() => setIsLoading(false));
    }, []);

    return (
        <main className="landing-shell flex flex-col relative" style={{ height: 'calc(100dvh - 56px)' }}>
            {/* Page header */}
            <div className="px-4 md:px-6 pt-4 md:pt-8 pb-3 md:pb-4 max-w-[1280px] mx-auto w-full shrink-0">
                <span className="section-eyebrow text-[11px] md:text-[12px]">Explore by Origin</span>
                <h1 className="font-fraunces text-[clamp(24px,4vw,44px)] font-light leading-[1.1] tracking-tight mt-1 md:mt-3">
                    Manuscripts across the{' '}
                    <em className="italic text-accent-2">world</em>
                </h1>
                <p className="mt-2 md:mt-3 text-[14px] md:text-[15px] leading-relaxed text-text-2 max-w-xl hidden sm:block">
                    Click on any highlighted country to explore works by authors from that region.
                    Zoom and pan to navigate the map.
                </p>
            </div>

            {/* Map fills remaining space */}
            <div className="flex-1 min-h-0 px-4 md:px-6 pb-4 md:pb-6 max-w-[1280px] mx-auto w-full relative min-h-[85dvh]">
                <div className="relative w-full h-full bg-gradient-to-b from-card-2/60 to-card/40 rounded-xl md:rounded-2xl border border-border overflow-hidden shadow-[0_4px_24px_-8px_rgba(0,0,0,0.06)]">
                    <InteractiveWorldMap
                        selectedCountry={selectedCountry}
                        onCountrySelect={setSelectedCountry}
                        countryMap={countryMap}
                    />

                    <MapSidePanel
                        selectedCountry={selectedCountry}
                        onClose={() => setSelectedCountry(null)}
                        countryMap={countryMap}
                    />
                </div>
            </div>
        </main>
    );
}
