'use client';

import { useCallback, useMemo, useState, useRef } from 'react';
import {
    ComposableMap,
    Geographies,
    Geography,
    ZoomableGroup,
} from 'react-simple-maps';
import { AnimatePresence, motion } from 'framer-motion';
import { useI18n } from '@/components/i18n/I18nProvider';
import { regionDisplayName } from '@/lib/atlasRegions';
import { toLocaleDigits } from '@/lib/utils';
import type { CountryInfo } from '@/app/map/page';

const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

/* ─── Atlas palette ─── */
const FILL_SELECTED = '#2c4c82';
const FILL_ACTIVE = '#aec2e8';
const FILL_INACTIVE = '#d9ceb0';
const FILL_ACTIVE_HOVER = '#2c4c82';
const FILL_INACTIVE_HOVER = '#cfc0a2';
const STROKE = '#efe7d4';

interface TooltipState {
    x: number;
    y: number;
    name: string;
    bookCount: number;
}

interface InteractiveWorldMapProps {
    selectedCountry: string | null;
    onCountrySelect: (country: string | null) => void;
    countryMap: Record<string, CountryInfo>;
}

export default function InteractiveWorldMap({ selectedCountry, onCountrySelect, countryMap }: InteractiveWorldMapProps) {
    const { t, locale } = useI18n();
    const num = (n: number) => toLocaleDigits(n, locale);

    const [tooltip, setTooltip] = useState<TooltipState | null>(null);
    const [position, setPosition] = useState<{ coordinates: [number, number]; zoom: number }>({
        coordinates: [20, 20],
        zoom: 1.5,
    });
    const mapContainerRef = useRef<HTMLDivElement>(null);

    const activeCountries = useMemo(() => new Set(Object.keys(countryMap)), [countryMap]);
    const regionsCount = activeCountries.size;

    const handleCountryClick = useCallback(
        (geo: { properties: { name: string } }) => {
            const name = geo.properties.name;
            if (activeCountries.has(name)) onCountrySelect(name);
        },
        [activeCountries, onCountrySelect],
    );

    const handleCountryMouseEnter = useCallback(
        (geo: { properties: { name: string } }, evt: React.MouseEvent) => {
            const name = geo.properties.name;
            const countryData = countryMap[name];
            if (countryData) {
                const rect = mapContainerRef.current?.getBoundingClientRect();
                setTooltip({
                    x: evt.clientX - (rect?.left ?? 0),
                    y: evt.clientY - (rect?.top ?? 0),
                    name: regionDisplayName(countryData.countryName, locale),
                    bookCount: countryData.documentCount,
                });
            }
        },
        [countryMap, locale],
    );

    const handleCountryMouseLeave = useCallback(() => setTooltip(null), []);

    return (
        <div
            className="relative h-full w-full overflow-hidden"
            ref={mapContainerRef}
            style={{ background: 'radial-gradient(120% 120% at 30% 20%, var(--at-map-1), var(--at-map-2))' }}
        >
            <div className="h-full w-full">
                <ComposableMap
                    projection="geoMercator"
                    projectionConfig={{ scale: 140 }}
                    className="h-full w-full"
                    style={{ background: 'transparent' }}
                >
                    <ZoomableGroup
                        center={position.coordinates}
                        zoom={position.zoom}
                        onMoveEnd={(pos) => setPosition(pos)}
                        minZoom={1}
                        maxZoom={6}
                    >
                        <Geographies geography={GEO_URL}>
                            {({ geographies }) =>
                                geographies.map((geo) => {
                                    const name: string = geo.properties.name;
                                    const isActive = activeCountries.has(name);
                                    const isSelected = name === selectedCountry;
                                    return (
                                        <Geography
                                            key={geo.rsmKey}
                                            geography={geo}
                                            onClick={() => handleCountryClick(geo)}
                                            onMouseEnter={(evt) => handleCountryMouseEnter(geo, evt)}
                                            onMouseLeave={handleCountryMouseLeave}
                                            className={isActive ? 'cursor-pointer outline-none' : 'outline-none'}
                                            style={{
                                                default: {
                                                    fill: isSelected ? FILL_SELECTED : isActive ? FILL_ACTIVE : FILL_INACTIVE,
                                                    stroke: STROKE,
                                                    strokeWidth: 0.6,
                                                    transition: 'fill 0.25s ease',
                                                },
                                                hover: {
                                                    fill: isActive ? FILL_ACTIVE_HOVER : FILL_INACTIVE_HOVER,
                                                    stroke: STROKE,
                                                    strokeWidth: isActive ? 1 : 0.6,
                                                    transition: 'fill 0.15s ease',
                                                },
                                                pressed: {
                                                    fill: isActive ? '#21396a' : FILL_INACTIVE,
                                                    stroke: STROKE,
                                                    strokeWidth: 0.6,
                                                },
                                            }}
                                        />
                                    );
                                })
                            }
                        </Geographies>
                    </ZoomableGroup>
                </ComposableMap>
            </div>

            {/* Tooltip */}
            <AnimatePresence>
                {tooltip && (
                    <motion.div
                        key="tooltip"
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 4 }}
                        transition={{ duration: 0.15 }}
                        className="atlas-chrome pointer-events-none absolute z-30 px-3.5 py-2"
                        style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}
                    >
                        <p className="text-[13px] font-semibold" style={{ color: 'var(--at-ink)' }} dir="auto">{tooltip.name}</p>
                        <p className="mt-0.5 text-[11px]" style={{ color: 'var(--at-ink-3)' }}>
                            {t('map.atlas.worksCount', '{count} عمل', { count: num(tooltip.bookCount) })}
                        </p>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Title chrome card */}
            <div className="atlas-chrome absolute z-20 px-[15px] py-[11px]" style={{ top: 18, insetInlineStart: 18 }}>
                <div className="atlas-title text-[14px]">{t('map.atlas.mapTitle', 'الخريطة التفاعلية')}</div>
                <div className="mt-0.5 text-[11.5px]" style={{ color: 'var(--at-ink-3)' }}>
                    {t('map.atlas.mapSubtitle', 'المؤلفون حسب الموطن · {count} إقليمًا', { count: num(regionsCount) })}
                </div>
            </div>

            {/* Compass rose */}
            <svg
                width="56"
                height="56"
                viewBox="0 0 56 56"
                className="absolute z-20"
                style={{ top: 18, insetInlineEnd: 18 }}
                aria-hidden
            >
                <circle cx="28" cy="30" r="22" fill="var(--at-surface)" stroke="var(--at-line)" />
                <path d="M28 14 L32 30 L28 46 L24 30 Z" fill="#2c4c82" />
                <path d="M12 30 L28 34 L44 30 L28 26 Z" fill="#cdbf9f" />
                <text x="28" y="9" fontSize="11" fontWeight="700" fill="#2c4c82" textAnchor="middle">ش</text>
            </svg>

            {/* Zoom controls */}
            <div className="absolute z-20 flex flex-col overflow-hidden rounded-[10px] border" style={{ bottom: 18, insetInlineEnd: 18, borderColor: 'var(--at-line-2)' }}>
                <button
                    type="button"
                    onClick={() => setPosition((p) => ({ ...p, zoom: Math.min(p.zoom * 1.4, 6) }))}
                    className="flex h-[34px] w-[34px] items-center justify-center text-[18px] transition-colors hover:bg-black/[0.03]"
                    style={{ background: 'var(--at-surface)', color: 'var(--at-brand)' }}
                    aria-label={t('map.zoomIn', 'تكبير')}
                >+</button>
                <button
                    type="button"
                    onClick={() => setPosition((p) => ({ ...p, zoom: Math.max(p.zoom / 1.4, 1) }))}
                    className="flex h-[34px] w-[34px] items-center justify-center border-t text-[18px] transition-colors hover:bg-black/[0.03]"
                    style={{ background: 'var(--at-surface)', color: 'var(--at-brand)', borderColor: 'var(--at-line-2)' }}
                    aria-label={t('map.zoomOut', 'تصغير')}
                >−</button>
                <button
                    type="button"
                    onClick={() => setPosition({ coordinates: [20, 20], zoom: 1.5 })}
                    className="flex h-[34px] w-[34px] items-center justify-center border-t transition-colors hover:bg-black/[0.03]"
                    style={{ background: 'var(--at-surface)', color: 'var(--at-brand)', borderColor: 'var(--at-line-2)' }}
                    aria-label={t('map.reset', 'إعادة الضبط')}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                        <path d="M3 3v5h5" />
                    </svg>
                </button>
            </div>

            {/* Legend */}
            <div className="atlas-chrome absolute z-20 flex items-center gap-3.5 px-[13px] py-[9px] text-[11.5px]" style={{ bottom: 18, insetInlineStart: 18, color: 'var(--at-ink-2)' }}>
                <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: FILL_SELECTED }} />
                    {t('map.atlas.legendSelected', 'المختار')}
                </span>
                <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: FILL_ACTIVE }} />
                    {t('map.atlas.legendActive', 'له أعمال')}
                </span>
                <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 rounded-full border" style={{ background: FILL_INACTIVE, borderColor: 'var(--at-line)' }} />
                    {t('map.atlas.legendNone', 'لا بيانات')}
                </span>
            </div>
        </div>
    );
}
