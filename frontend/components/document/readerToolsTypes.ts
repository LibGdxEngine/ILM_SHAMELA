export type ReaderTool = 'search' | 'notes' | 'bookmarks';

export interface Note {
  id: string;
  page: number;
  content: string;
  createdAt: number;
}

export interface Bookmark {
  page: number;
  createdAt: number;
}
