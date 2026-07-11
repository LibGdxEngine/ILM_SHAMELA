/**
 * Shared helpers for turning the current DOM text selection inside the reader
 * into a stable, page-anchored payload (page number, paragraph id, character
 * offsets, and the selected text).
 *
 * Used by both the highlight `SelectionPopover` and the right-click
 * `SelectionContextMenu` so highlight/note/correction anchors are computed the
 * same way everywhere.
 */

export interface SelectionPayload {
  page_number: number;
  paragraph_id: string;
  char_start: number;
  char_end: number;
  text: string;
}

/**
 * Walk up from a node until an element with `data-page` is found. Returns
 * `null` when the selection sits outside the document content.
 */
export function findPageRoot(node: Node | null): HTMLElement | null {
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
export function offsetWithinRoot(root: HTMLElement, target: Node, targetOffset: number): number {
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
export function paragraphIndexFor(root: HTMLElement, target: Node): number {
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

/**
 * Walk up from a node to the nearest PDF-overlay block (`[data-block-id]`).
 * Returns `null` when the node is not inside an overlay page.
 */
function findOverlayBlock(node: Node | null): HTMLElement | null {
  let current: Node | null = node;
  while (current) {
    if (current instanceof HTMLElement && current.hasAttribute('data-block-id')) {
      return current;
    }
    current = current.parentNode;
  }
  return null;
}

/**
 * Resolve a selection endpoint inside a PDF-overlay page to a page-content
 * character offset: the block's `data-char-start` anchor plus the offset within
 * the block. Blocks render newlines literally (`white-space: pre-wrap`), so DOM
 * text offsets align exactly with the stored content offsets.
 */
function overlayOffsetFor(block: HTMLElement, target: Node, targetOffset: number): number {
  const anchor = parseInt(block.getAttribute('data-char-start') ?? '0', 10) || 0;
  return anchor + offsetWithinRoot(block, target, targetOffset);
}

/**
 * Read the current `window.getSelection()` and resolve it to a page-anchored
 * payload, or `null` when there is no valid selection inside a page wrapper.
 */
export function computeSelectionPayload(): SelectionPayload | null {
  if (typeof window === 'undefined') return null;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }
  const range = selection.getRangeAt(0);
  const pageRoot = findPageRoot(range.startContainer);
  if (!pageRoot) return null;
  // Selection must be entirely within a single page wrapper.
  if (!pageRoot.contains(range.endContainer)) return null;
  const pageNumber = parseInt(pageRoot.getAttribute('data-page') ?? '0', 10);
  if (!pageNumber) return null;

  // PDF-overlay pages: offsets are anchored per block (`data-char-start`), so a
  // selection spanning blocks still maps to the page-content offset space.
  const startBlock = findOverlayBlock(range.startContainer);
  if (startBlock) {
    const endBlock = findOverlayBlock(range.endContainer);
    if (!endBlock) return null;
    const charStart = overlayOffsetFor(startBlock, range.startContainer, range.startOffset);
    const charEnd = overlayOffsetFor(endBlock, range.endContainer, range.endOffset);
    if (charEnd <= charStart) return null;
    return {
      page_number: pageNumber,
      paragraph_id: startBlock.getAttribute('data-block-id') ?? `p${pageNumber}-0`,
      char_start: charStart,
      char_end: charEnd,
      text: selection.toString(),
    };
  }

  // The actual content lives inside an inner `<div>` rendered with
  // dangerouslySetInnerHTML. Walk to that ancestor so offsets are stable.
  const contentRoot = pageRoot.querySelector('div[style*="--reader-font-size"]') as HTMLElement | null;
  const offsetRoot = contentRoot ?? pageRoot;
  const charStart = offsetWithinRoot(offsetRoot, range.startContainer, range.startOffset);
  const charEnd = offsetWithinRoot(offsetRoot, range.endContainer, range.endOffset);
  if (charEnd <= charStart) return null;
  const paragraphIndex = paragraphIndexFor(offsetRoot, range.startContainer);
  return {
    page_number: pageNumber,
    paragraph_id: `p${pageNumber}-${paragraphIndex}`,
    char_start: Math.min(charStart, charEnd),
    char_end: Math.max(charStart, charEnd),
    text: selection.toString(),
  };
}

// Double-click-to-search suppresses the SelectionPopover for the gesture: the
// native dblclick word-selection fires `selectionchange` before the dblclick
// handler can clear it, so the popover's debounced timer would flash it.
// Module-level state is fine — only one reader mounts at a time.
let popoverSuppressedUntil = 0;

/** Suppress the SelectionPopover briefly (double-click-to-search gesture). */
export function suppressSelectionPopover(ms = 400): void {
  popoverSuppressedUntil = Date.now() + ms;
}

export function releaseSelectionPopoverSuppression(): void {
  popoverSuppressedUntil = 0;
}

export function isSelectionPopoverSuppressed(): boolean {
  return Date.now() < popoverSuppressedUntil;
}
