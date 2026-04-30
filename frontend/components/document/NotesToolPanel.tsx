'use client';

import { useState } from 'react';
import { useI18n } from '@/components/i18n/I18nProvider';
import { localeToDateLocale } from '@/lib/i18n/config';
import { exportNotes } from '@/lib/api/reader';
import { Note } from './readerToolsTypes';
import TagChipInput from './TagChipInput';

interface NotesToolPanelProps {
  notes: Note[];
  noteInput: string;
  currentPage: number;
  documentId: number;
  pendingNoteTags: string[];
  selectedTags: string[];
  onPendingNoteTagsChange: (next: string[]) => void;
  onSelectedTagsChange: (next: string[]) => void;
  onNoteInputChange: (value: string) => void;
  onAddNote: () => void;
  onDeleteNote: (id: string | number) => void;
  onGoToPage: (page: number) => void;
}

export default function NotesToolPanel({
  notes,
  noteInput,
  currentPage,
  documentId,
  pendingNoteTags,
  selectedTags,
  onPendingNoteTagsChange,
  onSelectedTagsChange,
  onNoteInputChange,
  onAddNote,
  onDeleteNote,
  onGoToPage,
}: NotesToolPanelProps) {
  const { t, locale } = useI18n();
  const [exportError, setExportError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const filteredNotes =
    selectedTags.length === 0
      ? notes
      : notes.filter((note) =>
          selectedTags.every((tag) =>
            note.tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())
          )
        );

  const toggleFilterTag = (tag: string) => {
    const lower = tag.toLowerCase();
    if (selectedTags.includes(lower)) {
      onSelectedTagsChange(selectedTags.filter((existing) => existing !== lower));
    } else {
      onSelectedTagsChange([...selectedTags, lower]);
    }
  };

  const handleExport = async () => {
    setExportError(null);
    setIsExporting(true);
    try {
      const blob = await exportNotes(documentId, 'md');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `notes-${documentId}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setExportError(t('reader.exportFailed', 'Export failed'));
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] tracking-[0.18em] uppercase text-accent font-medium">
          {t('reader.export', 'Export')}
        </h3>
        <button
          type="button"
          onClick={handleExport}
          disabled={notes.length === 0 || isExporting}
          className="rounded-full border border-border-strong bg-white/[0.03] px-3 py-1.5 text-[11.5px] font-medium text-text-2 transition-all hover:border-accent hover:text-accent-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('reader.exportMarkdown', 'Export Markdown')}
        </button>
      </div>
      {exportError && <p className="text-[12px] text-red-300">{exportError}</p>}

      <div className="rounded-[16px] border border-accent/30 bg-accent-soft p-4">
        <label className="mb-2 block text-[11px] tracking-[0.18em] uppercase text-accent font-medium">
          {t('sidebar.addNote', 'Add note on page {page}', { page: currentPage })}
        </label>
        <textarea
          value={noteInput}
          onChange={(event) => onNoteInputChange(event.target.value)}
          placeholder={t('sidebar.notePlaceholder', 'Write your note...')}
          className="mb-3 min-h-[90px] w-full resize-none rounded-[12px] border border-border bg-bg/50 p-3 text-[13.5px] font-fraunces text-text placeholder:text-text-3 outline-none transition-all focus:border-accent focus:bg-bg/70 focus:shadow-[0_0_0_3px_rgba(192,133,82,0.1)]"
        />
        <div className="mb-3">
          <p className="mb-1.5 text-[11px] tracking-[0.16em] uppercase text-accent font-medium">
            {t('reader.tags', 'Tags')}
          </p>
          <TagChipInput
            value={pendingNoteTags}
            onChange={onPendingNoteTagsChange}
            placeholder={t('reader.tagPlaceholder', 'Add tag and press Enter')}
            ariaLabel={t('reader.addTag', 'Add tag')}
          />
        </div>
        <button
          type="button"
          onClick={onAddNote}
          disabled={!noteInput.trim()}
          className="btn-primary w-full !rounded-[12px] !text-[13px] !py-2.5 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('sidebar.saveNote', 'Save note')}
        </button>
      </div>

      <div>
        <h3 className="mb-2 text-[11px] tracking-[0.18em] uppercase text-accent font-medium">
          {t('reader.tagFilter', 'Filter by tag')}
        </h3>
        <TagChipInput
          value={selectedTags}
          onChange={onSelectedTagsChange}
          placeholder={t('reader.tagPlaceholder', 'Add tag and press Enter')}
          ariaLabel={t('reader.tagFilter', 'Filter by tag')}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <h3 className="mb-3 text-[11px] tracking-[0.18em] uppercase text-accent font-medium">
          {t('sidebar.allNotes', 'All notes')}
        </h3>

        {filteredNotes.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-[16px] border border-dashed border-border-strong bg-white/[0.02] p-8 text-center">
            <p className="text-[13px] text-text-3">{t('sidebar.noNotes', 'No notes yet')}</p>
          </div>
        ) : (
          <div className="min-h-0 space-y-3 overflow-y-auto pe-1">
            {filteredNotes
              .slice()
              .sort((a, b) => b.createdAt - a.createdAt)
              .map((note) => (
                <article
                  key={String(note.id)}
                  className="rounded-[14px] border border-border bg-white/[0.02] p-3 transition-colors hover:border-accent/40"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onGoToPage(note.page)}
                      className="rounded-full border border-accent/30 bg-accent-soft px-2.5 py-0.5 text-[11px] font-medium text-accent-2 hover:border-accent transition-colors"
                    >
                      {t('reader.pageLabel', 'Page {page}', { page: note.page })}
                    </button>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-text-3">
                        {new Date(note.createdAt).toLocaleDateString(localeToDateLocale(locale))}
                      </span>
                      <button
                        type="button"
                        onClick={() => onDeleteNote(note.id)}
                        className="rounded-full p-1 text-text-3 transition-colors hover:bg-red-500/10 hover:text-red-300"
                        aria-label={t('reader.deleteNote', 'Delete note')}
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <p className="whitespace-pre-wrap text-[13.5px] leading-[1.65] font-fraunces text-text">{note.content}</p>
                  {note.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {note.tags.map((tag) => {
                        const isActive = selectedTags.includes(tag.toLowerCase());
                        return (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => toggleFilterTag(tag)}
                            className={`rounded-full px-2 py-0.5 text-[10px] font-medium border transition-colors ${
                              isActive
                                ? 'bg-accent text-[#1a0e05] border-accent'
                                : 'bg-accent-soft text-accent-2 border-accent/30 hover:border-accent'
                            }`}
                          >
                            {tag}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </article>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
