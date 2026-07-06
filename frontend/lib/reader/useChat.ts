'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ApiChatCitation,
  ApiChatMessage,
  ApiChatSession,
  ChatContextScope,
  ChatPin,
  createChatSession,
  deleteChatSession,
  listChatMessages,
  listChatSessions,
  streamChatMessage,
  updateChatSession,
} from '../api/reader';

export interface UseChatResult {
  /** Active session id (null until the first one is loaded/created). Alias of `activeSessionId`. */
  sessionId: number | null;
  /** Active session id (null until the first one is loaded/created). */
  activeSessionId: number | null;
  /** All chat sessions for this document, most-recent first. */
  sessions: ApiChatSession[];
  messages: ApiChatMessage[];
  /** Partial assistant text being streamed for the in-flight message. */
  pendingAssistantText: string;
  /** Friendly label for the tool the assistant is currently running, or null. */
  toolStatus: string | null;
  isStreaming: boolean;
  error: string | null;
  send: (content: string, contextPage: number | null) => Promise<void>;
  switchSession: (id: number) => Promise<void>;
  startNewSession: () => Promise<void>;
  renameSession: (id: number, title: string) => Promise<void>;
  deleteSession: (id: number) => Promise<void>;
  /** Context scope of the active session (defaults to 'auto'). */
  contextScope: ChatContextScope;
  setContextScope: (scope: ChatContextScope) => Promise<void>;
  /** Pinned context snippets for the active session. */
  pins: ChatPin[];
  addPin: (text: string, page: number) => Promise<void>;
  removePin: (index: number) => Promise<void>;
  clearPins: () => Promise<void>;
}

/** Human-friendly status shown while the assistant runs a backend tool. */
const TOOL_LABELS: Record<string, string> = {
  search_in_document: 'Searching this book…',
};

/**
 * Owns the chat sessions for a single document.
 *
 * On document switch: resets all state, then finds the most-recent session (or
 * creates one) and loads its messages. `send()` POSTs and consumes the SSE
 * stream, surfacing deltas via `pendingAssistantText` and committing the
 * message to `messages` on done. Session management (switch/new/rename/delete)
 * and per-session context (scope + pins) are also exposed.
 */
