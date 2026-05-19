import { ReadingStats } from '@/hooks/useReadingStats';
import { useI18n } from '@/components/i18n/I18nProvider';

interface ReadingStatsPanelProps {
  stats: ReadingStats;
  onReset: () => void;
}

export default function ReadingStatsPanel({ stats, onReset }: ReadingStatsPanelProps) {
  const { t } = useI18n();

  const formatTime = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return t('reader.time.hoursMinutes', '{hours}h {minutes}m', {
        hours,
        minutes: minutes % 60,
      });
    }
    if (minutes > 0) {
      return t('reader.time.minutesSeconds', '{minutes}m {seconds}s', {
        minutes,
        seconds: seconds % 60,
      });
    }
    return t('reader.time.seconds', '{seconds}s', { seconds });
  };

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-[11px] tracking-[0.18em] uppercase text-accent font-medium">
          {t('sidebar.readingStats', 'Reading stats')}
        </h4>
        <button
          type="button"
          onClick={onReset}
          className="text-[11px] text-text-3 underline-offset-2 hover:text-accent-2 hover:underline"
        >
          {t('sidebar.reset', 'Reset')}
        </button>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between rounded-[12px] border border-border bg-white/[0.02] px-3 py-2.5 text-[13px]">
          <span className="text-text-2">{t('sidebar.timeSpent', 'Time spent')}</span>
          <span className="font-fraunces font-medium text-text">{formatTime(stats.timeSpent)}</span>
        </div>
        <div className="flex items-center justify-between rounded-[12px] border border-border bg-white/[0.02] px-3 py-2.5 text-[13px]">
          <span className="text-text-2">{t('sidebar.pagesRead', 'Pages read')}</span>
          <span className="font-fraunces font-medium text-text">{stats.pagesRead}</span>
        </div>
        <div className="flex items-center justify-between rounded-[12px] border border-border bg-white/[0.02] px-3 py-2.5 text-[13px]">
          <span className="text-text-2">{t('sidebar.readingSpeed', 'Reading speed')}</span>
          <span className="font-fraunces font-medium text-text">
            {stats.readingSpeed > 0
              ? t('reader.readingSpeedUnit', '{speed} pages/min', {
                speed: stats.readingSpeed.toFixed(1),
              })
              : t('sidebar.na', 'N/A')}
          </span>
        </div>
      </div>
    </section>
  );
}
