import { useI18n } from '@/components/i18n/I18nProvider';
import { localeToDateLocale } from '@/lib/i18n/config';
import { Note } from './readerToolsTypes';

interface NotesToolPanelProps {
  notes: Note[];
  noteInput: string;
  currentPage: number;
  onNoteInputChange: (value: string) => void;
  onAddNote: () => void;
  onDeleteNote: (id: string) => void;
  onGoToPage: (page: number) => void;
}

export default function NotesToolPanel({
  notes,
  noteInput,
  currentPage,
  onNoteInputChange,
  onAddNote,
  onDeleteNote,
  onGoToPage,
}: NotesToolPanelProps) {
  const { t, locale } = useI18n();

  return (
    <div className="flex h-full flex-col gap-4">
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
        <button
          type="button"
          onClick={onAddNote}
          disabled={!noteInput.trim()}
          className="w-full rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('sidebar.saveNote', 'Save note')}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
          {t('sidebar.allNotes', 'All notes')}
        </h3>

        {notes.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center">
            <p className="text-sm text-gray-500">{t('sidebar.noNotes', 'No notes yet')}</p>
          </div>
        ) : (
          <div className="min-h-0 space-y-3 overflow-y-auto pe-1">
            {notes
              .slice()
              .sort((a, b) => b.createdAt - a.createdAt)
              .map((note) => (
                <article key={note.id} className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
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
                </article>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
