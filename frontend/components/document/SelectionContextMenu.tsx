'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '@/components/i18n/I18nProvider';

/** Languages offered by the "translate" submenu (native labels). */
export const TRANSLATE_LANGS: ReadonlyArray<{ code: string; label: string }> = [
  { code: 'ar', label: 'العربية' },
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'ur', label: 'اردو' },
  { code: 'fa', label: 'فارسی' },
  { code: 'id', label: 'Bahasa Indonesia' },
];

interface SelectionContextMenuProps {
  x: number;
  y: number;
  onSimilarWords: () => void;
  onAddNote: () => void;
  onCopy: () => void;
  onTranslate: (languageLabel: string) => void;
  onSummarize: () => void;
  onReportError: () => void;
  onClose: () => void;
}

function Icon({ path }: { path: string }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0 text-text-3"
    >
      <path d={path} />
    </svg>
  );
}

export default function SelectionContextMenu({
  x,
  y,
  onSimilarWords,
  onAddNote,
  onCopy,
  onTranslate,
  onSummarize,
  onReportError,
  onClose,
}: SelectionContextMenuProps) {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ top: y, left: x });
  const [showLangs, setShowLangs] = useState(false);

  // Clamp the menu inside the viewport once its size is known.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8;
    if (top + rect.height > window.innerHeight - 8) top = window.innerHeight - rect.height - 8;
    setPos({ top: Math.max(8, top), left: Math.max(8, left) });
  }, [x, y, showLangs]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const onDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const itemClass =
    'flex w-full items-center gap-2.5 px-3 py-2 text-[13px] text-text transition-colors hover:bg-white/[0.06] focus:bg-white/[0.06] focus:outline-none';

  const menu = (
    <div
      ref={menuRef}
      role="menu"
      style={{ position: 'fixed', top: pos.top, left: pos.left }}
      className="z-[70] min-w-[224px] overflow-hidden rounded-xl border border-border-strong bg-card-2/98 py-1 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.55)] backdrop-blur-md"
    >
      <button type="button" role="menuitem" className={itemClass} onClick={onSimilarWords}>
        <Icon path="M11 3a8 8 0 105.3 14l4.4 4.4 1.4-1.4-4.4-4.4A8 8 0 0011 3zm0 2a6 6 0 110 12 6 6 0 010-12z" />
        {t('reader.menu.similarWords', 'كلمات مشابهة في كتب أخرى')}
      </button>

      <button type="button" role="menuitem" className={itemClass} onClick={onAddNote}>
        <Icon path="M4 5h16M4 12h10M4 19h7M18 15l3 3-6 3 3-6z" />
        {t('reader.menu.addNote', 'إضافة ملاحظة')}
      </button>

      <button type="button" role="menuitem" className={itemClass} onClick={onCopy}>
        <Icon path="M8 8h11v11H8zM5 16V5h11" />
        {t('reader.menu.copy', 'نسخ النص')}
      </button>

      <button
        type="button"
        role="menuitem"
        aria-expanded={showLangs}
        className={`${itemClass} justify-between`}
        onClick={() => setShowLangs((v) => !v)}
      >
        <span className="flex items-center gap-2.5">
          <Icon path="M4 5h7M9 3v2c0 4-2 7-6 8m2-4c0 3 3 5 6 5M14 20l4-9 4 9M15.5 17h5" />
          {t('reader.menu.translate', 'ترجمة')}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className={`text-text-3 transition-transform ${showLangs ? 'rotate-180' : ''}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {showLangs && (
        <div className="border-y border-border/60 bg-black/[0.04]">
          {TRANSLATE_LANGS.map((lang) => (
            <button
              key={lang.code}
              type="button"
              role="menuitem"
              className={`${itemClass} ps-9 text-[12.5px]`}
              onClick={() => onTranslate(lang.label)}
            >
              {lang.label}
            </button>
          ))}
        </div>
      )}

      <button type="button" role="menuitem" className={itemClass} onClick={onSummarize}>
        <Icon path="M4 6h16M4 10h16M4 14h10M4 18h10" />
        {t('reader.menu.summarize', 'تلخيص')}
      </button>

      <div className="my-1 h-px bg-border/60" />

      <button
        type="button"
        role="menuitem"
        className={`${itemClass} text-red-600 hover:bg-red-500/10`}
        onClick={onReportError}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className="shrink-0"
        >
          <path d="M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L14.4 3.9a2 2 0 00-3.4 0z" />
        </svg>
        {t('reader.menu.reportError', 'الإبلاغ عن خطأ')}
      </button>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(menu, document.body);
}
