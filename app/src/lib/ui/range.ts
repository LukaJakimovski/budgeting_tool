import { repo } from '../db/repo.svelte';
import { presetRange, type CalendarPrefs, type RangePreset } from '../core/dates';
import type { PeriodUnit } from '../core/types';

export interface RangeValue {
  start: string;
  end: string;
  /** Unit used for ‹ › stepping; 'days' steps by the range length. */
  unit: PeriodUnit | 'days' | 'all';
}

export function fromPreset(p: RangePreset, prefs: CalendarPrefs = repo.calendar()): RangeValue {
  const r = presetRange(p, prefs);
  const unit: RangeValue['unit'] =
    p === 'all'
      ? 'all'
      : p === 'thisWeek' || p === 'lastWeek'
        ? 'week'
        : p === 'thisMonth' || p === 'lastMonth'
          ? 'month'
          : p === 'thisYear' || p === 'lastYear'
            ? 'year'
            : p === 'today'
              ? 'day'
              : 'days';
  return { ...r, unit };
}

/** Read a range from URL query params (from, to, unit) or fall back to a preset. */
export function rangeFromQuery(q: URLSearchParams, fallback: RangePreset): RangeValue {
  const from = q.get('from');
  const to = q.get('to');
  const unit = q.get('unit') as RangeValue['unit'] | null;
  if (from && to && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return { start: from, end: to, unit: unit ?? 'days' };
  }
  const preset = q.get('range') as RangePreset | null;
  return fromPreset(preset ?? fallback);
}

export function rangeToQuery(r: RangeValue): Record<string, string> {
  return { from: r.start, to: r.end, unit: r.unit };
}
