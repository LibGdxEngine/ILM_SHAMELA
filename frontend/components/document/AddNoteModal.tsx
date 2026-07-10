'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '@/components/i18n/I18nProvider';
import type { HighlightColor } from '@/lib/api/reader';

const COLORS: HighlightColor[] = ['yellow', 'green', 'blue', 'pink', 'orange'];

const COLOR_CLASS: Record<HighlightColor, string> = {
  yellow: 'bg-yellow-300',
  green: 'bg-green-300',
  blue: 'bg-blue-300',
  pink: 'bg-pink-300',
  orange: 'bg-orange-300',
};

interface AddNoteModalProps {
  selectedText: string;
  onSave: (note: string, color: HighlightColor) => void;
  onClose: () => void;
}

export default function AddNoteModal({ selectedText, onSave, onClose }: AddNoteModalProps) {
  const { t } = useI18n();
  const [note, setNote] = useState('');
  const [color, setColor] = useState<HighlightColor>('yellow');

  const canSave = note.trim().length > 0;

  const modal = (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('reader.note.title', 'إضافة ملاحظة')}
        className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 font-reem-kufi text-[16px] font-medium text-text">
          {t('reader.note.title', 'إضافة ملاحظة')}
        </h2>

        <blockquote className="mb-4 max-h-24 overflow-y-auto rounded-lg border-s-2 border-accent/40 bg-black/[0.03] px-3 py-2 text-[12.5px] leading-relaxed text-text-2">
          <bdi>{selectedText}</bdi>
        </blockquote>

        <textarea
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={4}
          placeholder={t('reader.note.placeholder', 'اكتب ملاحظتك…')}
          className="w-full resize-y rounded-lg border border-border bg-card-2 px-3 py-2 text-[13.5px] text-text placeholder:text-text-3 focus:border-accent/50 focus:outline-none"
        />

        <div className="mt-3 flex items-center gap-2">
          <span className="text-[12px] text-text-2">{t('reader.note.color', 'اللون')}</span>
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-label={t(`reader.color.${c}`, c)}
              aria-pressed={color === c}
              className={`h-5 w-5 rounded-full border transition-transform hover:scale-110 ${COLOR_CLASS[c]} ${
                color === c ? 'border-text ring-2 ring-accent/50' : 'border-white/30'
              }`}
            />
          ))}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-4 py-2 text-[13px] text-text-2 transition-colors hover:bg-white/[0.06]"
          >
            {t('common.cancel', 'إلغاء')}
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={() => onSave(note.trim(), color)}
            className="rounded-full bg-accent px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('reader.note.save', 'حفظ')}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(modal, document.body);
}
