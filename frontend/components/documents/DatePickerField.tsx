'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '@/components/i18n/I18nProvider';
import { toLocaleDigits } from '@/lib/utils';
import {
  DATE_POPOVER_CLASS,
  DATE_TRIGGER_CLASS,
  dayCellClass,
} from './filterTokens';

export interface DatePickerFieldProps {
  /** Controlled value, "YYYY-MM-DD" Gregorian, or "" when unset. */
  value: string;
  /** Emits "YYYY-MM-DD" on pick, or "" on clear. */
  onChange: (value: string) => void;
  /** Inclusive lower bound "YYYY-MM-DD" (days before it are disabled). */
  min?: string;
  /** Inclusive upper bound "YYYY-MM-DD" (days after it are disabled). */
  max?: string;
  placeholder?: string;
  /** Accessible name for the trigger button. */
  ariaLabel?: string;
  disabled?: boolean;
}

/* ─── Timezone-safe date helpers (local fields only; never toISOString) ─── */

/** "YYYY-MM-DD" → local-midnight Date, or null if empty/malformed. */
function parseISODate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  const date = new Date(y, mo - 1, d); // local midnight, no UTC shift
  // Reject rollover like 2025-02-31 → Mar 3.
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date;
}

/** Date → "YYYY-MM-DD" from LOCAL fields. */
function formatISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function clampToRange(d: Date, min: Date | null, max: Date | null): Date {
  if (min && d < min) return min;
  if (max && d > max) return max;
  return d;
}

/* ─── Localization helpers (Gregorian display, locale digits) ─── */

function numberingSystemFor(locale: string): string {
  if (locale === 'ar') return 'arab'; // ٠١٢
  if (locale === 'fa' || locale === 'ur') return 'arabext'; // ۰۱۲
  return 'latn';
}

function formatDisplay(value: string, locale: string): string {
  const d = parseISODate(value);
  if (!d) return '';
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    calendar: 'gregory',
    numberingSystem: numberingSystemFor(locale),
  }).format(d);
}

// 0=Sun … 6=Sat. Saturday-start for Arabic/Persian weeks; Sunday for en/ur.
const FIRST_DAY_OF_WEEK: Record<string, number> = { ar: 6, fa: 6, ur: 0, en: 0 };
function firstDow(locale: string): number {
  return FIRST_DAY_OF_WEEK[locale] ?? 0;
}

/** Localized short weekday labels, ordered from the locale's first weekday. */
function weekdayLabels(locale: string): string[] {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short', calendar: 'gregory' });
  const start = firstDow(locale);
  // Aug 1 2021 was a Sunday (index 0).
  return Array.from({ length: 7 }, (_, c) => fmt.format(new Date(2021, 7, 1 + ((start + c) % 7))));
}

