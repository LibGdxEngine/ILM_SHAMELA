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
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {t('reader.export', 'Export')}
        </h3>
        <button
          type="button"
          onClick={handleExport}
          disabled={notes.length === 0 || isExporting}
          className="rounded-lg border border-teal-200 bg-white px-3 py-1.5 text-xs font-medium text-teal-700 transition-colors hover:border-teal-400 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('reader.exportMarkdown', 'Export Markdown')}
        </button>
      </div>
      {exportError && <p className="text-xs text-red-500">{exportError}</p>}

      <div className="rounded-2xl border border-amber-200/70 bg-amber-50/70 p-4">
        <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-amber-900">
          {t('sidebar.addNote', 'Add note on page {page}', { page: currentPage })}
        </label>
        <textarea
          value={noteInput}
          onChange={(event) => onNoteInputChange(event.target.value)}
          placeholder={t('sidebar.notePlaceholder', 'Write your note...')}
          className="mb-3 min-h-[90px] w-full resize-none rounded-xl border border-amber-100 bg-white p-3 text-sm text-gray-800 outline-none transition-colors focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
        />
        <div className="mb-3">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-900">
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
          className="w-full rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('sidebar.saveNote', 'Save note')}
        </button>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
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
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
          {t('sidebar.allNotes', 'All notes')}
        </h3>

        {filteredNotes.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center">
            <p className="text-sm text-gray-500">{t('sidebar.noNotes', 'No notes yet')}</p>
          </div>
        ) : (
          <div className="min-h-0 space-y-3 overflow-y-auto pe-1">
            {filteredNotes
              .slice()
              .sort((a, b) => b.createdAt - a.createdAt)
              .map((note) => (
                <article key={String(note.id)} className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onGoToPage(note.page)}
                      className="rounded-full bg-teal-100 px-2 py-0.5 text-xs font-semibold text-teal-800 hover:bg-teal-200"
                    >
                      {t('reader.pageLabel', 'Page {page}', { page: note.page })}
                    </button>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-gray-400">
                        {new Date(note.createdAt).toLocaleDateString(localeToDateLocale(locale))}
                      </span>
                      <button
                        type="button"
                        onClick={() => onDeleteNote(note.id)}
                        className="rounded-full p-1 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
                        aria-label={t('reader.deleteNote', 'Delete note')}
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-6 text-gray-700">{note.content}</p>
                  {note.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {note.tags.map((tag) => {
                        const isActive = selectedTags.includes(tag.toLowerCase());
                        return (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => toggleFilterTag(tag)}
                            className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                              isActive
                                ? 'bg-teal-600 text-white'
                                : 'bg-teal-100 text-teal-800 hover:bg-teal-200'
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
