/**
 * Calendar maths on local dates ("YYYY-MM-DD" strings).
 *
 * All grouping (days, weeks, months, budget periods) works on local calendar
 * dates rather than instants, so a coffee bought at 23:30 belongs to the day
 * it was bought regardless of time zone or DST. Arithmetic is done in UTC on
 * those dates so it never drifts by an hour.
 */
import type { LocalDate, PeriodSpec, PeriodUnit } from './types';

export interface CalendarPrefs {
  /** 0 = Sunday … 6 = Saturday. Default 1 (Monday). */
  weekStart: number;
  /** Day of month a "month" starts on (1–28). Default 1. */
  monthStartDay: number;
}

export const DEFAULT_CALENDAR: CalendarPrefs = { weekStart: 1, monthStartDay: 1 };

export interface DateRange {
  /** Inclusive. */
  start: LocalDate;
  /** Exclusive. */
  end: LocalDate;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function ymd(y: number, m: number, d: number): LocalDate {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

export function parts(date: LocalDate): [number, number, number] {
  return [Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10))];
}

function toUTC(date: LocalDate): number {
  const [y, m, d] = parts(date);
  return Date.UTC(y, m - 1, d);
}

function fromUTC(ms: number): LocalDate {
  const dt = new Date(ms);
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function toLocalDate(d: Date = new Date()): LocalDate {
  return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

export function today(): LocalDate {
  return toLocalDate(new Date());
}

export function addDays(date: LocalDate, n: number): LocalDate {
  return fromUTC(toUTC(date) + n * 86_400_000);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addMonths(date: LocalDate, n: number, clampDay?: number): LocalDate {
  const [y, m, d] = parts(date);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return ymd(ny, nm, Math.min(clampDay ?? d, daysInMonth(ny, nm)));
}

export function daysBetween(a: LocalDate, b: LocalDate): number {
  return Math.round((toUTC(b) - toUTC(a)) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday */
export function dayOfWeek(date: LocalDate): number {
  return new Date(toUTC(date)).getUTCDay();
}

export function minDate(a: LocalDate, b: LocalDate): LocalDate {
  return a < b ? a : b;
}
export function maxDate(a: LocalDate, b: LocalDate): LocalDate {
  return a > b ? a : b;
}

export function inRange(date: LocalDate, r: DateRange): boolean {
  return date >= r.start && date < r.end;
}

export function eachDay(r: DateRange): LocalDate[] {
  const out: LocalDate[] = [];
  for (let d = r.start; d < r.end; d = addDays(d, 1)) out.push(d);
  return out;
}

// ---------------------------------------------------------------------------
// Transaction timestamps

function offsetString(minutesEastOfUTC: number): string {
  const sign = minutesEastOfUTC >= 0 ? '+' : '-';
  const abs = Math.abs(minutesEastOfUTC);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** "2026-10-07T14:32:00-04:00" for a local date + "HH:MM" in this device's zone. */
export function makeOccurredAt(date: LocalDate, time: string): string {
  const [y, m, d] = parts(date);
  const [hh, mm] = (time || '12:00').split(':').map(Number);
  const local = new Date(y, m - 1, d, hh || 0, mm || 0, 0);
  return `${date}T${pad(hh || 0)}:${pad(mm || 0)}:00${offsetString(-local.getTimezoneOffset())}`;
}

export function nowOccurredAt(now: Date = new Date()): string {
  return makeOccurredAt(toLocalDate(now), `${pad(now.getHours())}:${pad(now.getMinutes())}`);
}

/** Local calendar date of a transaction (as it was where it happened). */
export function txDate(occurredAt: string): LocalDate {
  return occurredAt.slice(0, 10);
}

export function txTime(occurredAt: string): string {
  return occurredAt.slice(11, 16);
}

// ---------------------------------------------------------------------------
// Periods

function weekStartOf(date: LocalDate, prefs: CalendarPrefs): LocalDate {
  const back = (dayOfWeek(date) - prefs.weekStart + 7) % 7;
  return addDays(date, -back);
}

function monthStartOf(date: LocalDate, prefs: CalendarPrefs): LocalDate {
  const [y, m, d] = parts(date);
  const msd = prefs.monthStartDay;
  if (d >= Math.min(msd, daysInMonth(y, m))) return ymd(y, m, Math.min(msd, daysInMonth(y, m)));
  return addMonths(ymd(y, m, 1), -1, msd);
}

function monthIndex(date: LocalDate): number {
  const [y, m] = parts(date);
  return y * 12 + (m - 1);
}

/** The budget/stat period that contains `date`. */
export function periodContaining(date: LocalDate, spec: PeriodSpec, prefs: CalendarPrefs = DEFAULT_CALENDAR): DateRange {
  const count = Math.max(1, Math.floor(spec.count || 1));
  switch (spec.unit) {
    case 'day': {
      const off = ((daysBetween(spec.anchor, date) % count) + count) % count;
      const start = addDays(date, -off);
      return { start, end: addDays(start, count) };
    }
    case 'week': {
      let start = weekStartOf(date, prefs);
      if (count > 1) {
        const weeks = Math.round(daysBetween(weekStartOf(spec.anchor, prefs), start) / 7);
        start = addDays(start, -7 * (((weeks % count) + count) % count));
      }
      return { start, end: addDays(start, 7 * count) };
    }
    case 'month': {
      let start = monthStartOf(date, prefs);
      if (count > 1) {
        const months = monthIndex(start) - monthIndex(monthStartOf(spec.anchor, prefs));
        start = addMonths(start, -(((months % count) + count) % count), prefs.monthStartDay);
      }
      return { start, end: addMonths(start, count, prefs.monthStartDay) };
    }
    case 'year': {
      const [y] = parts(date);
      let sy = y;
      if (count > 1) {
        const [ay] = parts(spec.anchor);
        sy = y - ((((y - ay) % count) + count) % count);
      }
      return { start: ymd(sy, 1, 1), end: ymd(sy + count, 1, 1) };
    }
  }
}

/** The period `n` steps before (negative) or after (positive) `range`. */
export function shiftPeriod(range: DateRange, spec: PeriodSpec, n: number, prefs: CalendarPrefs = DEFAULT_CALENDAR): DateRange {
  let r = range;
  const step = n > 0 ? 1 : -1;
  for (let i = 0; i !== n; i += step) {
    r = periodContaining(step > 0 ? r.end : addDays(r.start, -1), spec, prefs);
  }
  return r;
}

export function simplePeriod(unit: PeriodUnit): PeriodSpec {
  return { unit, count: 1, anchor: '2024-01-01' };
}

/** Shift an arbitrary range by its own length (for "previous period" comparisons). */
export function previousRange(r: DateRange): DateRange {
  const len = daysBetween(r.start, r.end);
  // Whole months stay whole months so "last month" compares like with like.
  const [, , sd] = parts(r.start);
  const [, , ed] = parts(r.end);
  if (sd === ed && len >= 28) {
    const months = monthIndex(r.end) - monthIndex(r.start);
    return { start: addMonths(r.start, -months), end: r.start };
  }
  return { start: addDays(r.start, -len), end: r.start };
}

// ---------------------------------------------------------------------------
// Presets for pickers

export type RangePreset =
  | 'today'
  | 'thisWeek'
  | 'lastWeek'
  | 'thisMonth'
  | 'lastMonth'
  | 'last30'
  | 'last90'
  | 'thisYear'
  | 'lastYear'
  | 'all';

export const RANGE_PRESET_LABELS: Record<RangePreset, string> = {
  today: 'Today',
  thisWeek: 'This week',
  lastWeek: 'Last week',
  thisMonth: 'This month',
  lastMonth: 'Last month',
  last30: 'Last 30 days',
  last90: 'Last 90 days',
  thisYear: 'This year',
  lastYear: 'Last year',
  all: 'All time',
};

export function presetRange(p: RangePreset, prefs: CalendarPrefs = DEFAULT_CALENDAR, ref: LocalDate = today()): DateRange {
  switch (p) {
    case 'today':
      return { start: ref, end: addDays(ref, 1) };
    case 'thisWeek':
      return periodContaining(ref, simplePeriod('week'), prefs);
    case 'lastWeek':
      return shiftPeriod(periodContaining(ref, simplePeriod('week'), prefs), simplePeriod('week'), -1, prefs);
    case 'thisMonth':
      return periodContaining(ref, simplePeriod('month'), prefs);
    case 'lastMonth':
      return shiftPeriod(periodContaining(ref, simplePeriod('month'), prefs), simplePeriod('month'), -1, prefs);
    case 'last30':
      return { start: addDays(ref, -29), end: addDays(ref, 1) };
    case 'last90':
      return { start: addDays(ref, -89), end: addDays(ref, 1) };
    case 'thisYear':
      return periodContaining(ref, simplePeriod('year'), prefs);
    case 'lastYear':
      return shiftPeriod(periodContaining(ref, simplePeriod('year'), prefs), simplePeriod('year'), -1, prefs);
    case 'all':
      return { start: '1970-01-01', end: '9999-12-31' };
  }
}

// ---------------------------------------------------------------------------
// Formatting

export type DateFormat = 'dmy' | 'ymd' | 'mdy';

export const DATE_FORMAT_LABELS: Record<DateFormat, string> = {
  dmy: 'DD/MM/YYYY',
  ymd: 'YYYY-MM-DD (ISO)',
  mdy: 'MM/DD/YYYY',
};

export function formatDate(date: LocalDate, fmt: DateFormat = 'dmy'): string {
  const [y, m, d] = [date.slice(0, 4), date.slice(5, 7), date.slice(8, 10)];
  if (fmt === 'ymd') return `${y}-${m}-${d}`;
  if (fmt === 'mdy') return `${m}/${d}/${y}`;
  return `${d}/${m}/${y}`;
}

/** Short form without year, e.g. "07/10" or "10-07". */
export function formatShortDate(date: LocalDate, fmt: DateFormat = 'dmy'): string {
  const [m, d] = [date.slice(5, 7), date.slice(8, 10)];
  if (fmt === 'ymd') return `${m}-${d}`;
  if (fmt === 'mdy') return `${m}/${d}`;
  return `${d}/${m}`;
}

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDayHeading(date: LocalDate, fmt: DateFormat = 'dmy', ref: LocalDate = today()): string {
  const diff = daysBetween(date, ref);
  const base = `${WEEKDAYS[dayOfWeek(date)]} ${formatDate(date, fmt)}`;
  if (diff === 0) return `Today · ${base}`;
  if (diff === 1) return `Yesterday · ${base}`;
  return base;
}

export function formatRange(r: DateRange, fmt: DateFormat = 'dmy'): string {
  if (r.start <= '1970-01-01') return 'All time';
  const last = addDays(r.end, -1);
  if (last === r.start) return formatDate(r.start, fmt);
  return `${formatDate(r.start, fmt)} – ${formatDate(last, fmt)}`;
}

/** Human label for a period, e.g. "October 2026", "Week of 05/10", "2026". */
export function periodLabel(r: DateRange, unit: PeriodUnit, fmt: DateFormat = 'dmy'): string {
  const [y, m, d] = parts(r.start);
  if (unit === 'year' && daysBetween(r.start, r.end) <= 366) return String(y);
  if (unit === 'month' && d === 1 && daysBetween(r.start, r.end) <= 31) return `${MONTHS[m - 1]} ${y}`;
  if (unit === 'day' && daysBetween(r.start, r.end) === 1) return formatDayHeading(r.start, fmt);
  return formatRange(r, fmt);
}
