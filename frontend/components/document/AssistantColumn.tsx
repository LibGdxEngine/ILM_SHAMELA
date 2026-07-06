'use client';

import { forwardRef, useImperativeHandle, useRef } from 'react';

import { useI18n } from '@/components/i18n/I18nProvider';
import { useChat } from '@/lib/reader/useChat';

import AssistantContextBar from './AssistantContextBar';
import AssistantInput, { AssistantInputHandle } from './AssistantInput';
import AssistantMessageList from './AssistantMessageList';
import AssistantSessionMenu from './AssistantSessionMenu';
import PanelIconButton from './PanelIconButton';

interface AssistantColumnProps {
  documentId: number;
  currentPage: number;
  /** Click-to-jump handler — fired when a citation chip is clicked. */
  onCitationClick: (page: number) => void;
  /** Ask the host to reveal the assistant (it lives in a header-triggered drawer). */
  onRequestOpen?: () => void;
  /** Close the assistant panel. */
  onClose?: () => void;
  /** Pinned = docked column; unpinned = floating overlay. */
  pinned?: boolean;
  onTogglePin?: () => void;
}

export interface AssistantColumnHandle {
  /** Pre-populate the input with a draft string (e.g. from a selection). */
  setDraft: (text: string) => void;
  /** Pin a selected snippet as persistent context (e.g. from a selection). */
  addPin: (text: string, page: number) => void;
  /** Reveal the assistant and immediately send a message (e.g. translate/summarize a selection). */
  ask: (text: string) => void;
}

const SUGGESTED_PROMPT_KEYS: Array<{ key: string; fallback: string }> = [
  { key: 'assistant.suggested.summarize', fallback: 'Summarize this page' },
  { key: 'assistant.suggested.find', fallback: 'Find where this book discusses…' },
  { key: 'assistant.suggested.glossary', fallback: 'Define the key terms here' },
  { key: 'assistant.suggested.context', fallback: 'What is the broader context?' },
];

const AssistantColumn = forwardRef<AssistantColumnHandle, AssistantColumnProps>(
  function AssistantColumn({ documentId, currentPage, onCitationClick, onRequestOpen, onClose, pinned, onTogglePin }, ref) {
    const { t } = useI18n();
    const chat = useChat(documentId);
    const inputRef = useRef<AssistantInputHandle | null>(null);
    /** Stashed draft consumed by AssistantInput on mount (e.g. when opened from a selection). */
    const pendingDraftRef = useRef<string | null>(null);

    useImperativeHandle(ref, () => ({
      setDraft: (text) => {
        onRequestOpen?.();
        if (inputRef.current) {
          inputRef.current.setDraft(text);
        } else {
          pendingDraftRef.current = text;
        }
      },
      addPin: (text, page) => {
        onRequestOpen?.();
        void chat.addPin(text, page);
      },
      ask: (text) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        onRequestOpen?.();
        void chat.send(trimmed, currentPage);
      },
    }));

    const showSuggestions = chat.messages.length === 0 && !chat.isStreaming;

    return (
      <div className="flex h-full flex-col">
        {/* Header strip */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-accent" aria-hidden>✦</span>
            <h2 className="font-reem-kufi text-[15px] font-medium text-text">
              {t('assistant.title', 'AI assistant')}
            </h2>
            {chat.isStreaming && (
              <span
                className="ms-1 inline-block h-1.5 w-1.5 animate-live-dot rounded-full bg-accent"
                aria-label={t('assistant.streaming.thinking', 'Thinking…')}
              />
            )}
            {chat.toolStatus && (
              <span className="ms-1 text-[12px] text-text-3">{chat.toolStatus}</span>
            )}
          </div>
          <div className="flex items-center gap-0.5">
            <AssistantSessionMenu
              sessions={chat.sessions}
              activeSessionId={chat.activeSessionId}
              onSwitch={chat.switchSession}
              onNew={chat.startNewSession}
              onRename={chat.renameSession}
              onDelete={chat.deleteSession}
              disabled={chat.isStreaming}
            />
            {onTogglePin && (
              <PanelIconButton
                onClick={onTogglePin}
                active={pinned}
                label={t(pinned ? 'reader.panel.unpin' : 'reader.panel.pin', pinned ? 'إلغاء التثبيت' : 'تثبيت')}
                icon="pin"
              />
            )}
            {onClose && (
              <PanelIconButton onClick={onClose} label={t('reader.closePanel', 'إغلاق')} icon="close" />
            )}
          </div>
        </div>

        {chat.error && (
          <div className="border-b border-red-500/20 bg-red-500/5 px-4 py-2 text-[12px] text-red-700">
            {chat.error}
          </div>
        )}

        {showSuggestions ? (
          <div className="flex-1 overflow-y-auto px-4 py-6">
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 2l2.39 4.84L20 8l-4 3.9.94 5.47L12 14.77l-4.94 2.6L8 11.9 4 8l5.61-1.16L12 2z" />
              </svg>
            </div>
            <p className="font-reem-kufi text-[15px] font-medium text-text">
              {t('assistant.empty.heading', 'Ask anything about this book')}
            </p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-text-2">
              {t(
                'assistant.empty.subheading',
                'Pick a starter or type your own question.',
              )}
            </p>
            <div className="mt-5 flex flex-col gap-2">
              {SUGGESTED_PROMPT_KEYS.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  onClick={() => void chat.send(t(entry.key, entry.fallback), currentPage)}
                  className="rounded-full border border-border bg-card px-3.5 py-2 text-[13px] text-text-2 transition-colors hover:-translate-y-[1px] hover:border-accent/30 hover:text-text"
                >
                  {t(entry.key, entry.fallback)}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <AssistantMessageList
            messages={chat.messages}
            pendingAssistantText={chat.pendingAssistantText}
            isStreaming={chat.isStreaming}
            onCitationClick={onCitationClick}
          />
        )}

        <AssistantContextBar
          scope={chat.contextScope}
          onScopeChange={chat.setContextScope}
          pins={chat.pins}
          onRemovePin={chat.removePin}
          onClearPins={chat.clearPins}
          currentPage={currentPage}
          disabled={chat.isStreaming}
        />

        <AssistantInput
          ref={(handle) => {
            inputRef.current = handle;
            if (handle && pendingDraftRef.current) {
              handle.setDraft(pendingDraftRef.current);
              pendingDraftRef.current = null;
            }
          }}
          isStreaming={chat.isStreaming}
          onSend={(content) => void chat.send(content, currentPage)}
        />
      </div>
    );
  },
);

export default AssistantColumn;
