export type ReaderTool = 'search' | 'notes' | 'bookmarks';

export interface Bookmark {
  id?: number;
  page: number;
  createdAt: number;
  tags: string[];
  label?: string;
}

export interface Note {
  id: string | number;
  page: number;
  content: string;
  createdAt: number;
  tags: string[];
}
