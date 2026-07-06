'use client';

import {
  ChangeEvent,
  KeyboardEvent,
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { useI18n } from '@/components/i18n/I18nProvider';

export interface AssistantInputHandle {
  /** Programmatically set the textarea text and focus it. Used by selection-to-AI. */
  setDraft: (text: string) => void;
}

interface AssistantInputProps {
  isStreaming: boolean;
  onSend: (content: string) => void;
}

/**
 * Autogrowing textarea + send button. Cmd/Ctrl+Enter to send. The reading
 * context (page / pins) is surfaced by AssistantContextBar, mounted above this.
 */
const AssistantInput = forwardRef<AssistantInputHandle, AssistantInputProps>(
  function AssistantInput({ isStreaming, onSend }, ref) {
    const { t } = useI18n();
    const [value, setValue] = useState('');
    const taRef = useRef<HTMLTextAreaElement>(null);

    useImperativeHandle(ref, () => ({
      setDraft: (text) => {
        setValue(text);
        // Defer focus until after the render flush sizes the textarea.
        window.setTimeout(() => taRef.current?.focus(), 0);
      },
    }));

    useLayoutEffect(() => {
      const ta = taRef.current;
      if (!ta) return;
      ta.style.height = 'auto';
      const next = Math.min(ta.scrollHeight, 5 * 24);
      ta.style.height = `${next}px`;
    }, [value]);

    const handleSend = () => {
      const trimmed = value.trim();
      if (!trimmed || isStreaming) return;
      onSend(trimmed);
      setValue('');
    };

    const handleKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        handleSend();
      }
    };

    return (
      <div className="border-t border-border bg-bg-2/40 px-3 py-3">
        <div className="mb-2 flex items-center justify-end text-[11px]">
          <span className="text-text-3">
            {t('assistant.input.sendHint', '⌘+Enter to send')}
          </span>
        </div>
        <div className="flex items-end gap-2 rounded-xl border border-border bg-card p-2 shadow-whisper">
          <textarea
            ref={taRef}
            value={value}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setValue(event.target.value)}
            onKeyDown={handleKey}
            rows={1}
            placeholder={t(
              'assistant.input.placeholder',
              'Ask anything about this book…',
            )}
            disabled={isStreaming}
            className="min-h-[24px] flex-1 resize-none bg-transparent text-[13.5px] leading-6 text-text placeholder:text-text-3 focus:outline-none disabled:opacity-60"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={isStreaming || !value.trim()}
            aria-label={t('assistant.input.send', 'Send')}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-white shadow-[0_4px_12px_-4px_rgba(185,115,64,0.55)] transition-colors hover:bg-[#a86432] disabled:cursor-not-allowed disabled:bg-accent/40"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="rtl:-scale-x-100">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    );
  },
);

export default AssistantInput;
