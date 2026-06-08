'use client';

import { useCallback, useMemo, useState, useRef } from 'react';
import {
    ComposableMap,
    Geographies,
    Geography,
    ZoomableGroup,
} from 'react-simple-maps';
import { AnimatePresence, motion } from 'framer-motion';
import type { CountryInfo } from '@/app/map/page';

const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

/* ─── Tooltip state ─── */

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

/* ─── Component ─── */

export default function InteractiveWorldMap({ selectedCountry, onCountrySelect, countryMap }: InteractiveWorldMapProps) {
    const [tooltip, setTooltip] = useState<TooltipState | null>(null);
    const [position, setPosition] = useState<{ coordinates: [number, number]; zoom: number }>({
        coordinates: [20, 20],
        zoom: 1.5,
    });
    const mapContainerRef = useRef<HTMLDivElement>(null);

    /* countries that have books */
    const activeCountries = useMemo(() => new Set(Object.keys(countryMap)), [countryMap]);

    const handleCountryClick = useCallback(
        (geo: { properties: { name: string } }) => {
            const name = geo.properties.name;
            if (activeCountries.has(name)) {
                onCountrySelect(name);
            }
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
                    name: countryData.countryName,
                    bookCount: countryData.documentCount,
                });
            }
        },
        [countryMap],
    );

    const handleCountryMouseLeave = useCallback(() => {
        setTooltip(null);
    }, []);

    return (
        <div className="relative w-full h-full" ref={mapContainerRef}>
            {/* ── Map ── */}
            <div
                className={`transition-all duration-500 ease-out h-full ${
                    selectedCountry ? 'w-full lg:w-[calc(100%-420px)]' : 'w-full'
                }`}
            >
                <ComposableMap
                    projection="geoMercator"
                    projectionConfig={{ scale: 140 }}
                    className="w-full h-full"
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
                                                    fill: isSelected
                                                        ? '#b97340'
                                                        : isActive
                                                            ? '#d8a373'
                                                            : '#e8e6dc',
                                                    stroke: '#faf6ef',
                                                    strokeWidth: 0.5,
                                                    transition: 'fill 0.25s ease',
                                                },
                                                hover: {
                                                    fill: isActive ? '#b97340' : '#e0ded4',
                                                    stroke: '#faf6ef',
                                                    strokeWidth: isActive ? 1 : 0.5,
                                                    transition: 'fill 0.15s ease',
                                                },
                                                pressed: {
                                                    fill: isActive ? '#9a5e30' : '#e8e6dc',
                                                    stroke: '#faf6ef',
                                                    strokeWidth: 0.5,
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

            {/* ── Tooltip ── */}
            <AnimatePresence>
                {tooltip && (
                    <motion.div
                        key="tooltip"
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 4 }}
                        transition={{ duration: 0.15 }}
                        className="pointer-events-none absolute z-30 px-3.5 py-2 rounded-xl bg-card border border-border-strong shadow-[0_8px_24px_-6px_rgba(0,0,0,0.12)] backdrop-blur-md"
                        style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}
                    >
                        <p className="text-[13px] font-medium text-text">{tooltip.name}</p>
                        <p className="text-[11px] text-text-3 mt-0.5">
                            {tooltip.bookCount} {tooltip.bookCount === 1 ? 'work' : 'works'}
                        </p>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── Zoom Controls ── */}
            <div className="absolute bottom-6 left-6 flex flex-col gap-1.5 z-20">
                <button
                    type="button"
                    onClick={() =>
                        setPosition((p) => ({ ...p, zoom: Math.min(p.zoom * 1.4, 6) }))
                    }
                    className="w-9 h-9 rounded-xl bg-card/90 border border-border-strong backdrop-blur-md flex items-center justify-center text-text-2 hover:text-text hover:border-accent transition-all duration-200 shadow-sm"
                    aria-label="Zoom in"
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 5v14M5 12h14" />
                    </svg>
                </button>
                <button
                    type="button"
                    onClick={() =>
                        setPosition((p) => ({ ...p, zoom: Math.max(p.zoom / 1.4, 1) }))
                    }
                    className="w-9 h-9 rounded-xl bg-card/90 border border-border-strong backdrop-blur-md flex items-center justify-center text-text-2 hover:text-text hover:border-accent transition-all duration-200 shadow-sm"
                    aria-label="Zoom out"
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M5 12h14" />
                    </svg>
                </button>
                <button
                    type="button"
                    onClick={() => setPosition({ coordinates: [20, 20], zoom: 1.5 })}
                    className="w-9 h-9 rounded-xl bg-card/90 border border-border-strong backdrop-blur-md flex items-center justify-center text-text-2 hover:text-text hover:border-accent transition-all duration-200 shadow-sm"
                    aria-label="Reset view"
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                        <path d="M3 3v5h5" />
                    </svg>
                </button>
            </div>

            {/* ── Legend ── */}
            <div className="absolute bottom-6 right-6 z-20 bg-card/90 border border-border-strong backdrop-blur-md rounded-2xl px-4 py-3 shadow-[0_4px_20px_-8px_rgba(0,0,0,0.1)]">
                <p className="text-[10.5px] tracking-[0.14em] uppercase text-text-3 mb-2">Legend</p>
                <div className="flex items-center gap-2.5 text-[12px]">
                    <span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#d8a373' }} />
                    <span className="text-text-2">Has works</span>
                </div>
                <div className="flex items-center gap-2.5 text-[12px] mt-1.5">
                    <span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#b97340' }} />
                    <span className="text-text-2">Selected</span>
                </div>
                <div className="flex items-center gap-2.5 text-[12px] mt-1.5">
                    <span className="inline-block w-3 h-3 rounded-sm border border-border-strong" style={{ background: '#e8e6dc' }} />
                    <span className="text-text-2">No data</span>
                </div>
            </div>
        </div>
    );
}
