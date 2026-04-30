'use client';

import { useCallback, useState, KeyboardEvent } from 'react';
import { useI18n } from '@/components/i18n/I18nProvider';

interface TagChipInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  ariaLabel?: string;
}

const MAX_TAGS = 16;
const MAX_TAG_LENGTH = 32;

function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase().slice(0, MAX_TAG_LENGTH);
}

export default function TagChipInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
}: TagChipInputProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');

  const commit = useCallback(
    (raw: string) => {
      const tag = normalizeTag(raw);
      if (!tag) return;
      if (value.length >= MAX_TAGS) return;
      if (value.some((existing) => existing.toLowerCase() === tag)) return;
      onChange([...value, tag]);
    },
    [value, onChange]
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter' || event.key === ',') {
        event.preventDefault();
        if (draft.trim()) {
          commit(draft);
          setDraft('');
        }
        return;
      }
      if (event.key === 'Backspace' && draft.length === 0 && value.length > 0) {
        event.preventDefault();
        onChange(value.slice(0, -1));
      }
    },
    [draft, value, commit, onChange]
  );

  const removeAt = useCallback(
    (index: number) => {
      onChange(value.filter((_, i) => i !== index));
    },
    [value, onChange]
  );

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 rounded-[12px] border border-border bg-white/[0.02] p-1.5 transition-colors focus-within:border-accent focus-within:bg-accent-soft/30"
      aria-label={ariaLabel ?? t('reader.tags', 'Tags')}
    >
      {value.map((tag, index) => (
        <span
          key={`${tag}-${index}`}
          className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent-soft px-2 py-0.5 text-[11.5px] font-medium text-accent-2"
        >
          {tag}
          <button
            type="button"
            onClick={() => removeAt(index)}
            aria-label={`${t('reader.removeTag', 'Remove tag')}: ${tag}`}
            className="rounded-full text-accent-2 hover:bg-accent/25 hover:text-text focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (draft.trim()) {
            commit(draft);
            setDraft('');
          }
        }}
        placeholder={placeholder ?? t('reader.tagPlaceholder', 'Add tag and press Enter')}
        className="min-w-[6rem] flex-1 bg-transparent px-2 py-1 text-[12px] text-text outline-none placeholder:text-text-3"
      />
    </div>
  );
}
