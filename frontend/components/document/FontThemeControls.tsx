import { useI18n } from '@/components/i18n/I18nProvider';

export type ReaderTheme = 'light' | 'sepia' | 'dark';
export type FontSizeKey = 'small' | 'medium' | 'large';
export type FontWeightKey = 300 | 400 | 500 | 700;

interface FontThemeControlsProps {
  fontSize: FontSizeKey;
  theme: ReaderTheme;
  onFontSizeChange: (size: FontSizeKey) => void;
  onThemeChange: (theme: ReaderTheme) => void;
  // Advanced (optional so callers can opt in incrementally)
  tashkeelEnabled?: boolean;
  onTashkeelChange?: (enabled: boolean) => void;
  letterSpacing?: number;
  onLetterSpacingChange?: (value: number) => void;
  lineHeight?: number;
  onLineHeightChange?: (value: number) => void;
  fontWeight?: FontWeightKey;
  onFontWeightChange?: (weight: FontWeightKey) => void;
  language?: string | null;
}

const FONT_SIZE_VALUES: Record<FontSizeKey, string> = {
  small: '1rem',
  medium: '1.125rem',
  large: '1.375rem',
};

const FONT_WEIGHTS: FontWeightKey[] = [300, 400, 500, 700];

export default function FontThemeControls({
  fontSize,
  theme,
  onFontSizeChange,
  onThemeChange,
  tashkeelEnabled,
  onTashkeelChange,
  letterSpacing,
  onLetterSpacingChange,
  lineHeight,
  onLineHeightChange,
  fontWeight,
  onFontWeightChange,
  language,
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

  const fontWeightLabels: Record<FontWeightKey, string> = {
    300: t('reader.weight300', 'Light'),
    400: t('reader.weight400', 'Regular'),
    500: t('reader.weight500', 'Medium'),
    700: t('reader.weight700', 'Bold'),
  };

  const showAdvanced =
    onTashkeelChange !== undefined ||
    onLetterSpacingChange !== undefined ||
    onLineHeightChange !== undefined ||
    onFontWeightChange !== undefined;

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

      {showAdvanced && (
        <details className="rounded-lg border border-gray-200 bg-white">
          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-600 hover:text-gray-900">
            {t('reader.advanced', 'Advanced')}
          </summary>
          <div className="space-y-4 px-3 pb-3 pt-2">
            {language === 'ar' && onTashkeelChange && (
              <div className="flex items-center justify-between">
                <label htmlFor="tashkeel-toggle" className="text-xs font-medium text-gray-700">
                  {t('reader.tashkeel', 'Diacritics')}
                </label>
                <button
                  id="tashkeel-toggle"
                  type="button"
                  role="switch"
                  aria-checked={tashkeelEnabled ?? true}
                  onClick={() => onTashkeelChange(!(tashkeelEnabled ?? true))}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    tashkeelEnabled ?? true ? 'bg-teal-600' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      tashkeelEnabled ?? true ? 'translate-x-4' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            )}

            {onLetterSpacingChange && (
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label htmlFor="letter-spacing" className="text-xs font-medium text-gray-700">
                    {t('reader.letterSpacing', 'Letter spacing')}
                  </label>
                  <span className="text-[11px] tabular-nums text-gray-500">
                    {(letterSpacing ?? 0).toFixed(3)}em
                  </span>
                </div>
                <input
                  id="letter-spacing"
                  type="range"
                  min={-0.05}
                  max={0.1}
                  step={0.005}
                  value={letterSpacing ?? 0}
                  onChange={(event) => onLetterSpacingChange(Number(event.target.value))}
                  className="w-full accent-teal-600"
                />
              </div>
            )}

            {onLineHeightChange && (
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label htmlFor="line-height" className="text-xs font-medium text-gray-700">
                    {t('reader.lineHeight', 'Line height')}
                  </label>
                  <span className="text-[11px] tabular-nums text-gray-500">
                    {(lineHeight ?? 1.8).toFixed(2)}
                  </span>
                </div>
                <input
                  id="line-height"
                  type="range"
                  min={1.4}
                  max={2.4}
                  step={0.05}
                  value={lineHeight ?? 1.8}
                  onChange={(event) => onLineHeightChange(Number(event.target.value))}
                  className="w-full accent-teal-600"
                />
              </div>
            )}

            {onFontWeightChange && (
              <div>
                <h4 className="mb-2 text-xs font-medium text-gray-700">
                  {t('reader.fontWeight', 'Font weight')}
                </h4>
                <div className="grid grid-cols-4 gap-2">
                  {FONT_WEIGHTS.map((weight) => (
                    <button
                      key={weight}
                      type="button"
                      onClick={() => onFontWeightChange(weight)}
                      className={`rounded-lg border px-2 py-1.5 text-[11px] transition-colors ${
                        (fontWeight ?? 400) === weight
                          ? 'border-teal-400 bg-teal-50 text-teal-800'
                          : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                      }`}
                      style={{ fontWeight: weight }}
                    >
                      {fontWeightLabels[weight]}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

export { FONT_SIZE_VALUES };
