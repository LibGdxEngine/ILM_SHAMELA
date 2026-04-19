import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import NotesToolPanel from './NotesToolPanel';
import type { Note } from './readerToolsTypes';

vi.mock('@/components/i18n/I18nProvider', () => ({
  useI18n: () => ({
    t: (_key: string, fallback?: string, values?: Record<string, unknown>) => {
      if (!fallback) return _key;
      if (!values) return fallback;
      return fallback.replace(/\{(\w+)\}/g, (_: string, token: string) =>
        values[token] === undefined ? `{${token}}` : String(values[token])
      );
    },
    locale: 'en',
    direction: 'ltr',
    dictionary: {},
  }),
}));

const exportNotesMock = vi.fn();

vi.mock('@/lib/api/reader', () => ({
  exportNotes: (...args: unknown[]) => exportNotesMock(...args),
}));

describe('NotesToolPanel', () => {
  const noop = () => {};

  it('renders the empty state when there are no notes', () => {
    render(
      <NotesToolPanel
        notes={[]}
        noteInput=""
        currentPage={1}
        documentId={42}
        pendingNoteTags={[]}
        selectedTags={[]}
        onPendingNoteTagsChange={noop}
        onSelectedTagsChange={noop}
        onNoteInputChange={noop}
        onAddNote={noop}
        onDeleteNote={noop}
        onGoToPage={noop}
      />
    );

    expect(screen.getByText('No notes yet')).toBeInTheDocument();
  });

  it('renders a single note body and its page chip', () => {
    const notes: Note[] = [
      { id: 1, page: 4, content: 'Important passage', createdAt: Date.now(), tags: [] },
    ];

    render(
      <NotesToolPanel
        notes={notes}
        noteInput=""
        currentPage={4}
        documentId={42}
        pendingNoteTags={[]}
        selectedTags={[]}
        onPendingNoteTagsChange={noop}
        onSelectedTagsChange={noop}
        onNoteInputChange={noop}
        onAddNote={noop}
        onDeleteNote={noop}
        onGoToPage={noop}
      />
    );

    expect(screen.getByText('Important passage')).toBeInTheDocument();
    // The page chip in the note card.
    expect(screen.getAllByText('Page 4').length).toBeGreaterThan(0);
  });

  it('calls exportNotes when the export button is clicked', async () => {
    exportNotesMock.mockResolvedValueOnce(new Blob(['# notes'], { type: 'text/markdown' }));
    // Stub URL.createObjectURL/revokeObjectURL so the click handler doesn't crash in jsdom.
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();

    const notes: Note[] = [
      { id: 1, page: 1, content: 'Note A', createdAt: Date.now(), tags: [] },
    ];

    render(
      <NotesToolPanel
        notes={notes}
        noteInput=""
        currentPage={1}
        documentId={42}
        pendingNoteTags={[]}
        selectedTags={[]}
        onPendingNoteTagsChange={noop}
        onSelectedTagsChange={noop}
        onNoteInputChange={noop}
        onAddNote={noop}
        onDeleteNote={noop}
        onGoToPage={noop}
      />
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Export Markdown' }));

    await waitFor(() => {
      expect(exportNotesMock).toHaveBeenCalledWith(42, 'md');
    });

    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });
});
