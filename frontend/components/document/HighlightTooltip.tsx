'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '@/components/i18n/I18nProvider';

interface HighlightTooltipProps {
  enabled: boolean;
}

interface TooltipState {
  top: number;
  left: number;
}

/**
 * A small styled tooltip shown while hovering a highlight, hinting that a
 * right-click removes it. Highlights are injected via dangerouslySetInnerHTML,
 * so we use a delegated `mouseover`/`mouseout` listener instead of per-element
 * React handlers, and portal into the scroll container so the tooltip isn't
 * clipped by the page's `overflow-hidden`.
 */
export default function HighlightTooltip({ enabled }: HighlightTooltipProps) {
  const { t } = useI18n();
  const [state, setState] = useState<TooltipState | null>(null);

  useEffect(() => {
    if (!enabled) {
      setState(null);
      return;
    }
    const positionFor = (mark: HTMLElement) => {
      const rect = mark.getBoundingClientRect();
      const container = document.getElementById('document-scroll-container');
      if (container) {
        const containerRect = container.getBoundingClientRect();
        return {
          top: rect.top - containerRect.top + container.scrollTop - 10,
          left: rect.left - containerRect.left + container.scrollLeft + rect.width / 2,
        };
      }
      return {
        top: rect.top + window.scrollY - 10,
        left: rect.left + window.scrollX + rect.width / 2,
      };
    };
    const handleMouseOver = (event: MouseEvent) => {
      const mark = (event.target as HTMLElement | null)?.closest?.('mark[data-hid]') as
        | HTMLElement
        | null;
      if (!mark) {
        setState(null);
        return;
      }
      setState(positionFor(mark));
    };
    const handleScroll = () => setState(null);
    document.addEventListener('mouseover', handleMouseOver);
    const container = document.getElementById('document-scroll-container');
    container?.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      document.removeEventListener('mouseover', handleMouseOver);
      container?.removeEventListener('scroll', handleScroll);
    };
  }, [enabled]);

  if (!enabled || !state) return null;

  const tooltip = (
    <div
      role="tooltip"
      style={{
        position: 'absolute',
        top: state.top,
        left: state.left,
        transform: 'translate(-50%, -100%)',
      }}
      className="highlight-tooltip pointer-events-none z-50 flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border-strong bg-card-2/95 px-2.5 py-1.5 text-[12px] font-medium text-text shadow-[0_8px_24px_-8px_rgba(0,0,0,0.55)] backdrop-blur-md"
    >
      <svg className="h-3.5 w-3.5 text-text-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.8}
          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
        />
      </svg>
      {t('reader.deleteHighlightHint', 'Right-click to delete')}
      <span
        aria-hidden
        className="absolute start-1/2 top-full -translate-x-1/2 -translate-y-1/2 h-2 w-2 rotate-45 border-b border-e border-border-strong bg-card-2/95"
      />
    </div>
  );

  if (typeof document === 'undefined') return tooltip;
  const container = document.getElementById('document-scroll-container');
  return container ? createPortal(tooltip, container) : tooltip;
}
