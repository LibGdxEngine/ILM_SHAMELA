// Centralised TanStack Query keys for the reader-experience hooks.
// Keep these as `as const` tuples so consumers get strict literal types
// when invalidating or reading from the cache.

export const readerKeys = {
  preferences: () => ['reader', 'preferences'] as const,
  bookmarks: (docId: number) => ['reader', 'bookmarks', docId] as const,
  notes: (docId: number) => ['reader', 'notes', docId] as const,
  highlights: (docId: number) => ['reader', 'highlights', docId] as const,
  progress: (docId: number) => ['reader', 'progress', docId] as const,
  continueReading: () => ['reader', 'continue'] as const,
  recommendations: () => ['reader', 'recommendations'] as const,
  chapters: (docId: number) => ['reader', 'chapters', docId] as const,
};
