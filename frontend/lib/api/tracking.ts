// Fire-and-forget client telemetry → POST /api/analytics/events/ (transparently
// proxied to Django by next.config.js). Server-derived signals (searches,
// assistant questions, bookmarks) are captured server-side; this module only
// sends what the browser alone can observe (reading-time/dwell, etc.).
//
// Uses fetch({ keepalive: true }) rather than navigator.sendBeacon so the
// X-CSRFToken header (required by DRF's cookie-auth CSRF check) survives page
// teardown — sendBeacon cannot set request headers.

import { csrfHeaders } from '@/lib/csrf';
import { getSessionId } from '@/lib/tracking/session';

const EVENTS_URL = '/api/analytics/events/';

// Must stay in sync with analytics.models.CLIENT_ALLOWED_EVENT_TYPES on the
// backend — anything else is rejected by the ingest serializer.
export type TrackableEventType =
  | 'reading_session'
  | 'suggestion_select'
  | 'filter_apply'
  | 'preset_apply';

export interface TrackEventInput {
  documentId?: number | null;
  metadata?: Record<string, unknown>;
  source?: string;
}

export function trackEvent(
  eventType: TrackableEventType,
  input: TrackEventInput = {},
): void {
  if (typeof window === 'undefined') return;
  const body = JSON.stringify({
    event_type: eventType,
    document_id: input.documentId ?? null,
    session_id: getSessionId(),
    source: input.source ?? 'web',
    metadata: input.metadata ?? {},
  });
  try {
    void fetch(EVENTS_URL, {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
      body,
    }).catch(() => {
      /* telemetry is best-effort; swallow network errors */
    });
  } catch {
    /* never throw from tracking */
  }
}

export interface ReadingSessionInput {
  documentId: number;
  durationMs: number;
  pagesRead: number;
  furthestPage?: number;
  percentComplete?: number;
}

/**
 * Report a slice of active reading time for a document. Durations accumulate
 * server-side (total_read_ms += duration_ms); pages/percent are max-merged, so
 * repeated reports are safe.
 */
export function trackReadingSession(input: ReadingSessionInput): void {
  if (!input.documentId || input.durationMs <= 0) return;
  trackEvent('reading_session', {
    documentId: input.documentId,
    source: 'reader',
    metadata: {
      duration_ms: Math.round(input.durationMs),
      pages_read: input.pagesRead,
      furthest_page: input.furthestPage,
      percent_complete: input.percentComplete,
    },
  });
}
