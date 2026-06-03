import { domToPng } from 'modern-screenshot';

/**
 * Client-side page rasterization for the protected book reader.
 *
 * The reader renders each page's plain-text content into an offscreen DOM node
 * (so the browser handles Arabic/Persian shaping, bidi, RTL and line-wrapping
 * for free), rasterizes that node to a PNG, then drops the text node from the
 * DOM and displays only the image. This keeps page text out of the rendered
 * DOM and disables easy select/copy.
 *
 * NOTE: this is NOT true DRM. The source text is still fetched over the network
 * and lives in JS memory; a determined user can read the raw API response. Real
 * protection requires generating the image server-side and never sending text.
 */

const RTL_LANGUAGES = new Set([
  'ar', // Arabic
  'fa', // Persian (Farsi)
  'fas',
  'per',
  'ur', // Urdu
  'ps', // Pashto
  'arc',
  'syr',
  'he', // Hebrew
]);

/**
 * Whether a document language should render right-to-left. Accepts short codes
 * (e.g. "ar", "fa") and is case-insensitive. Notably treats Persian ("fa") as
 * RTL, which the original `language === 'ar'` check missed.
 */
export function isRtlLanguage(language?: string | null): boolean {
  if (!language) return false;
  const normalized = language.trim().toLowerCase();
  if (RTL_LANGUAGES.has(normalized)) return true;
  // Handle locale tags like "ar-EG" / "fa_IR".
  const base = normalized.split(/[-_]/)[0];
  return RTL_LANGUAGES.has(base);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escape page content and convert newlines to `<br />`. The image path needs no
 * highlight/search wrapping, so this is the no-ranges equivalent of
 * `renderContentHtml` in DocumentPage.tsx.
 */
export function escapeContentHtml(content: string): string {
  return escapeHtml(content).replace(/\n/g, '<br />');
}

export interface RasterizeOptions {
  /** Device pixel ratio for crisp text. Capped at 3 to bound image size. */
  pixelRatio?: number;
  /** Background painted behind the text (matches the reader theme). */
  backgroundColor?: string;
}

/**
 * Rasterize a DOM node to a PNG data URL. Waits for web fonts to load first so
 * Arabic/Persian/Latin glyphs are shaped correctly before capture.
 */
export async function rasterizeNode(
  node: HTMLElement,
  { pixelRatio, backgroundColor }: RasterizeOptions = {}
): Promise<string> {
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    await document.fonts.ready;
  }
  const dpr = pixelRatio ?? (typeof window !== 'undefined' ? window.devicePixelRatio : 2) ?? 2;
  return domToPng(node, {
    scale: Math.min(Math.max(dpr, 1), 3),
    backgroundColor: backgroundColor ?? '#ffffff',
    // Skip cross-origin resources that can't be embedded rather than failing.
    fetch: { bypassingCache: false },
  });
}

/**
 * Small LRU cache of rendered page images, keyed by document id + page number +
 * a signature of the style settings that affect layout. The document id keeps
 * pages from different documents (which share page numbers) from colliding.
 * Bounds memory on long documents.
 */
class PageImageCache {
  private store = new Map<string, string>();

  constructor(private readonly maxEntries = 20) {}

  private static key(documentId: number, pageNumber: number, signature: string): string {
    return `${documentId}|${pageNumber}|${signature}`;
  }

  get(documentId: number, pageNumber: number, signature: string): string | undefined {
    const key = PageImageCache.key(documentId, pageNumber, signature);
    const value = this.store.get(key);
    if (value !== undefined) {
      // Mark as most-recently-used.
      this.store.delete(key);
      this.store.set(key, value);
    }
    return value;
  }

  set(documentId: number, pageNumber: number, signature: string, dataUrl: string): void {
    const key = PageImageCache.key(documentId, pageNumber, signature);
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, dataUrl);
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }
}

export const pageImageCache = new PageImageCache();
