import React, { useState, useEffect, useRef } from 'react';
import { Document, DocumentSearchResponse } from '@/lib/api';

interface Note {
  id: string;
  page: number;
  content: string;
  createdAt: number;
}

interface Bookmark {
  page: number;
  createdAt: number;
}

interface DocumentSidebarProps {
  document: Document;
  currentPage: number;
  searchResults: DocumentSearchResponse | null;
  isSearching: boolean;
  onSearch: (query: string) => void;
  onGoToPage: (page: number) => void;
}

type Tab = 'search' | 'notes' | 'bookmarks' | 'info';

export default function DocumentSidebar({
  document,
  currentPage,
  searchResults,
  isSearching,
  onSearch,
  onGoToPage,
}: DocumentSidebarProps) {
  const [activeTab, setActiveTab] = useState<Tab>('search');
  const [notes, setNotes] = useState<Note[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [noteInput, setNoteInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Load from local storage
  useEffect(() => {
    const savedNotes = localStorage.getItem(`doc_${document.id}_notes`);
    const savedBookmarks = localStorage.getItem(`doc_${document.id}_bookmarks`);
    
    if (savedNotes) setNotes(JSON.parse(savedNotes));
    if (savedBookmarks) setBookmarks(JSON.parse(savedBookmarks));
  }, [document.id]);

  // Save to local storage
  useEffect(() => {
    localStorage.setItem(`doc_${document.id}_notes`, JSON.stringify(notes));
  }, [notes, document.id]);

  useEffect(() => {
    localStorage.setItem(`doc_${document.id}_bookmarks`, JSON.stringify(bookmarks));
  }, [bookmarks, document.id]);

  const handleAddNote = () => {
    if (!noteInput.trim()) return;
    const newNote: Note = {
      id: Date.now().toString(),
      page: currentPage,
      content: noteInput,
      createdAt: Date.now(),
    };
    setNotes([newNote, ...notes]);
    setNoteInput('');
  };

  const handleDeleteNote = (id: string) => {
    setNotes(notes.filter(n => n.id !== id));
  };

  const toggleBookmark = () => {
    const exists = bookmarks.find(b => b.page === currentPage);
    if (exists) {
      setBookmarks(bookmarks.filter(b => b.page !== currentPage));
    } else {
      setBookmarks([...bookmarks, { page: currentPage, createdAt: Date.now() }]);
    }
  };

  // Debounce search query with proper cleanup
  useEffect(() => {
    // Clear any existing timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // If query is empty, clear search immediately
    if (!searchQuery.trim()) {
      onSearch('');
      return;
    }

    // Set new timeout for debounced search
    searchTimeoutRef.current = setTimeout(() => {
      onSearch(searchQuery);
    }, 500);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery, onSearch]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  const isBookmarked = bookmarks.some(b => b.page === currentPage);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 shadow-xl overflow-hidden">
      {/* Tabs Header */}
      <div className="sticky top-0 z-10 flex overflow-x-auto scrollbar-hide border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <button
          onClick={() => setActiveTab('search')}
          className={`flex-1 min-w-[60px] py-4 flex flex-col items-center gap-1 transition-colors relative ${
            activeTab === 'search' 
              ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50/50 dark:bg-indigo-900/20' 
              : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
          }`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <span className="text-[10px] font-medium uppercase tracking-wide">Search</span>
          {activeTab === 'search' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 dark:bg-indigo-400" />}
        </button>
        
        <button
          onClick={() => setActiveTab('notes')}
          className={`flex-1 min-w-[60px] py-4 flex flex-col items-center gap-1 transition-colors relative ${
            activeTab === 'notes' 
              ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50/50 dark:bg-indigo-900/20' 
              : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
          }`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          <span className="text-[10px] font-medium uppercase tracking-wide">Notes</span>
          {activeTab === 'notes' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 dark:bg-indigo-400" />}
        </button>

        <button
          onClick={() => setActiveTab('bookmarks')}
          className={`flex-1 min-w-[60px] py-4 flex flex-col items-center gap-1 transition-colors relative ${
            activeTab === 'bookmarks' 
              ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50/50 dark:bg-indigo-900/20' 
              : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
          }`}
        >
          <svg className={`w-5 h-5 ${isBookmarked && activeTab !== 'bookmarks' ? 'text-indigo-500 fill-indigo-50' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
          </svg>
          <span className="text-[10px] font-medium uppercase tracking-wide">Saved</span>
          {activeTab === 'bookmarks' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 dark:bg-indigo-400" />}
        </button>

        <button
          onClick={() => setActiveTab('info')}
          className={`flex-1 min-w-[60px] py-4 flex flex-col items-center gap-1 transition-colors relative ${
            activeTab === 'info' 
              ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50/50 dark:bg-indigo-900/20' 
              : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
          }`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-[10px] font-medium uppercase tracking-wide">Info</span>
          {activeTab === 'info' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 dark:bg-indigo-400" />}
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
        
        {/* === SEARCH TAB === */}
        {activeTab === 'search' && (
          <div className="space-y-6">
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={handleSearchChange}
                placeholder="Search text..."
                className="w-full pl-10 pr-4 py-3 bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                autoFocus
              />
              <svg className="absolute left-3.5 top-3.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              {isSearching && (
                <div className="absolute right-3 top-3">
                  <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>

            {searchResults && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-gray-500 uppercase tracking-wide font-semibold mb-2">
                  <span>Results</span>
                  <span className="bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">{searchResults.total_matches} found</span>
                </div>
                
                {searchResults.matches.length === 0 ? (
                   <div className="text-center py-10">
                     <p className="text-gray-400 text-sm">No matches found</p>
                   </div>
                ) : (
                  <div className="space-y-3">
                    {searchResults.matches.map((match, idx) => (
                      <div
                        key={idx}
                        onClick={() => onGoToPage(match.page_number)}
                        className="p-3 bg-gray-50 dark:bg-gray-700/30 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 border border-gray-100 dark:border-gray-700 rounded-lg cursor-pointer transition-all group"
                      >
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 group-hover:underline">Page {match.page_number}</span>
                        </div>
                        <p 
                          className="text-sm text-gray-600 dark:text-gray-300 leading-snug line-clamp-3"
                          dangerouslySetInnerHTML={{ __html: match.snippet }}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* === NOTES TAB === */}
        {activeTab === 'notes' && (
          <div className="space-y-6">
            <div className="bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-xl border border-indigo-100 dark:border-indigo-800/50">
              <label className="block text-xs font-semibold text-indigo-900 dark:text-indigo-200 uppercase tracking-wide mb-2">
                Add Note to Page {currentPage}
              </label>
              <textarea
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                placeholder="Type your thoughts here..."
                className="w-full p-3 bg-white dark:bg-gray-800 border-0 rounded-lg text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 mb-3 min-h-[80px] resize-none"
              />
              <button
                onClick={handleAddNote}
                disabled={!noteInput.trim()}
                className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              >
                Save Note
              </button>
            </div>

            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">All Notes</h3>
              {notes.length === 0 ? (
                <div className="text-center py-10 opacity-60">
                  <svg className="w-10 h-10 mx-auto text-gray-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  <p className="text-sm text-gray-500">No notes yet</p>
                </div>
              ) : (
                notes.sort((a,b) => b.createdAt - a.createdAt).map(note => (
                  <div key={note.id} className="group relative p-4 bg-gray-50 dark:bg-gray-700/30 rounded-xl border border-gray-100 dark:border-gray-700 hover:bg-white dark:hover:bg-gray-700 hover:shadow-sm transition-all">
                    <button 
                      onClick={() => handleDeleteNote(note.id)}
                      className="absolute top-2 right-2 p-1.5 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                    <div className="flex items-center gap-2 mb-2">
                       <span 
                         onClick={() => onGoToPage(note.page)}
                         className="px-2 py-0.5 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded text-[10px] font-bold cursor-pointer hover:bg-gray-300 dark:hover:bg-gray-500"
                       >
                         Page {note.page}
                       </span>
                       <span className="text-[10px] text-gray-400">
                         {new Date(note.createdAt).toLocaleDateString()}
                       </span>
                    </div>
                    <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">{note.content}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* === BOOKMARKS TAB === */}
        {activeTab === 'bookmarks' && (
          <div className="space-y-6">
            <div className="bg-amber-50 dark:bg-amber-900/10 p-4 rounded-xl border border-amber-100 dark:border-amber-900/30 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-amber-900 dark:text-amber-200 uppercase tracking-wide">Current Page</p>
                <p className="text-lg font-bold text-amber-950 dark:text-amber-100">Page {currentPage}</p>
              </div>
              <button 
                onClick={toggleBookmark}
                className={`p-2.5 rounded-full shadow-sm transition-all ${
                  isBookmarked 
                    ? 'bg-amber-500 text-white hover:bg-amber-600' 
                    : 'bg-white text-gray-400 hover:text-amber-500 border border-gray-200'
                }`}
              >
                <svg className="w-5 h-5" fill={isBookmarked ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                </svg>
              </button>
            </div>

            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Saved Pages</h3>
              {bookmarks.length === 0 ? (
                <div className="text-center py-10 opacity-60">
                  <svg className="w-10 h-10 mx-auto text-gray-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                  </svg>
                  <p className="text-sm text-gray-500">No bookmarks yet</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {bookmarks.sort((a,b) => a.page - b.page).map(bookmark => (
                    <button
                      key={bookmark.page}
                      onClick={() => onGoToPage(bookmark.page)}
                      className="flex flex-col items-center p-3 bg-gray-50 dark:bg-gray-700/30 hover:bg-white dark:hover:bg-gray-700 border border-gray-100 dark:border-gray-700 hover:shadow-md transition-all rounded-xl group relative"
                    >
                      <span className="text-2xl font-bold text-gray-300 group-hover:text-indigo-500 transition-colors mb-1">
                        {bookmark.page}
                      </span>
                      <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Page</span>
                      
                      <div 
                        onClick={(e) => {
                          e.stopPropagation();
                          setBookmarks(bookmarks.filter(b => b.page !== bookmark.page));
                        }}
                        className="absolute top-1 right-1 p-1 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity rounded-full hover:bg-gray-100 dark:hover:bg-gray-600"
                        title="Remove bookmark"
                      >
                         <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* === INFO TAB === */}
        {activeTab === 'info' && (
           <div className="space-y-6">
             <div className="space-y-4">
               <div>
                 <h4 className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-1">Title</h4>
                 <p className="text-sm text-gray-900 dark:text-white font-medium leading-relaxed">{document.title}</p>
               </div>
               
               {document.authors && document.authors.length > 0 && (
                 <div>
                   <h4 className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-1">Authors</h4>
                   <p className="text-sm text-gray-700 dark:text-gray-300">{document.authors.join(', ')}</p>
                 </div>
               )}

               {document.categories && document.categories.length > 0 && (
                 <div>
                   <h4 className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-1">Categories</h4>
                   <div className="flex flex-wrap gap-1.5">
                     {document.categories.map(cat => (
                       <span key={cat} className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded text-xs">
                         {cat}
                       </span>
                     ))}
                   </div>
                 </div>
               )}
               
               <div>
                  <h4 className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-1">Details</h4>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2 bg-gray-50 dark:bg-gray-700/30 rounded-lg">
                      <span className="block text-[10px] text-gray-500 uppercase">Uploaded</span>
                      <span className="text-xs font-medium text-gray-900 dark:text-white">
                        {new Date(document.uploaded_at).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="p-2 bg-gray-50 dark:bg-gray-700/30 rounded-lg">
                       <span className="block text-[10px] text-gray-500 uppercase">Language</span>
                       <span className="text-xs font-medium text-gray-900 dark:text-white">
                         {document.language || 'Unknown'}
                       </span>
                    </div>
                  </div>
               </div>
             </div>
           </div>
        )}
      </div>
    </div>
  );
}
