'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ApiChatSession,
  ChatContextScope,
  ChatPin,
  createChatSession,
  deleteChatSession,
  listChatSessions,
  updateChatSession,
} from '../api/reader';

export interface UseReaderCopilotSessions {
  /** All chat sessions for this document, most-recent first. */
  sessions: ApiChatSession[];
  /** The active session object (null until bootstrapped). */
  activeSession: ApiChatSession | null;
  /** The active session id (null until bootstrapped). */
  activeSessionId: number | null;
  error: string | null;
  switchSession: (id: number) => void;
  startNewSession: () => Promise<void>;
  renameSession: (id: number, title: string) => Promise<void>;
  deleteSession: (id: number) => Promise<void>;
  /** Re-fetch the session list (e.g. to pick up a server-derived title). */
  refreshSessions: () => Promise<void>;
  /** Context scope of the active session (defaults to 'auto'). */
  contextScope: ChatContextScope;
  setContextScope: (scope: ChatContextScope) => Promise<void>;
  /** Pinned context snippets for the active session. */
  pins: ChatPin[];
  addPin: (text: string, page: number) => Promise<void>;
  removePin: (index: number) => Promise<void>;
  clearPins: () => Promise<void>;
}

/**
 * Owns the reader assistant's chat SESSIONS for one document — the durable,
 * per-user list persisted in Django (title / context_scope / pinned_context).
 * It deliberately does NOT own the message transcript: with the CopilotKit
 * stack the live conversation lives in the AG-UI thread and is hydrated from
 * Django by `ReaderAssistant`. This hook must live ABOVE the nested
 * `<CopilotKit>` provider so the active session (→ thread id) survives the
 * provider remount that a session switch triggers.
 *
 * Adapted from `useChat.ts` (minus the streaming `send`/messages path); the
 * optimistic-patch + ref-mirroring logic is preserved so rapid pin/scope
 * changes don't clobber each other.
 */
