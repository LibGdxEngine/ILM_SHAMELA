// Per-tab browsing-session id used to sessionize behavior events.
//
// Stored in sessionStorage so it survives in-tab navigation but not across
// tabs — one "browsing session" per tab lifetime. Purely client-side; the
// server attributes events to the user via the auth cookie, this id only
// groups a user's events into sessions.

const SESSION_KEY = 'ilm_session_id';

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // RFC4122-ish fallback for older browsers.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getSessionId(): string {
  if (typeof window === 'undefined') return '';
  try {
    let id = window.sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = uuid();
      window.sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    // sessionStorage can throw (private mode / disabled). Sessionization is
    // best-effort — fall back to an unsessionized event.
    return '';
  }
}
