/**
 * Library-wide "ask → sourced answer" seam (the Catalog answer card).
 *
 * There is no backend endpoint for a library-wide grounded answer yet — only
 * the per-document streaming chat (`lib/api/reader.ts`). This module is the
 * single place that contract will live. Today it resolves to `null`, so the
 * Catalog renders results + facets only and the answer card stays hidden. When
 * a backend route ships, implement the fetch here and the card lights up with
 * no changes to the Catalog UI.
 */

export interface LibraryAnswerSource {
  /** Document id, when the source maps to a book in the library. */
  id?: number;
  title: string;
  author?: string;
  /** Free-form locator, e.g. "ج١ ص٢٠٨". */
  page?: string;
}

export interface LibraryAnswer {
  /** Answer prose. May contain bracketed citation markers like `[1]`. */
  answer: string;
  sources: LibraryAnswerSource[];
  /** Wall-clock answer time in seconds, for the "زمن الإجابة" line. */
  durationSeconds?: number;
}

/** Returns a grounded answer for a natural-language query, or null when unavailable. */
export async function getLibraryAnswer(_query: string): Promise<LibraryAnswer | null> {
  // Intentionally not wired — see file header. Returning null keeps the answer
  // card hidden while results + facets remain fully functional.
  return null;
}
