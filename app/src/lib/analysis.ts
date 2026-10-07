/**
 * View-model helpers shared by the Stats page and dashboard widgets.
 */
import { repo } from './db/repo.svelte';
import { compileFilter, groupBy, rootCategory, spendByDay, type Allocation } from './core/ledger';
import {
  addDays,
  addMonths,
  daysBetween,
  dayOfWeek,
  MONTHS,
  parts,
  periodContaining,
  simplePeriod,
  today,
  WEEKDAYS_LONG,
  type DateRange,
} from './core/dates';
import { slotColor } from './theme/chart';
import type { Category, Filter, ID, PaymentMethod } from './core/types';
import type { Column } from './charts/ColumnChart.svelte';
import type { HBar } from './charts/HBars.svelte';
import { shortDate, date as fmtDate } from './ui/format';

export function allocationsIn(range: DateRange, filter?: Filter): Allocation[] {
  const m = compileFilter(filter, repo.lookup());
  return repo.allocations().filter((a) => a.date >= range.start && a.date < range.end && m(a));
}

export type Granularity = 'day' | 'week' | 'month';

export function autoGranularity(range: DateRange): Granularity {
  const days = daysBetween(range.start, range.end);
  if (days <= 62) return 'day';
  if (days <= 190) return 'week';
  return 'month';
}

/** Spend per day/week/month across the range (empty buckets included). */
export function spendColumns(allocs: Allocation[], range: DateRange, g: Granularity = autoGranularity(range)): Column[] {
  const byDay = spendByDay(allocs);
  const prefs = repo.calendar();
  const t = today();
  const out: Column[] = [];
  // Clamp open-ended ranges ("all time") to the data.
  let start = range.start;
  let end = range.end;
  if (start <= '1970-01-01' || end >= '9999-01-01') {
    const dates = [...byDay.keys()].sort();
    start = dates[0] ?? t;
    end = addDays(dates[dates.length - 1] ?? t, 1);
  }
  let cursor = g === 'day' ? start : periodContaining(start, simplePeriod(g), prefs).start;
  let guard = 0;
  while (cursor < end && guard++ < 1000) {
    const next = g === 'day' ? addDays(cursor, 1) : g === 'week' ? addDays(cursor, 7) : addMonths(cursor, 1, prefs.monthStartDay);
    let sum = 0;
    for (let d = cursor < start ? start : cursor; d < next && d < end; d = addDays(d, 1)) sum += byDay.get(d) ?? 0;
    const [y, m] = parts(cursor);
    out.push({
      key: cursor,
      label: g === 'month' ? `${MONTHS[m - 1]}${m === 1 ? ` ${String(y).slice(2)}` : ''}` : shortDate(cursor),
      title: g === 'day' ? `${WEEKDAYS_LONG[dayOfWeek(cursor)]} ${fmtDate(cursor)}` : g === 'week' ? `Week of ${fmtDate(cursor)}` : `${MONTHS[m - 1]} ${y}`,
      value: sum,
      highlight: cursor <= t && t < next,
    });
    cursor = next;
  }
  return out;
}

/** Cumulative spend per day of the range (null after today). */
export function cumulative(allocs: Allocation[], range: DateRange, stopAt: string | null = today()): (number | null)[] {
  const byDay = spendByDay(allocs);
  const out: (number | null)[] = [];
  let acc = 0;
  for (let d = range.start; d < range.end; d = addDays(d, 1)) {
    acc += byDay.get(d) ?? 0;
    out.push(stopAt && d > stopAt ? null : acc);
  }
  return out;
}

export type Dimension = 'category' | 'subcategory' | 'merchant' | 'tag' | 'payment' | 'channel' | 'weekday';

export const DIMENSION_LABELS: Record<Dimension, string> = {
  category: 'Category',
  subcategory: 'Subcategory',
  merchant: 'Merchant',
  tag: 'Tag',
  payment: 'Payment method',
  channel: 'Online / in person',
  weekday: 'Weekday',
};

export interface BreakdownRow extends HBar {
  count: number;
  /** Filter that selects this row (for drill-down). */
  filter: Filter;
}

export function breakdown(allocs: Allocation[], dim: Dimension, mode: 'light' | 'dark' = 'light'): BreakdownRow[] {
  const cats = repo.lookup().categories;
  const spendOnly = allocs.filter((a) => a.tx.kind !== 'income');
  const keyOf = (a: Allocation): string | string[] => {
    switch (dim) {
      case 'category':
        return rootCategory(a.categoryId, cats) ?? '';
      case 'subcategory':
        return a.categoryId ?? '';
      case 'merchant':
        return a.tx.merchantId ?? '';
      case 'tag':
        return a.tagIds.length ? a.tagIds : [''];
      case 'payment':
        return a.tx.paymentMethodId ?? '';
      case 'channel':
        return a.tx.channel ?? '';
      case 'weekday':
        return String(dayOfWeek(a.date));
    }
  };
  const groups = groupBy(spendOnly, keyOf);
  const roots = [...cats.values()].filter((c) => !c.parentId).sort((a, b) => a.order - b.order);
  const rows: BreakdownRow[] = groups.map((g) => {
    const id = g.key as ID;
    let label = '';
    let icon: string | undefined;
    let swatch: string | undefined;
    let filter: Filter = {};
    switch (dim) {
      case 'category':
      case 'subcategory': {
        const c = id ? (cats.get(id) as Category | undefined) : undefined;
        label = c ? c.name : 'Uncategorised';
        icon = c?.icon;
        if (dim === 'category' && c) swatch = slotColor(c.color, roots.indexOf(c), mode);
        if (dim === 'subcategory' && c?.parentId) {
          const p = cats.get(c.parentId);
          label = `${c.name}`;
          icon = c.icon || p?.icon;
        }
        filter = id ? { categoryIds: [id] } : {};
        break;
      }
      case 'merchant':
        label = id ? (repo.get(id) as { name?: string })?.name ?? '?' : 'No merchant';
        filter = id ? { merchantIds: [id] } : {};
        break;
      case 'tag':
        label = id ? '#' + ((repo.get(id) as { name?: string })?.name ?? '?') : 'Untagged';
        filter = id ? { tagIds: [id] } : {};
        break;
      case 'payment':
        label = id ? (repo.get<PaymentMethod>(id)?.name ?? '?') : 'Not set';
        filter = id ? { paymentMethodIds: [id] } : {};
        break;
      case 'channel':
        label = id === 'online' ? 'Online' : id === 'in_person' ? 'In person' : 'Not set';
        filter = id ? { channels: [id as 'online' | 'in_person'] } : {};
        break;
      case 'weekday':
        label = WEEKDAYS_LONG[Number(id)];
        break;
    }
    return { key: g.key || '_none', label, icon, swatch, value: g.spend, count: g.count, filter, sub: undefined };
  });
  if (dim === 'weekday') {
    const ws = repo.setting('weekStart');
    return rows.sort((a, b) => ((Number(a.key) - ws + 7) % 7) - ((Number(b.key) - ws + 7) % 7));
  }
  return rows.sort((a, b) => b.value - a.value);
}
