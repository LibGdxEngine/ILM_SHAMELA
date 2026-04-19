// LocalStorage migration shim. Pushes legacy reader data
// (`doc_<id>_bookmarks|notes`, `reader_preferences`) up to the API once per
// signed-in user. Best-effort: failures log to `console.warn` and never
// throw so the UI keeps rendering.

import {
  CreateBookmarkPayload,
  CreateNotePayload,
  ReaderFontSize,
  ReaderTheme,
  UpdateReaderPreferencesPayload,
  createBookmark,
  createNote,
  updateReaderPreferences,
} from '../api/reader';

const ALL_FLAG_KEY = 'reader_migrated_all_v1';
const PER_DOC_FLAG_PREFIX = 'reader_migrated_v1_';
const DOC_KEY_PATTERN = /^doc_(\d+)_(bookmarks|notes)$/;
const PREFERENCES_KEY = 'reader_preferences';

type LegacyBookmark = {
  page?: number;
  pageNumber?: number;
};

type LegacyNote = {
  page?: number;
  pageNumber?: number;
  content?: string;
  body?: string;
};

type LegacyPreferences = {
  font_size?: unknown;
  fontSize?: unknown;
  theme?: unknown;
};

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn(`[reader-migrate] Failed to parse ${key}:`, err);
    return null;
  }
}

function isHttp400(err: unknown): boolean {
  // Backend dedupe surfaces as a 400 with a `unique_together` message.
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('unique') ||
    msg.includes('already exists') ||
    msg.includes('must make a unique set') ||
    msg.includes('duplicate')
  );
}

function toBookmarkPayload(documentId: number, entry: LegacyBookmark): CreateBookmarkPayload | null {
  const page = entry.page ?? entry.pageNumber;
  if (typeof page !== 'number' || Number.isNaN(page)) return null;
  return {
    document: documentId,
    page_number: page,
    paragraph_id: '',
    label: '',
    tags: [],
  };
}

function toNotePayload(documentId: number, entry: LegacyNote): CreateNotePayload | null {
  const page = entry.page ?? entry.pageNumber;
  const body = entry.body ?? entry.content;
  if (typeof page !== 'number' || Number.isNaN(page)) return null;
  if (typeof body !== 'string' || body.length === 0) return null;
  return {
    document: documentId,
    page_number: page,
    paragraph_id: '',
    body,
    tags: [],
  };
}

function isFontSize(value: unknown): value is ReaderFontSize {
  return value === 'small' || value === 'medium' || value === 'large';
}

function isTheme(value: unknown): value is ReaderTheme {
  return value === 'light' || value === 'sepia' || value === 'dark';
}

function preferencesPatch(legacy: LegacyPreferences): UpdateReaderPreferencesPayload {
  const patch: UpdateReaderPreferencesPayload = {};
  const fontSize = legacy.font_size ?? legacy.fontSize;
  if (isFontSize(fontSize)) patch.font_size = fontSize;
  if (isTheme(legacy.theme)) patch.theme = legacy.theme;
  return patch;
}

type MigrationOutcome = {
  attempted: number;
  fatalRejections: number;
};

async function pushDoc(documentId: number): Promise<MigrationOutcome> {
  const outcome: MigrationOutcome = { attempted: 0, fatalRejections: 0 };
  if (!isBrowser()) return outcome;

  const bookmarks = readJson<LegacyBookmark[]>(`doc_${documentId}_bookmarks`) ?? [];
  const notes = readJson<LegacyNote[]>(`doc_${documentId}_notes`) ?? [];

  const bookmarkPromises = bookmarks
    .map((entry) => toBookmarkPayload(documentId, entry))
    .filter((p): p is CreateBookmarkPayload => p !== null)
    .map((payload) => createBookmark(payload));
  const notePromises = notes
    .map((entry) => toNotePayload(documentId, entry))
    .filter((p): p is CreateNotePayload => p !== null)
    .map((payload) => createNote(payload));

  outcome.attempted = bookmarkPromises.length + notePromises.length;
  if (outcome.attempted === 0) return outcome;

  const settled = await Promise.allSettled([...bookmarkPromises, ...notePromises]);
  for (const result of settled) {
    if (result.status === 'rejected' && !isHttp400(result.reason)) {
      outcome.fatalRejections += 1;
      console.warn('[reader-migrate] Push failed:', result.reason);
    }
  }
  return outcome;
}

async function pushPreferences(): Promise<boolean> {
  if (!isBrowser()) return true;
  const legacy = readJson<LegacyPreferences>(PREFERENCES_KEY);
  if (!legacy) return true;
  const patch = preferencesPatch(legacy);
  if (Object.keys(patch).length === 0) return true;
  try {
    await updateReaderPreferences(patch);
    return true;
  } catch (err) {
    console.warn('[reader-migrate] Failed to push preferences:', err);
    return false;
  }
}

/**
 * Tier 1: sweep every `doc_<id>_*` localStorage key plus `reader_preferences`
 * once per signed-in user. Sets `reader_migrated_all_v1` on success so we
 * never re-run.
 */
export async function migrateAllReaderLocalStorage(): Promise<void> {
  if (!isBrowser()) return;
  if (window.localStorage.getItem(ALL_FLAG_KEY) === '1') return;

  try {
    const docIds = new Set<number>();
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key) continue;
      const match = key.match(DOC_KEY_PATTERN);
      if (!match) continue;
      const id = Number(match[1]);
      if (!Number.isNaN(id)) docIds.add(id);
    }

    let totalFatal = 0;
    for (const id of docIds) {
      const outcome = await pushDoc(id);
      totalFatal += outcome.fatalRejections;
      if (outcome.fatalRejections === 0) {
        window.localStorage.setItem(`${PER_DOC_FLAG_PREFIX}${id}`, '1');
      }
    }

    const prefsOk = await pushPreferences();
    if (totalFatal === 0 && prefsOk) {
      window.localStorage.setItem(ALL_FLAG_KEY, '1');
    }
  } catch (err) {
    console.warn('[reader-migrate] Global migration failed:', err);
  }
}

/**
 * Tier 2: per-document fallback for the case where the global sweep was
 * interrupted before reaching this document. Sets
 * `reader_migrated_v1_<id>` on success.
 */
export async function migrateReaderLocalStorageForDocument(documentId: number): Promise<void> {
  if (!isBrowser()) return;
  if (Number.isNaN(documentId) || !documentId) return;
  const flag = `${PER_DOC_FLAG_PREFIX}${documentId}`;
  if (window.localStorage.getItem(flag) === '1') return;

  try {
    const outcome = await pushDoc(documentId);
    if (outcome.fatalRejections === 0) {
      window.localStorage.setItem(flag, '1');
    }
  } catch (err) {
    console.warn(`[reader-migrate] Per-doc migration failed for ${documentId}:`, err);
  }
}
