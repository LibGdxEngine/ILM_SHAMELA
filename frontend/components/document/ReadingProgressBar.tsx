interface ReadingProgressBarProps {
  currentPage: number;
  totalPages: number;
}

export default function ReadingProgressBar({ currentPage, totalPages }: ReadingProgressBarProps) {
  const progress = totalPages > 0 ? (currentPage / totalPages) * 100 : 0;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 h-[3px] bg-gray-200/50">
      <div
        className="h-full bg-gradient-to-r from-teal-400 to-teal-600 transition-all duration-300 ease-out"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}
