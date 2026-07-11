'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '@/components/i18n/I18nProvider';
import type { HighlightColor } from '@/lib/api/reader';
import { computeSelectionPayload, isSelectionPopoverSuppressed } from '@/lib/reader/selection';

interface CreatePayload {
  page_number: number;
  paragraph_id: string;
  char_start: number;
  char_end: number;
  color: HighlightColor;
}

interface SelectionPopoverProps {
  enabled: boolean;
  onCreateHighlight: (payload: CreatePayload) => void;
  /** Optional: invoked with the selected text when "Ask AI" is clicked. */
  onAskAssistant?: (selectedText: string) => void;
  /** Optional: invoked with the selected text when "Search" is clicked. */
  onSearchSelection?: (selectedText: string) => void;
}

interface PopoverState {
  top: number;
  left: number;
  payload: Omit<CreatePayload, 'color'>;
}

const COLORS: HighlightColor[] = ['yellow', 'green', 'blue', 'pink', 'orange'];

const COLOR_CLASS: Record<HighlightColor, string> = {
  yellow: 'bg-yellow-300',
  green: 'bg-green-300',
  blue: 'bg-blue-300',
  pink: 'bg-pink-300',
  orange: 'bg-orange-300',
};

export default function SelectionPopover({ enabled, onCreateHighlight, onAskAssistant, onSearchSelection }: SelectionPopoverProps) {
  const { t } = useI18n();
  const [state, setState] = useState<PopoverState | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const handleSelectionChange = useCallback(() => {
    if (!enabled) return;
    // Double-click-to-search: the gesture selects a word natively; don't flash
    // the popover for it. Checked here (in the deferred callback) so it covers
    // both orderings of the debounce timer vs. the suppression flag being set.
    if (isSelectionPopoverSuppressed()) {
      setState(null);
      return;
    }
    const payload = computeSelectionPayload();
    if (!payload) {
      setState(null);
      return;
    }
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      setState(null);
      return;
    }
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      setState(null);
      return;
    }
    // Position relative to the reader's scroll container so the popover stays
    // glued to the selection while the user scrolls within it.
    const container = document.getElementById('document-scroll-container');
    let top: number;
    let left: number;
    if (container) {
      const containerRect = container.getBoundingClientRect();
      top = rect.top - containerRect.top + container.scrollTop - 8;
      left = rect.left - containerRect.left + container.scrollLeft + rect.width / 2;
    } else {
      top = rect.top + window.scrollY - 8;
      left = rect.left + window.scrollX + rect.width / 2;
    }
    setState({
      top,
      left,
      payload: {
        page_number: payload.page_number,
        paragraph_id: payload.paragraph_id,
        char_start: payload.char_start,
        char_end: payload.char_end,
      },
    });
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setState(null);
      return;
    }
    const onSelectionChange = () => {
      // Defer to ensure the selection has settled.
      window.setTimeout(handleSelectionChange, 50);
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
    };
  }, [enabled, handleSelectionChange]);

  useEffect(() => {
    if (!state) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (popoverRef.current && popoverRef.current.contains(event.target as Node)) return;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        setState(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [state]);

  if (!enabled || !state) return null;

  const popover = (
    <div
      ref={popoverRef}
      role="toolbar"
      aria-label={t('reader.highlight', 'Highlight')}
      style={{
        position: 'absolute',
        top: state.top,
        left: state.left,
        transform: 'translate(-50%, -100%)',
      }}
      className="z-50 flex items-center gap-1 rounded-full border border-border-strong bg-card-2/95 backdrop-blur-md px-2 py-1.5 shadow-[0_10px_30px_-8px_rgba(0,0,0,0.5)]"
    >
      {COLORS.map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => {
            onCreateHighlight({ ...state.payload, color });
            window.getSelection()?.removeAllRanges();
            setState(null);
          }}
          aria-label={t(`reader.color.${color}`, color)}
          className={`h-5 w-5 rounded-full border border-white/30 transition-transform hover:scale-110 ${COLOR_CLASS[color]}`}
        />
      ))}
      {onSearchSelection && (
        <button
          type="button"
          onClick={() => {
            const text = window.getSelection()?.toString() ?? '';
            if (text.trim()) onSearchSelection(text.trim());
            window.getSelection()?.removeAllRanges();
            setState(null);
          }}
          aria-label={t('reader.search.searchSelection', 'بحث')}
          className="ms-1 inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[11.5px] text-white transition-transform hover:scale-105"
          style={{ background: '#2c2620' }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.5" y2="16.5" />
          </svg>
          {t('reader.search.searchSelection', 'بحث')}
        </button>
      )}
      {onAskAssistant && (
        <button
          type="button"
          onClick={() => {
            const text = window.getSelection()?.toString() ?? '';
            if (text.trim()) onAskAssistant(text.trim());
            window.getSelection()?.removeAllRanges();
            setState(null);
          }}
          aria-label={t('reader.askAssistant', 'Ask AI')}
          className="ms-1 inline-flex h-7 items-center gap-1 rounded-full bg-accent-soft px-2.5 text-[11.5px] text-accent transition-colors hover:bg-accent/15"
        >
          <span aria-hidden>✦</span>
          {t('reader.askAssistant', 'Ask AI')}
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          window.getSelection()?.removeAllRanges();
          setState(null);
        }}
        aria-label={t('reader.closePanel', 'Close')}
        className="ms-1 rounded-full p-1 text-text-3 hover:bg-white/[0.05] hover:text-text"
      >
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );

  // Portal into the reader's scroll container so absolute offsets are
  // measured against the container (not the viewport). Falls back to
  // in-tree rendering when the container isn't mounted (e.g. tests).
  if (typeof document === 'undefined') return popover;
  const container = document.getElementById('document-scroll-container');
  return container ? createPortal(popover, container) : popover;
}
