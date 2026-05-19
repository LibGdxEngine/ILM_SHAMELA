interface ReadingProgressBarProps {
  currentPage: number;
  totalPages: number;
}

export default function ReadingProgressBar({ currentPage, totalPages }: ReadingProgressBarProps) {
  const progress = totalPages > 0 ? (currentPage / totalPages) * 100 : 0;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 h-[3px] bg-white/[0.04]">
      <div
        className="h-full bg-gradient-to-r from-accent to-accent-2 transition-all duration-300 ease-out shadow-[0_0_12px_-2px_rgba(192,133,82,0.6)]"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}