/** Flat cell array: leading nulls (blanks) then a Date for each day of the month. */
function buildMonthCells(year: number, month: number, locale: string): (Date | null)[] {
  const firstWeekday = new Date(year, month, 1).getDay();
  const lead = (firstWeekday - firstDow(locale) + 7) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate(); // leap-safe
  const cells: (Date | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  return cells;
}

function shiftMonth(y: number, m: number): { year: number; month: number } {
  const d = new Date(y, m, 1); // m = -1 or 12 normalizes correctly
  return { year: d.getFullYear(), month: d.getMonth() };
}

function NavBtn({
  onClick,
  label,
  flip,
  side,
}: {
  onClick: () => void;
  label: string;
  flip: boolean;
  side: 'prev' | 'next';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid h-7 w-7 place-items-center rounded-md text-[#6e6354] hover:bg-[#f4ecd8] hover:text-[#2c2620] transition-colors"
    >
      <svg
        className="h-4 w-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden
        style={{ transform: flip ? 'scaleX(-1)' : undefined }}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d={side === 'prev' ? 'M15 19l-7-7 7-7' : 'M9 5l7 7-7 7'} />
      </svg>
    </button>
  );
}

export default function DatePickerField({
  value,
  onChange,
  min,
  max,
  placeholder,
  ariaLabel,
  disabled = false,
}: DatePickerFieldProps) {
  const { t, locale, direction } = useI18n();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  const minD = useMemo(() => parseISODate(min), [min]);
  const maxD = useMemo(() => parseISODate(max), [max]);
  const selected = useMemo(() => parseISODate(value), [value]);

  const [visible, setVisible] = useState(() => {
    const base = parseISODate(value) ?? clampToRange(startOfDay(new Date()), parseISODate(min ?? null), parseISODate(max ?? null));
    return { year: base.getFullYear(), month: base.getMonth() };
  });

  // When the popover (re)opens, jump to the selected month (or today, clamped).
  useEffect(() => {
    if (!open) return;
    const base = parseISODate(value) ?? clampToRange(startOfDay(new Date()), minD, maxD);
    setVisible({ year: base.getFullYear(), month: base.getMonth() });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only re-sync on open
  }, [open]);

  // Outside-click + Escape close (mirrors LanguageSwitcher idiom).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const today = startOfDay(new Date());
  const isDisabled = (day: Date): boolean => (!!minD && day < minD) || (!!maxD && day > maxD);

  const monthTitle = new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    calendar: 'gregory',
    numberingSystem: numberingSystemFor(locale),
  }).format(new Date(visible.year, visible.month, 1));

  const pick = (day: Date) => {
    onChange(formatISODate(day));
    setOpen(false);
  };

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={`${DATE_TRIGGER_CLASS} ${open ? 'border-[#b07d2b] shadow-[0_0_0_4px_rgba(176,125,43,0.10)]' : ''}`}
      >
        <span dir="auto" className={value ? 'text-[#2c2620]' : 'text-[#9a8b70]'}>
          {value ? formatDisplay(value, locale) : placeholder ?? '—'}
        </span>

        <span className="flex items-center gap-1 shrink-0">
          {value && (
            <span
              role="button"
              tabIndex={0}
              aria-label={t('docs.clearDate', 'مسح التاريخ')}
              onClick={(e) => {
                e.stopPropagation();
                onChange('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  onChange('');
                }
              }}
              className="grid h-4 w-4 place-items-center rounded text-[#9a8b70] hover:text-[#2c2620]"
            >
              <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </span>
          )}
          <svg className="h-4 w-4 text-[#9a8b70]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
            <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
            <path d="M3 9h18M8 2.5v4M16 2.5v4" />
          </svg>
        </span>
      </button>

      {open && (
        <div dir={direction} role="dialog" aria-label={ariaLabel} className={DATE_POPOVER_CLASS}>
          {/* Header */}
          <div className="mb-2 flex items-center justify-between">
            <NavBtn
              onClick={() => setVisible((v) => shiftMonth(v.year, v.month - 1))}
              label={t('docs.prevMonth', 'الشهر السابق')}
              flip={direction === 'rtl'}
              side="prev"
            />
            <div className="text-[12.5px] font-medium text-[#2c2620]">{monthTitle}</div>
            <NavBtn
              onClick={() => setVisible((v) => shiftMonth(v.year, v.month + 1))}
              label={t('docs.nextMonth', 'الشهر التالي')}
              flip={direction === 'rtl'}
              side="next"
            />
          </div>

          {/* Weekday header */}
          <div className="mb-1 grid grid-cols-7 gap-0.5">
            {weekdayLabels(locale).map((w, i) => (
              <div key={i} className="grid h-7 place-items-center text-[10.5px] font-medium text-[#9a8b70]">
                {w}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div role="grid" className="grid grid-cols-7 gap-0.5">
            {buildMonthCells(visible.year, visible.month, locale).map((cell, i) => {
              if (!cell) return <div key={i} aria-hidden />;
              const sel = !!selected && isSameDay(cell, selected);
              const isToday = isSameDay(cell, today);
              const off = isDisabled(cell);
              return (
                <button
                  key={i}
                  type="button"
                  role="gridcell"
                  aria-selected={sel}
                  aria-current={isToday ? 'date' : undefined}
                  aria-disabled={off}
                  disabled={off}
                  onClick={() => pick(cell)}
                  className={dayCellClass({ selected: sel, today: isToday, disabled: off })}
                >
                  {toLocaleDigits(cell.getDate(), locale)}
                </button>
              );
            })}
          </div>

          {/* Footer */}
          <div className="mt-2 flex items-center justify-between border-t border-[#e7dbc1] pt-2 text-[11.5px]">
            <button
              type="button"
              disabled={isDisabled(today)}
              onClick={() => pick(today)}
              className="text-[#b07d2b] hover:text-[#2c2620] disabled:opacity-40 transition-colors"
            >
              {t('docs.today', 'اليوم')}
            </button>
            <button
              type="button"
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
              className="text-[#9a8b70] hover:text-[#2c2620] transition-colors"
            >
              {t('docs.clear', 'مسح')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
