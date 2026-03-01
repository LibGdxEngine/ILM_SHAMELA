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
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {t('sidebar.readingStats', 'Reading stats')}
        </h4>
        <button
          type="button"
          onClick={onReset}
          className="text-xs text-gray-500 underline-offset-2 hover:underline"
        >
          {t('sidebar.reset', 'Reset')}
        </button>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm">
          <span className="text-blue-900">{t('sidebar.timeSpent', 'Time spent')}</span>
          <span className="font-semibold text-blue-950">{formatTime(stats.timeSpent)}</span>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm">
          <span className="text-emerald-900">{t('sidebar.pagesRead', 'Pages read')}</span>
          <span className="font-semibold text-emerald-950">{stats.pagesRead}</span>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-orange-100 bg-orange-50 px-3 py-2 text-sm">
          <span className="text-orange-900">{t('sidebar.readingSpeed', 'Reading speed')}</span>
          <span className="font-semibold text-orange-950">
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
