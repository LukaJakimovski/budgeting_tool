import { beforeAll, describe, expect, it } from 'vitest';
import { repo } from '../src/lib/db/repo.svelte';
import { LocalDB } from '../src/lib/db/idb';
import { pastPart, spendColumns } from '../src/lib/analysis';
import { rangeFromQuery } from '../src/lib/ui/range';
import { addDays, daysBetween, presetRange, today } from '../src/lib/core/dates';

beforeAll(async () => {
  await repo.init(await LocalDB.open('stats'));
});

describe('no future dates', () => {
  it('cuts ranges and chart columns off at today', () => {
    const t = today();
    const month = presetRange('thisMonth', repo.calendar());
    expect(pastPart(month)).toEqual({ start: month.start, end: addDays(t, 1) });
    const cols = spendColumns([], month, 'day');
    expect(cols.length).toBe(daysBetween(month.start, t) + 1);
    expect(cols[cols.length - 1].key).toBe(t);
    // A whole year by month ends with the current month
    const year = presetRange('thisYear', repo.calendar());
    expect(spendColumns([], year, 'month').at(-1)?.highlight).toBe(true);
    // Past ranges are untouched; a future one is empty
    const last = presetRange('lastMonth', repo.calendar());
    expect(pastPart(last)).toEqual(last);
    const next = { start: addDays(t, 10), end: addDays(t, 20) };
    expect(spendColumns([], next, 'day')).toEqual([]);
  });

  it('ignores links to periods that have not started', () => {
    const future = new URLSearchParams({ from: addDays(today(), 40), to: addDays(today(), 70), unit: 'month' });
    expect(rangeFromQuery(future, 'thisMonth')).toMatchObject(presetRange('thisMonth', repo.calendar()));
    const past = new URLSearchParams({ from: '2025-01-01', to: '2025-02-01', unit: 'month' });
    expect(rangeFromQuery(past, 'thisMonth')).toEqual({ start: '2025-01-01', end: '2025-02-01', unit: 'month' });
  });
});
