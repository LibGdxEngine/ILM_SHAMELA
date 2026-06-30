'use client';

import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/components/i18n/I18nProvider';

interface AssistantMessage {
  id: number;
  role: 'assistant' | 'user';
  text: string;
}

interface LibraryAssistantPanelProps {
  /** Runs the query as a real library search (drives the page's search state). */
  onAsk: (query: string) => void;
  /** Hide the internal header (e.g. when hosted inside a drawer that has its own title bar). */
  hideHeader?: boolean;
}

function SparkIcon({ className, fill = 'currentColor' }: { className?: string; fill?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill={fill} aria-hidden>
      <path d="M12 2 L13.7 9 L21 11 L13.7 13 L12 22 L10.3 13 L3 11 L10.3 9 Z" />
    </svg>
  );
}

/**
 * The Reading Room's persistent AI assistant rail. There is no library-wide
 * answer endpoint, so the assistant turns a question into a real library
 * search (driving the page's search state) and acknowledges it in-thread.
 */
export default function LibraryAssistantPanel({ onAsk, hideHeader = false }: LibraryAssistantPanelProps) {
  const { t } = useI18n();
  const seq = useRef(1);
  const threadRef = useRef<HTMLDivElement>(null);

  const [messages, setMessages] = useState<AssistantMessage[]>([
    {
      id: 0,
      role: 'assistant',
      text: t('docs.rr.assistant.welcome', 'مرحبًا بك. اسألني عن أي كتاب في المكتبة وسأبحث لك في النصوص.'),
    },
  ]);
  const [draft, setDraft] = useState('');

  const suggestions = [
    t('docs.rr.assistant.suggest1', 'كتب الغزالي في التصوّف'),
    t('docs.rr.assistant.suggest2', 'أمّهات كتب الحديث'),
    t('docs.rr.assistant.suggest3', 'مؤلفات ابن سينا في الطب'),
  ];

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const ask = (raw: string) => {
    const query = raw.trim();
    if (!query) return;
    const userId = seq.current++;
    const botId = seq.current++;
    setMessages((prev) => [
      ...prev,
      { id: userId, role: 'user', text: query },
      {
        id: botId,
        role: 'assistant',
        text: t('docs.rr.assistant.searching', 'بحثتُ في المكتبة عن «{q}» — هذه أقرب النتائج في الأسفل.', { q: query }),
      },
    ]);
    onAsk(query);
    setDraft('');
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    ask(draft);
  };

  return (
    <div className="flex flex-col rounded-[15px] overflow-hidden border border-[#e7dbc1] bg-[#f7efdc] h-full min-h-[420px]">
      {/* Header */}
      {!hideHeader && (
        <div className="relative px-5 py-4 border-b border-[#e7dbc1] bg-gradient-to-br from-[#f7efdc] to-[#f0e3c6]">
          <div className="relative flex items-center gap-2.5">
            <span className="w-[34px] h-[34px] rounded-[10px] bg-[#b07d2b] flex items-center justify-center flex-shrink-0">
              <SparkIcon fill="#fcf8ee" />
            </span>
            <div className="flex-1 min-w-0">
              <div className="font-reem-kufi font-semibold text-[15.5px] text-[#2c2620] leading-tight">
                {t('docs.rr.assistant.title', 'المساعد الذكي')}
              </div>
              <div className="text-[11.5px] text-[#6e6354] mt-0.5">
                {t('docs.rr.assistant.subtitle', 'يقرأ معك ويستشهد بالمصدر')}
              </div>
            </div>
            <span className="flex items-center gap-1.5 text-[11px] text-[#2e5347] flex-shrink-0">
              <span className="w-[7px] h-[7px] rounded-full bg-[#2e5347]" aria-hidden />
              {t('docs.rr.assistant.connected', 'متّصل')}
            </span>
          </div>
        </div>
      )}

      {/* Thread */}
      <div ref={threadRef} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-4 py-4 flex flex-col gap-3.5">
        {messages.map((m) =>
          m.role === 'assistant' ? (
            <div
              key={m.id}
              dir="auto"
              className="bg-[#fcf8ee] border border-[#e7dbc1] rounded-[14px] rounded-ss-[4px] px-4 py-3 text-[13.5px] leading-[1.75] text-[#4a4236]"
            >
              {m.text}
            </div>
          ) : (
            <div
              key={m.id}
              dir="auto"
              className="self-start max-w-[90%] bg-[#b07d2b] text-[#fcf8ee] rounded-[14px] rounded-se-[4px] px-3.5 py-2.5 text-[13.5px] leading-[1.7]"
            >
              {m.text}
            </div>
          )
        )}

        {/* Suggested starter prompts */}
        <div className="flex flex-wrap gap-2 pt-1">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => ask(s)}
              className="inline-flex items-center gap-1.5 bg-[#fcf8ee] border border-[#e2d5ba] rounded-full px-3 py-1.5 text-[12px] text-[#6e6354] hover:border-[#b07d2b] hover:text-[#2c2620] transition-colors"
            >
              <SparkIcon className="w-3 h-3" fill="#b07d2b" />
              <span dir="auto">{s}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Input */}
      <form onSubmit={onSubmit} className="px-4 py-4 border-t border-[#e7dbc1]">
        <div className="flex items-center gap-2.5 bg-[#fcf8ee] border border-[#e2d5ba] rounded-[12px] px-3.5 py-2.5 focus-within:border-[#b07d2b] transition-colors">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('docs.rr.assistant.inputPlaceholder', 'اسأل عن أي كتاب…')}
            aria-label={t('docs.rr.assistant.title', 'المساعد الذكي')}
            dir="auto"
            className="flex-1 min-w-0 bg-transparent outline-none text-[13px] text-[#2c2620] placeholder:text-[#9a8b70]"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            aria-label={t('docs.rr.assistant.send', 'إرسال')}
            className="w-8 h-8 rounded-[9px] bg-[#b07d2b] flex items-center justify-center flex-shrink-0 transition-opacity disabled:opacity-50 hover:brightness-110"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="#fcf8ee" aria-hidden>
              <path d="M3 12 L21 4 L17.5 12 L21 20 Z" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}
