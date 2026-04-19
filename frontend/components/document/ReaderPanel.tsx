'use client';

import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/components/i18n/I18nProvider';
import useMediaQuery from '@/hooks/useMediaQuery';
import ReaderPopover from './ReaderPopover';

interface ReaderPanelProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  width?: 'wide' | 'narrow' | 'xl';
  title?: string;
}

const SWIPE_DISMISS_THRESHOLD = 80;

/**
 * Adaptive panel: delegates to `ReaderPopover` on desktop (>= 768px)
 * and renders a bottom-sheet on mobile. Swipe-to-dismiss is plain JS
 * (onTouchStart/Move/End) to avoid new runtime dependencies.
 */
export default function ReaderPanel({
  isOpen,
  onClose,
  children,
  width = 'wide',
  title,
}: ReaderPanelProps) {
  // SSR defaults to desktop so the first paint matches server HTML for the hero.
  const isDesktop = useMediaQuery('(min-width: 768px)', true);
  const { t } = useI18n();
  const sheetRef = useRef<HTMLDivElement>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const touchStartYRef = useRef<number | null>(null);

  // Reset drag state whenever the sheet visibility flips.
  useEffect(() => {
    if (!isOpen) {
      setDragOffset(0);
      setIsDragging(false);
      touchStartYRef.current = null;
    }
  }, [isOpen]);

  // Escape to close on mobile (desktop already handled inside ReaderPopover).
  useEffect(() => {
    if (isDesktop || !isOpen) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isDesktop, isOpen, onClose]);

  if (isDesktop) {
    return (
      <ReaderPopover isOpen={isOpen} onClose={onClose} width={width}>
        {children}
      </ReaderPopover>
    );
  }

  if (!isOpen) return null;

  const handleTouchStart = (event: React.TouchEvent) => {
    touchStartYRef.current = event.touches[0].clientY;
    setIsDragging(true);
  };

  const handleTouchMove = (event: React.TouchEvent) => {
    if (touchStartYRef.current === null) return;
    const delta = event.touches[0].clientY - touchStartYRef.current;
    if (delta > 0) {
      setDragOffset(delta);
    }
  };

  const handleTouchEnd = () => {
    if (dragOffset > SWIPE_DISMISS_THRESHOLD) {
      onClose();
    }
    setIsDragging(false);
    setDragOffset(0);
    touchStartYRef.current = null;
  };

  const translateStyle = dragOffset > 0 ? { transform: `translateY(${dragOffset}px)` } : undefined;
  const transitionStyle = isDragging ? { transition: 'none' } : undefined;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/40 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
        data-testid="reader-panel-backdrop"
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] rounded-t-3xl bg-white shadow-2xl flex flex-col"
        style={{ ...translateStyle, ...transitionStyle, paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div
          className="flex cursor-grab touch-none flex-col items-center pt-2 pb-1"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          aria-label={t('reader.swipeToDismiss', 'Swipe down to dismiss')}
        >
          <span className="h-1.5 w-10 rounded-full bg-gray-300" aria-hidden="true" />
        </div>
        {title && (
          <div className="flex items-center justify-between px-5 pt-1 pb-2">
            <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('reader.closePanel', 'Close panel')}
              className="rounded-full p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-2">{children}</div>
      </div>
    </>
  );
}
