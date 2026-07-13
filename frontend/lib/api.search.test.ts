// Param-building tests for the in-document + corpus search API wrappers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDocumentsSearch, searchInDocument } from './api';

const okJson = (body: unknown) =>
  ({
    ok: true,
    json: () => Promise.resolve(body),
  }) as Response;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(okJson({ matches: [], total_matches: 0, query: 'س' }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const requestedUrl = () => new URL(fetchMock.mock.calls[0][0] as string);

describe('searchInDocument', () => {
  it('sends q + mode and stamps the mode on the response', async () => {
    const res = await searchInDocument(1, 'العلم', { mode: 'all' });
    const url = requestedUrl();
    expect(url.pathname).toBe('/api/search_engine/documents/1/search/');
    expect(url.searchParams.get('q')).toBe('العلم');
    expect(url.searchParams.get('mode')).toBe('all');
    expect(res.mode).toBe('all');
  });

  it('sends threshold only for vector-bearing modes', async () => {
    await searchInDocument(1, 'س', { mode: 'all', threshold: 0.4 });
    expect(requestedUrl().searchParams.get('threshold')).toBe('0.4');

    fetchMock.mockClear();
    await searchInDocument(1, 'س', { mode: 'exact', threshold: 0.4 });
    expect(requestedUrl().searchParams.has('threshold')).toBe(false);

    fetchMock.mockClear();
    await searchInDocument(1, 'س', { mode: 'similar', threshold: 0.4 });
    expect(requestedUrl().searchParams.has('threshold')).toBe(false);
  });

  it('sends ignore_diacritics=0 only on explicit opt-out', async () => {
    await searchInDocument(1, 'س', { mode: 'all', ignoreDiacritics: false });
    expect(requestedUrl().searchParams.get('ignore_diacritics')).toBe('0');

    fetchMock.mockClear();
    await searchInDocument(1, 'س', { mode: 'all', ignoreDiacritics: true });
    expect(requestedUrl().searchParams.has('ignore_diacritics')).toBe(false);

    fetchMock.mockClear();
    await searchInDocument(1, 'س', { mode: 'all' });
    expect(requestedUrl().searchParams.has('ignore_diacritics')).toBe(false);
  });

  it('short-circuits empty queries without a request', async () => {
    const res = await searchInDocument(1, '   ', { mode: 'all' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.total_matches).toBe(0);
  });
});

describe('getDocumentsSearch', () => {
  it('forwards the abort signal and omits the default hybrid mode', async () => {
    const controller = new AbortController();
    await getDocumentsSearch({ q: 'العلم' }, { signal: controller.signal });
    const url = requestedUrl();
    expect(url.pathname).toBe('/api/search_engine/documents/search/');
    expect(url.searchParams.has('mode')).toBe(false);
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBe(controller.signal);
  });
});