export function useChat(documentId: number): UseChatResult {
  const [sessions, setSessions] = useState<ApiChatSession[]>([]);
  const [session, setSession] = useState<ApiChatSession | null>(null);
  const [messages, setMessages] = useState<ApiChatMessage[]>([]);
  const [pendingAssistantText, setPendingAssistantText] = useState('');
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which document the current state belongs to (replaces the old init flag so a
  // document switch re-bootstraps instead of keeping the previous book's chat).
  const loadedDocRef = useRef<number | null>(null);
  // Monotonic request id used to ignore results from superseded async loads.
  const reqIdRef = useRef(0);
  // Mirror the latest committed session/sessions so synchronous action handlers
  // (e.g. two rapid pin clicks in one tick) compute from fresh state instead of
  // a stale render closure. Synced post-render by the effects below and advanced
  // eagerly by the optimistic patch helpers.
  const sessionRef = useRef<ApiChatSession | null>(null);
  const sessionsRef = useRef<ApiChatSession[]>([]);
  // Pins requested before a session finished loading; flushed on bootstrap.
  const pendingPinsRef = useRef<ChatPin[]>([]);

  // Bootstrap: load or create a session for this document. Re-runs on document
  // switch, resetting all chat state first (BOOK-SWITCH BUG FIX).
  useEffect(() => {
    if (!documentId || Number.isNaN(documentId)) return;
    if (loadedDocRef.current === documentId) return;
    loadedDocRef.current = documentId;
    const reqId = ++reqIdRef.current;

    setSessions([]);
    setSession(null);
    setMessages([]);
    setPendingAssistantText('');
    setToolStatus(null);
    setError(null);
    // Drop pins queued for a previous document; pins queued for THIS document
    // are pushed later (during the async gap below) and survive.
    pendingPinsRef.current = [];

    (async () => {
      try {
        const list = await listChatSessions(documentId);
        if (reqIdRef.current !== reqId) return;
        const target = list[0] ?? (await createChatSession(documentId));
        if (reqIdRef.current !== reqId) return;
        setSessions(list.length ? list : [target]);
        setSession(target);
        const history = await listChatMessages(documentId, target.id);
        if (reqIdRef.current !== reqId) return;
        setMessages(history);
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
            // Non-fatal: queued pins are dropped if the flush fails.
          }
        }
      } catch (err) {
        if (reqIdRef.current !== reqId) return;
        setError(err instanceof Error ? err.message : 'Failed to load chat session');
      }
    })();
  }, [documentId]);

  // Keep the refs in sync with committed state (runs post-render/commit).
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  // Derived view of the active session (computed in render, not stored).
  const activeSessionId = session?.id ?? null;
  const contextScope = session?.context_scope ?? 'auto';
  const pins = session?.pinned_context ?? [];

  // Optimistically patch the active session in both `session` and `sessions`,
  // advancing the refs synchronously so a same-tick follow-up sees the change.
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

  // Shared optimistic-PATCH-rollback cycle for context scope + pins (active
  // session only). Rollback restores ONLY the patched fields for this session,
  // so a failed patch can't clobber an unrelated concurrent update.
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

  const send = useCallback(
    async (content: string, contextPage: number | null) => {
      if (!session) return;
      const trimmed = content.trim();
      if (!trimmed) return;

      const activeId = session.id;
      // Capture before the optimistic append so the auto-title refetch only runs
      // for the first exchange in a fresh session.
      const wasFirst = messages.length === 0;

      setError(null);
      setIsStreaming(true);
      setPendingAssistantText('');
      setToolStatus(null);

      // Optimistic user message; the server persists its own copy on receipt.
      const optimisticUser: ApiChatMessage = {
        id: Date.now() * -1,
        role: 'user',
        content: trimmed,
        citations: [],
        context_page: contextPage,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimisticUser]);

      try {
        let collected = '';
        let citations: ApiChatCitation[] = [];
        let messageId: number | null = null;

        for await (const event of streamChatMessage(documentId, activeId, trimmed, contextPage)) {
          if (event.type === 'delta') {
            collected += event.text;
            setPendingAssistantText(collected);
            setToolStatus(null); // first answer token clears any tool status
          } else if (event.type === 'tool') {
            setToolStatus(
              event.status === 'running'
                ? TOOL_LABELS[event.name] ?? 'Working…'
                : null,
            );
          } else if (event.type === 'done') {
            citations = event.citations;
            messageId = event.messageId;
          } else if (event.type === 'error') {
            setError(event.error);
            return;
          }
        }

        if (messageId !== null) {
          const finalMessage: ApiChatMessage = {
            id: messageId,
            role: 'assistant',
            content: collected,
            citations,
            context_page: contextPage,
            created_at: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, finalMessage]);
        }

        // Auto-title lag: the server derives a title from the first exchange.
        // Refetch and merge the title into the (still-active) session.
        if (wasFirst) {
          try {
            const list = await listChatSessions(documentId);
            const refreshed = list.find((s) => s.id === activeId);
            if (refreshed) {
              const nextTitle = refreshed.title;
              setSessions((prev) =>
                prev.map((s) => (s.id === activeId ? { ...s, title: nextTitle } : s)),
              );
              setSession((prev) =>
                prev && prev.id === activeId ? { ...prev, title: nextTitle } : prev,
              );
            }
          } catch {
            // Non-fatal: keep the current title if the refetch fails.
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Chat request failed');
      } finally {
        setIsStreaming(false);
        setPendingAssistantText('');
        setToolStatus(null);
      }
    },
    [documentId, session, messages],
  );

  const switchSession = useCallback(
    async (id: number) => {
      if (isStreaming) return;
      if (id === session?.id) return;
      const target = sessions.find((s) => s.id === id);
      if (!target) return;

      const reqId = ++reqIdRef.current;
      setSession(target);
      setMessages([]);
      setPendingAssistantText('');
      setToolStatus(null);
      setError(null);
      try {
        const history = await listChatMessages(documentId, id);
        if (reqIdRef.current !== reqId) return;
        setMessages(history);
      } catch (err) {
        if (reqIdRef.current !== reqId) return;
        setError(err instanceof Error ? err.message : 'Failed to load chat session');
      }
    },
    [documentId, session, sessions, isStreaming],
  );

  const startNewSession = useCallback(async () => {
    if (isStreaming) return;
    try {
      const next = await createChatSession(documentId);
      setSessions((prev) => [next, ...prev]);
      setSession(next);
      setMessages([]);
      setPendingAssistantText('');
      setToolStatus(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start new session');
    }
  }, [documentId, isStreaming]);

  const renameSession = useCallback(
    async (id: number, title: string) => {
      const prevTitle =
        (sessionsRef.current.find((s) => s.id === id) ?? sessionRef.current)?.title ?? '';
      // Optimistic rename (may target a non-active session).
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)));
      setSession((prev) => (prev && prev.id === id ? { ...prev, title } : prev));
      try {
        const updated = await updateChatSession(documentId, id, { title });
        setSessions((prev) => prev.map((s) => (s.id === id ? updated : s)));
        setSession((prev) => (prev && prev.id === id ? updated : prev));
      } catch (err) {
        // Restore only this session's title so a concurrent rename survives.
        setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title: prevTitle } : s)));
        setSession((prev) => (prev && prev.id === id ? { ...prev, title: prevTitle } : prev));
        setError(err instanceof Error ? err.message : 'Failed to rename session');
      }
    },
    [documentId],
  );

  const deleteSession = useCallback(
    async (id: number) => {
      if (isStreaming) return;
      try {
        await deleteChatSession(documentId, id);
        const remaining = sessions.filter((s) => s.id !== id);
        setSessions(remaining);

        if (id !== session?.id) return;

        if (remaining.length) {
          // Inline switch to the next session (avoids switchSession's streaming guard).
          const nextTarget = remaining[0];
          const reqId = ++reqIdRef.current;
          setSession(nextTarget);
          setMessages([]);
          setPendingAssistantText('');
          setToolStatus(null);
          setError(null);
          try {
            const history = await listChatMessages(documentId, nextTarget.id);
            if (reqIdRef.current !== reqId) return;
            setMessages(history);
          } catch (err) {
            if (reqIdRef.current !== reqId) return;
            setError(err instanceof Error ? err.message : 'Failed to load chat session');
          }
        } else {
          // No sessions remain — open a fresh one. If that fails, drop the
          // active session rather than leaving it pointing at the just-deleted
          // (now server-gone) session that send()/patches would target.
          try {
            const next = await createChatSession(documentId);
            setSessions([next]);
            setSession(next);
            setMessages([]);
            setPendingAssistantText('');
            setToolStatus(null);
            setError(null);
          } catch (err) {
            setSession(null);
            setMessages([]);
            setError(err instanceof Error ? err.message : 'Failed to start new session');
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete session');
      }
    },
    [documentId, session, sessions, isStreaming],
  );

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
        // Session still bootstrapping — queue and flush once it loads.
        pendingPinsRef.current = [...pendingPinsRef.current, pin];
        return;
      }
      // Read from the ref so two rapid pins in one tick accumulate instead of
      // both starting from the same stale array (which would drop the first).
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
    sessionId: activeSessionId,
    activeSessionId,
    sessions,
    messages,
    pendingAssistantText,
    toolStatus,
    isStreaming,
    error,
    send,
    switchSession,
    startNewSession,
    renameSession,
    deleteSession,
    contextScope,
    setContextScope,
    pins,
    addPin,
    removePin,
    clearPins,
  };
}
