import { useI18n } from '@/components/i18n/I18nProvider';
import { Bookmark } from './readerToolsTypes';
import TagChipInput from './TagChipInput';

interface BookmarksToolPanelProps {
  bookmarks: Bookmark[];
  currentPage: number;
  selectedTags: string[];
  onSelectedTagsChange: (next: string[]) => void;
  onToggleCurrentBookmark: () => void;
  onRemoveBookmark: (page: number) => void;
  onGoToPage: (page: number) => void;
}

export default function BookmarksToolPanel({
  bookmarks,
  currentPage,
  selectedTags,
  onSelectedTagsChange,
  onToggleCurrentBookmark,
  onRemoveBookmark,
  onGoToPage,
}: BookmarksToolPanelProps) {
  const { t } = useI18n();
  const isBookmarked = bookmarks.some((bookmark) => bookmark.page === currentPage);

  const filteredBookmarks =
    selectedTags.length === 0
      ? bookmarks
      : bookmarks.filter((bookmark) =>
          selectedTags.every((tag) =>
            bookmark.tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())
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

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between rounded-[16px] border border-accent/30 bg-accent-soft p-4">
        <div>
          <p className="text-[11px] tracking-[0.18em] uppercase text-accent font-medium">
            {t('sidebar.currentPage', 'Current page')}
          </p>
          <p className="font-fraunces text-[18px] text-text mt-1">
            {t('reader.pageLabel', 'Page {page}', { page: currentPage })}
          </p>
        </div>
        <button
          type="button"
          onClick={onToggleCurrentBookmark}
          className={`rounded-full p-2.5 border transition-all ${
            isBookmarked
              ? 'bg-accent text-[#1a0e05] border-accent shadow-[0_4px_14px_-4px_rgba(192,133,82,0.5)]'
              : 'bg-white/[0.04] text-text-2 border-border-strong hover:border-accent hover:text-accent-2'
          }`}
          aria-label={isBookmarked ? t('sidebar.removeBookmark', 'Remove bookmark') : t('sidebar.bookmarks', 'Bookmarks')}
        >
          <svg className="h-5 w-5" fill={isBookmarked ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
          </svg>
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
          {t('sidebar.savedPages', 'Saved pages')}
        </h3>
        {filteredBookmarks.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-[16px] border border-dashed border-border-strong bg-white/[0.02] p-8 text-center">
            <p className="text-[13px] text-text-3">{t('sidebar.noBookmarks', 'No saved pages')}</p>
          </div>
        ) : (
          <div className="min-h-0 overflow-y-auto pe-1">
            <div className="grid grid-cols-2 gap-3">
              {filteredBookmarks
                .slice()
                .sort((a, b) => a.page - b.page)
                .map((bookmark) => (
                  <div
                    key={bookmark.id ?? bookmark.page}
                    className="group relative rounded-[14px] border border-border bg-white/[0.02] p-3 transition-colors hover:border-accent/40"
                  >
                    <button
                      type="button"
                      onClick={() => onGoToPage(bookmark.page)}
                      className="w-full text-start"
                    >
                      <p className="font-fraunces text-[24px] text-text transition-colors group-hover:text-accent-2">
                        {bookmark.page}
                      </p>
                      <p className="text-[10.5px] tracking-[0.12em] uppercase text-text-3">
                        {t('reader.pageLabel', 'Page {page}', { page: bookmark.page })}
                      </p>
                    </button>
                    {bookmark.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {bookmark.tags.map((tag) => {
                          const isActive = selectedTags.includes(tag.toLowerCase());
                          return (
                            <button
                              key={tag}
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleFilterTag(tag);
                              }}
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
                    <button
                      type="button"
                      onClick={() => onRemoveBookmark(bookmark.page)}
                      title={t('sidebar.removeBookmark', 'Remove bookmark')}
                      className="absolute inset-inline-end-1 top-1 rounded-full p-1 text-text-3 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-300 group-hover:opacity-100"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
