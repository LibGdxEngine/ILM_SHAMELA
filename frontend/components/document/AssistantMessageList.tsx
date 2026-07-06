'use client';

import { useEffect, useRef } from 'react';

import { useI18n } from '@/components/i18n/I18nProvider';
import type { ApiChatCitation, ApiChatMessage } from '@/lib/api/reader';

interface AssistantMessageListProps {
  messages: ApiChatMessage[];
  /** Live-streaming assistant text for the in-flight reply (empty if idle). */
  pendingAssistantText: string;
  isStreaming: boolean;
  onCitationClick: (page: number) => void;
}

/**
 * Scrolling message list with citation chips. Auto-scrolls to bottom on new
 * messages and during streaming.
 */
export default function AssistantMessageList({
  messages,
  pendingAssistantText,
  isStreaming,
  onCitationClick,
}: AssistantMessageListProps) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, pendingAssistantText]);

  return (
    <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} onCitationClick={onCitationClick} />
      ))}

      {isStreaming && (
        <MessageBubble
          message={{
            id: -1,
            role: 'assistant',
            content: pendingAssistantText,
            citations: [],
            context_page: null,
            created_at: '',
          }}
          onCitationClick={onCitationClick}
          isStreaming
        />
      )}

      {messages.length === 0 && !isStreaming && (
        <div className="pt-8 text-center text-[12.5px] text-text-3">
          {t('assistant.empty.heading', 'Ask anything about this book')}
        </div>
      )}
    </div>
  );
}

function MessageBubble({
  message,
  onCitationClick,
  isStreaming,
}: {
  message: ApiChatMessage;
  onCitationClick: (page: number) => void;
  isStreaming?: boolean;
}) {
  const isUser = message.role === 'user';
  const { rendered, inlineCitations } = renderWithCitations(message.content);

  return (
    <div className={isUser ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className={[
          'max-w-[88%] rounded-xl px-3 py-2 text-[13.5px] leading-relaxed',
          isUser
            ? 'bg-accent-soft text-text'
            : 'bg-card-2 border border-border text-text',
        ].join(' ')}
      >
        <div className="whitespace-pre-wrap break-words">
          {rendered}
          {isStreaming && (
            <span className="ms-1 inline-block h-3 w-1 animate-cursor-blink bg-accent align-middle" />
          )}
        </div>
        {(inlineCitations.length > 0 || (message.citations?.length ?? 0) > 0) && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(message.citations.length > 0 ? message.citations : inlineCitations).map((c, i) => (
              <CitationChip key={i} citation={c} onClick={() => onCitationClick(c.page)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CitationChip({
  citation,
  onClick,
}: {
  citation: ApiChatCitation;
  onClick: () => void;
}) {
  const { t } = useI18n();
  // Prefer the printed-edition reference (موافقة المطبوع) when the backend
  // mapped this page; clicking still jumps to the digital page.
  const label =
    citation.printed_page != null && citation.volume != null
      ? t('reader.editionPageLabel', 'ج{volume} ص{page}', {
          volume: citation.volume,
          page: citation.printed_page,
        })
      : t('assistant.citation.page', 'Page {page}', { page: citation.page });
  return (
    <button
      type="button"
      onClick={onClick}
      title={citation.quote}
      className="inline-flex items-center gap-1 rounded-lg bg-accent-soft px-2 py-0.5 text-[11px] text-accent transition-colors hover:bg-accent/15"
    >
      <span aria-hidden>↗</span>
      {label}
    </button>
  );
}

/**
 * Strip <cite page="N">text</cite> tags from the message body, return the
 * plain text and any in-tag citations as a backup if the API didn't surface
 * them via the separate `citations` field (e.g. during streaming).
 */
function renderWithCitations(content: string): {
  rendered: string;
  inlineCitations: ApiChatCitation[];
} {
  const citations: ApiChatCitation[] = [];
  const rendered = content.replace(
    /<cite\s+page="(\d+)">([\s\S]*?)<\/cite>/gi,
    (_match, page, quote) => {
      citations.push({ page: parseInt(page, 10), quote: quote.trim() });
      return quote;
    },
  );
  return { rendered, inlineCitations: citations };
}
