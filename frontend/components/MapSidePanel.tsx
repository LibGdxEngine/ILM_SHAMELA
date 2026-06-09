'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { getDocumentsByCountry, Document } from '@/lib/api';
import { paletteFor } from '@/lib/coverPalettes';
import type { CountryInfo } from '@/app/map/page';

interface MapSidePanelProps {
    selectedCountry: string | null;
    onClose: () => void;
    countryMap: Record<string, CountryInfo>;
}

export default function MapSidePanel({ selectedCountry, onClose, countryMap }: MapSidePanelProps) {
    const selectedData = selectedCountry ? countryMap[selectedCountry] : null;
    const [documents, setDocuments] = useState<Document[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (!selectedCountry) {
            setDocuments([]);
            return;
        }

        let isMounted = true;
        setIsLoading(true);

        getDocumentsByCountry(selectedCountry)
            .then(res => {
                if (isMounted) {
                    setDocuments(res.results);
                }
            })
            .catch(err => {
                console.error(err);
            })
            .finally(() => {
                if (isMounted) setIsLoading(false);
            });

        return () => {
            isMounted = false;
        };
    }, [selectedCountry]);

    return (
        <AnimatePresence>
            {selectedCountry && selectedData && (
                <>
                    {/* Backdrop for mobile */}
                    <motion.div
                        key="backdrop"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="fixed inset-0 bg-black/20 backdrop-blur-[2px] z-30 lg:hidden"
                        onClick={onClose}
                    />

                    {/* Panel */}
                    <motion.aside
                        key="panel"
                        initial={{ x: '100%', opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        exit={{ x: '100%', opacity: 0 }}
                        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
                        className="absolute top-0 right-0 bottom-0 w-full max-w-[420px] z-40 bg-gradient-to-b from-card to-bg-2 border-l border-border-strong shadow-[-8px_0_32px_-12px_rgba(0,0,0,0.12)] flex flex-col overflow-hidden"
                    >
                        {/* Panel header */}
                        <div className="px-6 pt-6 pb-4 border-b border-border flex-shrink-0">
                            <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center gap-3">
                                    <span className="text-2xl">{selectedData.flag}</span>
                                    <div>
                                        <h2 className="font-fraunces text-[20px] text-text leading-tight">
                                            {selectedData.countryName}
                                        </h2>
                                        <p className="text-[12px] text-text-3 mt-0.5">
                                            {isLoading ? 'Searching...' : `${documents.length} ${documents.length === 1 ? 'work' : 'works'} found`}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="w-8 h-8 rounded-full flex items-center justify-center text-text-3 hover:text-text hover:bg-black/[0.05] transition-colors"
                                    aria-label="Close panel"
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M18 6 6 18M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                        </div>

                        {/* Book list */}
                        <div className="flex-1 overflow-y-auto px-6 py-4 custom-scrollbar">
                            <div className="flex flex-col gap-3">
                                {isLoading ? (
                                    <div className="flex flex-col gap-3 py-8 items-center text-text-3">
                                        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                                        <p className="text-[13px]">Loading works...</p>
                                    </div>
                                ) : documents.length === 0 ? (
                                    <div className="py-8 text-center text-[13px] text-text-3">
                                        No works found for this country.
                                    </div>
                                ) : (
                                    documents.map((doc, idx) => {
                                        const palette = paletteFor(doc);
                                        const authorNames = doc.authors.map(a => a.name).join('، ') || 'مؤلف غير معروف';
                                        const categoryName = doc.categories?.[0]?.name || 'غير مصنف';

                                        return (
                                            <motion.div
                                                key={doc.id}
                                                initial={{ opacity: 0, y: 12 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                transition={{ delay: idx * 0.06, duration: 0.3, ease: 'easeOut' }}
                                                className="group relative bg-gradient-to-b from-card-2 to-card rounded-[16px] border border-border hover:border-accent/40 shadow-[0_2px_12px_-4px_rgba(0,0,0,0.06)] hover:shadow-[0_8px_28px_-8px_rgba(185,115,64,0.18)] transition-all duration-300 overflow-hidden cursor-pointer hover:-translate-y-0.5"
                                            >
                                                <div className="flex gap-4 p-4">
                                                    {/* Mini cover */}
                                                    <div
                                                        className="w-[52px] h-[72px] rounded-lg flex-shrink-0 flex items-center justify-center shadow-[inset_4px_0_0_rgba(0,0,0,0.2),inset_5px_0_0_rgba(255,255,255,0.04)]"
                                                        style={{
                                                            backgroundImage: `linear-gradient(135deg, ${palette.from}, ${palette.to})`,
                                                        }}
                                                    >
                                                        <svg
                                                            className="w-5 h-5 opacity-25"
                                                            viewBox="0 0 24 24"
                                                            fill="none"
                                                            stroke={palette.accent}
                                                            strokeWidth={1.4}
                                                        >
                                                            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                                                            <path d="M14 3v5h5" />
                                                            <path d="M9 13h6M9 17h6" />
                                                        </svg>
                                                    </div>

                                                    {/* Book info */}
                                                    <div className="flex-1 min-w-0">
                                                        <h3
                                                            dir="auto"
                                                            className="font-fraunces text-[15px] leading-[1.35] text-text line-clamp-2 group-hover:text-accent-2 transition-colors"
                                                        >
                                                            {doc.title}
                                                        </h3>
                                                        <p className="text-[12px] text-text-2 mt-1 truncate" dir="auto">
                                                            {authorNames}
                                                        </p>
                                                        <div className="flex items-center gap-2 mt-2">
                                                            <span className="inline-flex items-center px-2 py-0.5 text-[10px] tracking-[0.03em] rounded-full border border-border" style={{ color: palette.accent, borderColor: `${palette.accent}30`, background: `${palette.accent}08` }}>
                                                                {categoryName}
                                                            </span>
                                                            {doc.written_date && (
                                                                <span className="text-[10.5px] text-text-3">{doc.written_date}</span>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* Arrow */}
                                                    <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent">
                                                            <path d="m9 18 6-6-6-6" />
                                                        </svg>
                                                    </div>
                                                </div>

                                                {/* Bottom accent line */}
                                                <div
                                                    className="h-[2px] w-0 group-hover:w-full transition-all duration-500"
                                                    style={{ background: `linear-gradient(90deg, ${palette.accent}60, ${palette.accent}00)` }}
                                                />
                                            </motion.div>
                                        );
                                    })
                                )}
                            </div>
                        </div>

                        {/* Panel footer */}
                        <div className="px-6 py-4 border-t border-border flex-shrink-0 bg-card/80 backdrop-blur-sm">
                            <p className="text-[11px] text-text-3 text-center">
                                <span className="text-accent" aria-hidden>✦</span>{' '}
                                Showing all works from {selectedData.countryName}
                            </p>
                        </div>
                    </motion.aside>
                </>
            )}
        </AnimatePresence>
    );
}
