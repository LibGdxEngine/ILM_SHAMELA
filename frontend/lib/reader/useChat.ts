'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ApiChatCitation,
  ApiChatMessage,
  ApiChatSession,
  createChatSession,
  listChatMessages,
  listChatSessions,
  streamChatMessage,
} from '../api/reader';

export interface UseChatResult {
  /** Current session id (null until the first one is loaded/created). */
  sessionId: number | null;
  messages: ApiChatMessage[];
  /** Partial assistant text being streamed for the in-flight message. */
  pendingAssistantText: string;
  /** Friendly label for the tool the assistant is currently running, or null. */
  toolStatus: string | null;
  isStreaming: boolean;
  error: string | null;
  send: (content: string, contextPage: number | null) => Promise<void>;
  startNewSession: () => Promise<void>;
}

/** Human-friendly status shown while the assistant runs a backend tool. */
const TOOL_LABELS: Record<string, string> = {
  search_in_document: 'Searching this book…',
};

/**
 * Owns a single chat session per document.
 *
 * On mount: finds the most-recent session (or creates one) and loads its
 * messages. `send()` POSTs and consumes the SSE stream, surfacing deltas via
 * `pendingAssistantText` and committing the message to `messages` on done.
 */
export function useChat(documentId: number): UseChatResult {
  const [session, setSession] = useState<ApiChatSession | null>(null);
  const [messages, setMessages] = useState<ApiChatMessage[]>([]);
  const [pendingAssistantText, setPendingAssistantText] = useState('');
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initRef = useRef(false);

  // Bootstrap: load or create a session for this document.
  useEffect(() => {
    if (!documentId || Number.isNaN(documentId)) return;
    if (initRef.current) return;
    initRef.current = true;

    (async () => {
      try {
        const sessions = await listChatSessions(documentId);
        const target = sessions[0] ?? (await createChatSession(documentId));
        setSession(target);
        const history = await listChatMessages(documentId, target.id);
        setMessages(history);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load chat session');
      }
    })();
  }, [documentId]);

  const send = useCallback(
    async (content: string, contextPage: number | null) => {
      if (!session) return;
      const trimmed = content.trim();
      if (!trimmed) return;

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

        for await (const event of streamChatMessage(documentId, session.id, trimmed, contextPage)) {
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
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Chat request failed');
      } finally {
        setIsStreaming(false);
        setPendingAssistantText('');
        setToolStatus(null);
      }
    },
    [documentId, session],
  );

  const startNewSession = useCallback(async () => {
    try {
      const next = await createChatSession(documentId);
      setSession(next);
      setMessages([]);
      setPendingAssistantText('');
      setToolStatus(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start new session');
    }
  }, [documentId]);

  return {
    sessionId: session?.id ?? null,
    messages,
    pendingAssistantText,
    toolStatus,
    isStreaming,
    error,
    send,
    startNewSession,
  };
}
