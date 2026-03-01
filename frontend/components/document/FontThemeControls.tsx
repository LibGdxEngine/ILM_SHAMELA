import { useI18n } from '@/components/i18n/I18nProvider';

export type ReaderTheme = 'light' | 'sepia' | 'dark';
export type FontSizeKey = 'small' | 'medium' | 'large';

interface FontThemeControlsProps {
  fontSize: FontSizeKey;
  theme: ReaderTheme;
  onFontSizeChange: (size: FontSizeKey) => void;
  onThemeChange: (theme: ReaderTheme) => void;
}

const FONT_SIZE_VALUES: Record<FontSizeKey, string> = {
  small: '1rem',
  medium: '1.125rem',
  large: '1.375rem',
};

export default function FontThemeControls({
  fontSize,
  theme,
  onFontSizeChange,
  onThemeChange,
}: FontThemeControlsProps) {
  const { t } = useI18n();

  const fontSizes: { key: FontSizeKey; label: string }[] = [
    { key: 'small', label: t('reader.small', 'Small') },
    { key: 'medium', label: t('reader.medium', 'Medium') },
    { key: 'large', label: t('reader.large', 'Large') },
  ];

  const themes: { key: ReaderTheme; label: string; preview: string }[] = [
    { key: 'light', label: t('reader.light', 'Light'), preview: 'bg-white border-gray-300 text-gray-900' },
    { key: 'sepia', label: t('reader.sepia', 'Sepia'), preview: 'bg-[#f8f0e3] border-[#c8a86b] text-[#5c4b37]' },
    { key: 'dark', label: t('reader.dark', 'Dark'), preview: 'bg-[#1a1a2e] border-[#3a3a5e] text-[#d4d4d8]' },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
          {t('reader.fontSize', 'Font size')}
        </h3>
        <div className="flex gap-2">
          {fontSizes.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => onFontSizeChange(item.key)}
              className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                fontSize === item.key
                  ? 'border-teal-400 bg-teal-50 text-teal-800'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
          {t('reader.theme', 'Theme')}
        </h3>
        <div className="flex gap-2">
          {themes.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => onThemeChange(item.key)}
              className={`flex-1 rounded-lg border-2 px-3 py-2 text-xs font-medium transition-colors ${item.preview} ${
                theme === item.key ? 'ring-2 ring-teal-400 ring-offset-1' : ''
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export { FONT_SIZE_VALUES };
