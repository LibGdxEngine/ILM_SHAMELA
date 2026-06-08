'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '@/components/i18n/I18nProvider';
import type { HighlightColor } from '@/lib/api/reader';

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

/**
 * Walk up from a node until an element with `data-page` is found. Returns
 * `null` when the selection sits outside the document content.
 */
function findPageRoot(node: Node | null): HTMLElement | null {
  let current: Node | null = node;
  while (current) {
    if (current instanceof HTMLElement && current.getAttribute('data-page')) {
      return current;
    }
    current = current.parentNode;
  }
  return null;
}

/**
 * Compute the character offset of `target` within `root`'s text content.
 * Walks via TreeWalker so DOM splits (from highlight `<mark>` wraps) don't
 * throw the count off.
 */
function offsetWithinRoot(root: HTMLElement, target: Node, targetOffset: number): number {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let current: Node | null = walker.nextNode();
  while (current) {
    if (current === target) {
      return offset + targetOffset;
    }
    offset += (current.textContent ?? '').length;
    current = walker.nextNode();
  }
  return offset;
}

/**
 * Determine which `<br />`-separated chunk the selection start falls into.
 * Returns the zero-based paragraph index used in `paragraph_id`.
 */
function paragraphIndexFor(root: HTMLElement, target: Node): number {
  const brs = Array.from(root.querySelectorAll('br'));
  if (brs.length === 0) return 0;

  // Walk text/br nodes in order; count `<br />` elements that appear strictly
  // before the selection target.
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT
  );
  let paragraphIndex = 0;
  let current: Node | null = walker.nextNode();
  while (current) {
    if (current === target) return paragraphIndex;
    if (current.contains(target)) return paragraphIndex;
    if (current.nodeName === 'BR') {
      paragraphIndex += 1;
    }
    current = walker.nextNode();
  }
  return paragraphIndex;
}

export default function SelectionPopover({ enabled, onCreateHighlight, onAskAssistant }: SelectionPopoverProps) {
  const { t } = useI18n();
  const [state, setState] = useState<PopoverState | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const handleSelectionChange = useCallback(() => {
    if (!enabled) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      setState(null);
      return;
    }
    const range = selection.getRangeAt(0);
    const pageRoot = findPageRoot(range.startContainer);
    if (!pageRoot) {
      setState(null);
      return;
    }
    // Selection must be entirely within a single page wrapper.
    if (!pageRoot.contains(range.endContainer)) {
      setState(null);
      return;
    }
    const pageNumber = parseInt(pageRoot.getAttribute('data-page') ?? '0', 10);
    if (!pageNumber) {
      setState(null);
      return;
    }
    // The actual content lives inside an inner `<div>` rendered with
    // dangerouslySetInnerHTML. Walk to that ancestor so offsets are stable.
    const contentRoot = pageRoot.querySelector('div[style*="--reader-font-size"]') as HTMLElement | null;
    const offsetRoot = contentRoot ?? pageRoot;
    const charStart = offsetWithinRoot(offsetRoot, range.startContainer, range.startOffset);
    const charEnd = offsetWithinRoot(offsetRoot, range.endContainer, range.endOffset);
    if (charEnd <= charStart) {
      setState(null);
      return;
    }
    const paragraphIndex = paragraphIndexFor(offsetRoot, range.startContainer);
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
        page_number: pageNumber,
        paragraph_id: `p${pageNumber}-${paragraphIndex}`,
        char_start: Math.min(charStart, charEnd),
        char_end: Math.max(charStart, charEnd),
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
