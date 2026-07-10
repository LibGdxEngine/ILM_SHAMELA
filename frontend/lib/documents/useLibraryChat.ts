'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useCopilotChatInternal, useThreads } from '@copilotkit/react-core';

import {
  ApiLibrarySession,
  createLibrarySession,
  deleteLibrarySession,
  listLibraryMessages,
  listLibrarySessions,
  persistLibraryMessages,
  updateLibrarySession,
} from '../api/library-chat';

/** AG-UI message shape returned by `useCopilotChatInternal()` in this build. */
export interface LibraryAguiMessage {
  id: string;
  role: string;
  content?: unknown;
}

/** Content is a plain string for the library agent; be defensive about parts. */
export function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p) =>
        p && typeof p === 'object' && 'text' in p
          ? String((p as { text?: unknown }).text ?? '')
          : '',
      )
      .join('');
  }
  return '';
}

export function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `msg-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }
}

export interface UseLibraryChatResult {
  /** Raw CopilotKit message array (render user/assistant turns from this). */
  messages: LibraryAguiMessage[];
  isLoading: boolean;
  /** Send a user turn through CopilotKit (mints an AG-UI id). */
  send: (content: string) => void;
  stopGeneration: () => void;
  /** All of the user's library sessions, most-recent first. */
  sessions: ApiLibrarySession[];
  activeSessionId: number | null;
  switchSession: (id: number) => Promise<void>;
  startNewSession: () => Promise<void>;
  renameSession: (id: number, title: string) => Promise<void>;
  deleteSession: (id: number) => Promise<void>;
  error: string | null;
}

/** localStorage key for the last-active session id (restore on reload). */
const ACTIVE_KEY = 'ilm.docs.assistantSession';

function readActiveId(): number | null {
  try {
    const raw = window.localStorage.getItem(ACTIVE_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeActiveId(id: number): void {
  try {
    window.localStorage.setItem(ACTIVE_KEY, String(id));
  } catch {
    /* ignore */
  }
}

/**
 * Owns the library-assistant conversation sessions and bridges them to
 * CopilotKit's classic thread primitives.
 *
 * CopilotKit stores nothing durable here (the sidecar has only an in-RAM
 * checkpointer), so Django is the source of truth: sessions and per-thread
 * transcripts live in `LibraryChatSession`/`LibraryChatMessage`. This hook:
 *  - restores the last-active session on mount (or creates one), imperatively
 *    switching the CopilotKit thread via `setThreadId` and hydrating the
 *    transcript via `setMessages`;
 *  - persists each completed turn to Django on the `isLoading` falling edge
 *    (append is idempotent by client_id, so repeated syncs are safe);
 *  - exposes switch/new/rename/delete, guarded while a run is in flight.
 */
export function useLibraryChat(): UseLibraryChatResult {
  const { messages, sendMessage, setMessages, isLoading, stopGeneration } =
    useCopilotChatInternal();
  const { threadId, setThreadId } = useThreads();

  const [sessions, setSessions] = useState<ApiLibrarySession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Latest-value refs so effects/handlers don't read stale render closures.
  const sessionsRef = useRef<ApiLibrarySession[]>([]);
  const activeSessionIdRef = useRef<number | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // Persistence bookkeeping.
  const lastPersistedIdRef = useRef<string | null>(null);
  const prevLoadingRef = useRef(false);
  // History to hydrate once the target threadId has committed (see effect).
  const pendingHistoryRef = useRef<{
    tid: string;
    history: LibraryAguiMessage[];
    lastId: string | null;
  } | null>(null);
  const hasRestoredRef = useRef(false);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  const commitSessions = useCallback((next: ApiLibrarySession[]) => {
    sessionsRef.current = next;
    setSessions(next);
  }, []);

  // Point CopilotKit at a session's thread and stage its transcript. The
  // history is applied by the threadId effect below — AFTER the thread switch
  // commits — so it can't be clobbered by any reset-on-threadId behaviour.
  const loadSession = useCallback(
    async (target: ApiLibrarySession) => {
      setActiveSessionId(target.id);
      activeSessionIdRef.current = target.id;
      writeActiveId(target.id);
      try {
        const history = await listLibraryMessages(target.id);
        const agui: LibraryAguiMessage[] = history.map((m) => ({
          id: m.client_id,
          role: m.role,
          content: m.content,
        }));
        pendingHistoryRef.current = {
          tid: target.thread_id,
          history: agui,
          lastId: agui.length ? agui[agui.length - 1].id : null,
        };
        setThreadId(target.thread_id);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load conversation');
      }
    },
    [setThreadId],
  );

  // Apply staged history once the live threadId matches the target thread.
  useEffect(() => {
    const pending = pendingHistoryRef.current;
    if (!pending || threadId !== pending.tid) return;
    setMessages(pending.history as Parameters<typeof setMessages>[0]);
    lastPersistedIdRef.current = pending.lastId;
    pendingHistoryRef.current = null;
  }, [threadId, setMessages]);

  // Bootstrap: restore the last-active session (or the most recent, or create
  // one). Guarded so React StrictMode's double-invoke can't create twice.
  useEffect(() => {
    if (hasRestoredRef.current) return;
    hasRestoredRef.current = true;
    (async () => {
      try {
        const list = await listLibrarySessions();
        commitSessions(list);
        const savedId = readActiveId();
        let target =
          (savedId != null && list.find((s) => s.id === savedId)) || list[0] || null;
        if (!target) {
          target = await createLibrarySession(newId());
          commitSessions([target]);
        }
        await loadSession(target);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load conversations');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist completed turns on the isLoading falling edge. Watching messages
  // directly would fire on every streamed token and on reset()/setMessages.
  const syncMessages = useCallback(async () => {
    const sid = activeSessionIdRef.current;
    if (sid == null) return;
    const msgs = (messagesRef.current ?? []) as unknown as LibraryAguiMessage[];
    // Select by ARRAY POSITION, never by id order (ids are random UUIDs).
    const anchor = lastPersistedIdRef.current;
    const startIdx = anchor ? msgs.findIndex((m) => m.id === anchor) : -1;
    const toSave = msgs
      .slice(startIdx + 1)
      .filter(
        (m) =>
          (m.role === 'user' || m.role === 'assistant') && messageText(m.content).trim(),
      )
      .map((m) => ({
        client_id: m.id,
        role: m.role as 'user' | 'assistant',
        content: messageText(m.content),
      }));
    if (!toSave.length) return;
    try {
      const res = await persistLibraryMessages(sid, toSave);
      lastPersistedIdRef.current = toSave[toSave.length - 1].client_id;
      // The active session just bumped updated_at → float it to the top and
      // adopt the server-derived title.
      const current = sessionsRef.current;
      const active = current.find((s) => s.id === sid);
      if (active) {
        const rest = current.filter((s) => s.id !== sid);
        commitSessions([
          {
            ...active,
            title: res.title || active.title,
            message_count: active.message_count + toSave.length,
            updated_at: new Date().toISOString(),
          },
          ...rest,
        ]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save conversation');
    }
  }, [commitSessions]);

  useEffect(() => {
    if (prevLoadingRef.current && !isLoading) void syncMessages();
    prevLoadingRef.current = isLoading;
  }, [isLoading, syncMessages]);

  const send = useCallback(
    (raw: string) => {
      const content = raw.trim();
      if (!content || isLoading) return;
      const payload = { id: newId(), role: 'user', content } as Parameters<
        typeof sendMessage
      >[0];
      void sendMessage(payload);
    },
    [sendMessage, isLoading],
  );

  const switchSession = useCallback(
    async (id: number) => {
      if (isLoading) return;
      if (id === activeSessionIdRef.current) return;
      const target = sessionsRef.current.find((s) => s.id === id);
      if (!target) return;
      await loadSession(target);
    },
    [isLoading, loadSession],
  );

  const startNewSession = useCallback(async () => {
    if (isLoading) return;
    try {
      const next = await createLibrarySession(newId());
      commitSessions([next, ...sessionsRef.current.filter((s) => s.id !== next.id)]);
      await loadSession(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start a new conversation');
    }
  }, [isLoading, commitSessions, loadSession]);

  const renameSession = useCallback(async (id: number, title: string) => {
    const before = sessionsRef.current.find((s) => s.id === id)?.title ?? '';
    commitSessions(
      sessionsRef.current.map((s) => (s.id === id ? { ...s, title } : s)),
    );
    try {
      const updated = await updateLibrarySession(id, { title });
      commitSessions(
        sessionsRef.current.map((s) => (s.id === id ? updated : s)),
      );
    } catch (err) {
      commitSessions(
        sessionsRef.current.map((s) => (s.id === id ? { ...s, title: before } : s)),
      );
      setError(err instanceof Error ? err.message : 'Failed to rename conversation');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commitSessions]);

  const deleteSession = useCallback(
    async (id: number) => {
      if (isLoading) return;
      try {
        await deleteLibrarySession(id);
        const remaining = sessionsRef.current.filter((s) => s.id !== id);
        commitSessions(remaining);
        if (id !== activeSessionIdRef.current) return;
        if (remaining.length) {
          await loadSession(remaining[0]);
        } else {
          const next = await createLibrarySession(newId());
          commitSessions([next]);
          await loadSession(next);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete conversation');
      }
    },
    [isLoading, commitSessions, loadSession],
  );

  return {
    messages: (messages ?? []) as unknown as LibraryAguiMessage[],
    isLoading,
    send,
    stopGeneration,
    sessions,
    activeSessionId,
    switchSession,
    startNewSession,
    renameSession,
    deleteSession,
    error,
  };
}

export default useLibraryChat;