export function useReaderCopilotSessions(documentId: number): UseReaderCopilotSessions {
  const [sessions, setSessions] = useState<ApiChatSession[]>([]);
  const [session, setSession] = useState<ApiChatSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Which document the state belongs to, so a document switch re-bootstraps.
  const loadedDocRef = useRef<number | null>(null);
  // Monotonic request id to ignore results from superseded async loads.
  const reqIdRef = useRef(0);
  // Fresh mirrors for same-tick action handlers (see useChat.ts rationale).
  const sessionRef = useRef<ApiChatSession | null>(null);
  const sessionsRef = useRef<ApiChatSession[]>([]);
  // Pins requested before a session finished loading; flushed on bootstrap.
  const pendingPinsRef = useRef<ChatPin[]>([]);

  useEffect(() => {
    if (!documentId || Number.isNaN(documentId)) return;
    if (loadedDocRef.current === documentId) return;
    loadedDocRef.current = documentId;
    const reqId = ++reqIdRef.current;

    setSessions([]);
    setSession(null);
    setError(null);
    pendingPinsRef.current = [];

    (async () => {
      try {
        const list = await listChatSessions(documentId);
        if (reqIdRef.current !== reqId) return;
        const target = list[0] ?? (await createChatSession(documentId));
        if (reqIdRef.current !== reqId) return;
        setSessions(list.length ? list : [target]);
        setSession(target);
        // Flush any pins requested before the session finished loading.
        if (pendingPinsRef.current.length) {
          const queued = pendingPinsRef.current;
          pendingPinsRef.current = [];
          try {
            const merged = [...(target.pinned_context ?? []), ...queued];
            const updated = await updateChatSession(documentId, target.id, {
              pinned_context: merged,
            });
            if (reqIdRef.current !== reqId) return;
            setSessions((prev) => prev.map((s) => (s.id === target.id ? updated : s)));
            setSession((prev) => (prev && prev.id === target.id ? updated : prev));
          } catch {
            /* Non-fatal: queued pins are dropped if the flush fails. */
          }
        }
      } catch (err) {
        if (reqIdRef.current !== reqId) return;
        setError(err instanceof Error ? err.message : 'Failed to load chat session');
      }
    })();
  }, [documentId]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const activeSessionId = session?.id ?? null;
  const contextScope = session?.context_scope ?? 'auto';
  const pins = session?.pinned_context ?? [];

  const patchActiveSession = useCallback((partial: Partial<ApiChatSession>) => {
    const id = sessionRef.current?.id;
    if (id == null) return;
    setSession((prev) => (prev && prev.id === id ? { ...prev, ...partial } : prev));
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, ...partial } : s)));
    if (sessionRef.current && sessionRef.current.id === id) {
      sessionRef.current = { ...sessionRef.current, ...partial };
    }
    sessionsRef.current = sessionsRef.current.map((s) =>
      s.id === id ? { ...s, ...partial } : s,
    );
  }, []);

  const commitActivePatch = useCallback(
    async (
      patch: Partial<Pick<ApiChatSession, 'title' | 'context_scope' | 'pinned_context'>>,
      optimistic: Partial<ApiChatSession>,
      fallback: string,
    ) => {
      const active = sessionRef.current;
      if (!active) return;
      const id = active.id;
      const before: Partial<ApiChatSession> = {};
      if ('title' in patch) before.title = active.title;
      if ('context_scope' in patch) before.context_scope = active.context_scope;
      if ('pinned_context' in patch) before.pinned_context = active.pinned_context;
      patchActiveSession(optimistic);
      try {
        const updated = await updateChatSession(documentId, id, patch);
        setSessions((prev) => prev.map((s) => (s.id === id ? updated : s)));
        setSession((prev) => (prev && prev.id === id ? updated : prev));
      } catch (err) {
        setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, ...before } : s)));
        setSession((prev) => (prev && prev.id === id ? { ...prev, ...before } : prev));
        sessionsRef.current = sessionsRef.current.map((s) =>
          s.id === id ? { ...s, ...before } : s,
        );
        if (sessionRef.current && sessionRef.current.id === id) {
          sessionRef.current = { ...sessionRef.current, ...before };
        }
        setError(err instanceof Error ? err.message : fallback);
      }
    },
    [documentId, patchActiveSession],
  );

  const switchSession = useCallback((id: number) => {
    // No message loading here — the active session drives the thread id and
    // ReaderAssistant hydrates the transcript on (re)mount.
    setSession((prev) => {
      if (prev?.id === id) return prev;
      const target = sessionsRef.current.find((s) => s.id === id);
      return target ?? prev;
    });
    setError(null);
  }, []);

  const startNewSession = useCallback(async () => {
    try {
      const next = await createChatSession(documentId);
      setSessions((prev) => [next, ...prev]);
      setSession(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start new session');
    }
  }, [documentId]);

  const renameSession = useCallback(
    async (id: number, title: string) => {
      const prevTitle =
        (sessionsRef.current.find((s) => s.id === id) ?? sessionRef.current)?.title ?? '';
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)));
      setSession((prev) => (prev && prev.id === id ? { ...prev, title } : prev));
      try {
        const updated = await updateChatSession(documentId, id, { title });
        setSessions((prev) => prev.map((s) => (s.id === id ? updated : s)));
        setSession((prev) => (prev && prev.id === id ? updated : prev));
      } catch (err) {
        setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title: prevTitle } : s)));
        setSession((prev) => (prev && prev.id === id ? { ...prev, title: prevTitle } : prev));
        setError(err instanceof Error ? err.message : 'Failed to rename session');
      }
    },
    [documentId],
  );

  const deleteSession = useCallback(
    async (id: number) => {
      try {
        await deleteChatSession(documentId, id);
        const remaining = sessionsRef.current.filter((s) => s.id !== id);
        setSessions(remaining);
        if (id !== sessionRef.current?.id) return;

        if (remaining.length) {
          setSession(remaining[0]);
          setError(null);
        } else {
          try {
            const next = await createChatSession(documentId);
            setSessions([next]);
            setSession(next);
            setError(null);
          } catch (err) {
            setSession(null);
            setError(err instanceof Error ? err.message : 'Failed to start new session');
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete session');
      }
    },
    [documentId],
  );

  const refreshSessions = useCallback(async () => {
    const reqId = ++reqIdRef.current;
    try {
      const list = await listChatSessions(documentId);
      if (reqIdRef.current !== reqId) return;
      setSessions(list);
      // Keep the active session in sync (its title may have just been derived).
      const activeId = sessionRef.current?.id;
      if (activeId != null) {
        const refreshed = list.find((s) => s.id === activeId);
        if (refreshed) setSession(refreshed);
      }
    } catch {
      /* Non-fatal: keep the current list if the refetch fails. */
    }
  }, [documentId]);

  const setContextScope = useCallback(
    async (scope: ChatContextScope) => {
      await commitActivePatch(
        { context_scope: scope },
        { context_scope: scope },
        'Failed to update context scope',
      );
    },
    [commitActivePatch],
  );

  const addPin = useCallback(
    async (text: string, page: number) => {
      const label = text.trim().slice(0, 40);
      if (!label) return;
      const pin: ChatPin = { page, text: text.trim(), label };
      const active = sessionRef.current;
      if (!active) {
        pendingPinsRef.current = [...pendingPinsRef.current, pin];
        return;
      }
      const next = [...(active.pinned_context ?? []), pin];
      await commitActivePatch(
        { pinned_context: next },
        { pinned_context: next },
        'Failed to pin context',
      );
    },
    [commitActivePatch],
  );

  const removePin = useCallback(
    async (index: number) => {
      const current = sessionRef.current?.pinned_context ?? [];
      const next = current.filter((_, i) => i !== index);
      await commitActivePatch(
        { pinned_context: next },
        { pinned_context: next },
        'Failed to remove pin',
      );
    },
    [commitActivePatch],
  );

  const clearPins = useCallback(async () => {
    await commitActivePatch(
      { pinned_context: [] },
      { pinned_context: [] },
      'Failed to clear pins',
    );
  }, [commitActivePatch]);

  return {
    sessions,
    activeSession: session,
    activeSessionId,
    error,
    switchSession,
    startNewSession,
    renameSession,
    deleteSession,
    refreshSessions,
    contextScope,
    setContextScope,
    pins,
    addPin,
    removePin,
    clearPins,
  };
}
