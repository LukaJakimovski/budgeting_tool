import { describe, expect, it } from 'vitest';
import { parseAmount, formatMoney, toDecimalString, allocateProportional, convert } from '../src/lib/core/money';
import { Clock, newer, SEED_REV, parseRev } from '../src/lib/core/hlc';
import {
  addMonths,
  makeOccurredAt,
  periodContaining,
  presetRange,
  previousRange,
  shiftPeriod,
  txDate,
  formatDate,
} from '../src/lib/core/dates';
import { allocate, compileFilter, expandCategories, totals, groupBy } from '../src/lib/core/ledger';
import { evaluateBudget, budgetHistory } from '../src/lib/core/budgets';
import { occurrences, dueOccurrences, nextOccurrence } from '../src/lib/core/recurring';
import { seedCategories } from '../src/lib/core/defaults';
import { newId } from '../src/lib/core/ids';
import type { Budget, Recurring, Transaction } from '../src/lib/core/types';

const ctx = { baseCurrency: 'CAD', rates: { EUR: 1.5 } };

function tx(p: Partial<Transaction>): Transaction {
  return {
    id: newId('tx_'),
    type: 'transaction',
    rev: 'x',
    createdAt: '2026-01-01T00:00:00Z',
    kind: 'expense',
    occurredAt: '2026-10-07T12:00:00-04:00',
    amount: 1000,
    currency: 'CAD',
    baseAmount: 1000,
    baseCurrency: 'CAD',
    merchantId: null,
    name: '',
    categoryId: 'cat_groceries',
    paymentMethodId: null,
    channel: null,
    tagIds: [],
    description: '',
    purpose: '',
    splits: [],
    ...p,
  };
}

describe('money', () => {
  it('parses common inputs', () => {
    expect(parseAmount('12', 'CAD')).toBe(1200);
    expect(parseAmount('12.5', 'CAD')).toBe(1250);
    expect(parseAmount('12,50', 'EUR')).toBe(1250);
    expect(parseAmount('$1,234.56', 'CAD')).toBe(123456);
    expect(parseAmount('1.234,56', 'EUR')).toBe(123456);
    expect(parseAmount('1,234', 'CAD')).toBe(123400);
    expect(parseAmount('0.005', 'CAD')).toBe(1);
    expect(parseAmount('.99', 'CAD')).toBe(99);
    expect(parseAmount('500', 'JPY')).toBe(500);
    expect(parseAmount('', 'CAD')).toBeNull();
    expect(parseAmount('abc', 'CAD')).toBeNull();
  });
  it('formats', () => {
    expect(formatMoney(123456, 'CAD')).toBe('$1,234.56');
    expect(formatMoney(1250, 'EUR')).toBe('€12.50');
    expect(toDecimalString(5, 'CAD')).toBe('0.05');
    expect(toDecimalString(-1234, 'CAD')).toBe('-12.34');
  });
  it('allocates exactly', () => {
    expect(allocateProportional(1000, [1, 1, 1])).toEqual([334, 333, 333]);
    expect(allocateProportional(1001, [500, 501]).reduce((a, b) => a + b)).toBe(1001);
    expect(convert(1000, 'EUR', 'CAD', 1.5)).toBe(1500);
  });
});

describe('hlc', () => {
  it('orders revisions and survives a clock going backwards', () => {
    let now = 1000;
    const c = new Clock('dev', () => now);
    const a = c.tick();
    now = 500;
    const b = c.tick();
    expect(b > a).toBe(true);
    expect(parseRev(b).counter).toBe(1);
    expect(newer(b, a)).toBe(true);
    expect(SEED_REV < a).toBe(true);
  });
  it('observes remote revisions', () => {
    const c = new Clock('a', () => 1000);
    const remote = new Clock('b', () => 5000).tick();
    c.observe(remote);
    expect(c.tick() > remote).toBe(true);
  });
});

describe('dates', () => {
  const prefs = { weekStart: 1, monthStartDay: 1 };
  it('weeks start on Monday', () => {
    // 2026-10-07 is a Wednesday
    expect(periodContaining('2026-10-07', { unit: 'week', count: 1, anchor: '2024-01-01' }, prefs)).toEqual({
      start: '2026-10-05',
      end: '2026-10-12',
    });
    expect(periodContaining('2026-10-04', { unit: 'week', count: 1, anchor: '2024-01-01' }, prefs).start).toBe('2026-09-28');
  });
  it('supports fortnights and custom month starts', () => {
    const fort = { unit: 'week' as const, count: 2, anchor: '2026-09-28' };
    expect(periodContaining('2026-10-07', fort, prefs)).toEqual({ start: '2026-09-28', end: '2026-10-12' });
    expect(periodContaining('2026-10-13', fort, prefs)).toEqual({ start: '2026-10-12', end: '2026-10-26' });
    const payday = { weekStart: 1, monthStartDay: 15 };
    expect(periodContaining('2026-10-07', { unit: 'month', count: 1, anchor: '2024-01-01' }, payday)).toEqual({
      start: '2026-09-15',
      end: '2026-10-15',
    });
  });
  it('shifts periods', () => {
    const m = { unit: 'month' as const, count: 1, anchor: '2024-01-01' };
    const cur = periodContaining('2026-03-31', m, prefs);
    expect(shiftPeriod(cur, m, -1, prefs)).toEqual({ start: '2026-02-01', end: '2026-03-01' });
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(previousRange({ start: '2026-10-01', end: '2026-11-01' })).toEqual({ start: '2026-09-01', end: '2026-10-01' });
    expect(presetRange('lastMonth', prefs, '2026-10-07')).toEqual({ start: '2026-09-01', end: '2026-10-01' });
  });
  it('keeps the local date of a timestamp', () => {
    const s = makeOccurredAt('2026-10-07', '23:30');
    expect(txDate(s)).toBe('2026-10-07');
    expect(s).toMatch(/^2026-10-07T23:30:00[+-]\d\d:\d\d$/);
    expect(formatDate('2026-10-07')).toBe('07/10/2026');
  });
});

describe('ledger', () => {
  const cats = new Map(seedCategories().map((c) => [c.id, c]));
  const lookup = { categories: cats, merchants: new Map(), tags: new Map() };
  it('allocates splits and converts currency', () => {
    const t = tx({ amount: 1000, currency: 'EUR', baseAmount: 1500, baseCurrency: 'CAD', splits: [
      { amount: 600, categoryId: 'cat_groceries', tagIds: [], note: '' },
      { amount: 400, categoryId: 'cat_treats', tagIds: ['tag_x'], note: 'chocolate' },
    ] });
    const a = allocate(t, ctx);
    expect(a.map((x) => x.amount)).toEqual([900, 600]);
    expect(a[1].tagIds).toEqual(['tag_x']);
  });
  it('filters by category including children', () => {
    expect(expandCategories(['cat_food'], cats).has('cat_treats')).toBe(true);
    const m = compileFilter({ categoryIds: ['cat_food'] }, lookup);
    expect(m(allocate(tx({ categoryId: 'cat_coffee' }), ctx)[0])).toBe(true);
    expect(m(allocate(tx({ categoryId: 'cat_fuel' }), ctx)[0])).toBe(false);
  });
  it('excludes tags, per split line', () => {
    const m = compileFilter({ categoryIds: ['cat_food'], excludeTagIds: ['tag_work'] }, lookup);
    expect(m(allocate(tx({ categoryId: 'cat_coffee' }), ctx)[0])).toBe(true);
    expect(m(allocate(tx({ categoryId: 'cat_coffee', tagIds: ['tag_work', 'tag_sam'] }), ctx)[0])).toBe(false);
    expect(m(allocate(tx({ categoryId: 'cat_fuel' }), ctx)[0])).toBe(false);
    // Only the split tagged #work is left out; a tag on the whole purchase leaves out every split.
    const split = [
      { amount: 600, categoryId: 'cat_groceries', tagIds: [], note: '' },
      { amount: 400, categoryId: 'cat_treats', tagIds: ['tag_work'], note: '' },
    ];
    expect(allocate(tx({ splits: split }), ctx).map(m)).toEqual([true, false]);
    expect(allocate(tx({ splits: split, tagIds: ['tag_work'] }), ctx).map(m)).toEqual([false, false]);
    // On its own an exclusion means "everything except".
    expect(compileFilter({ excludeTagIds: ['tag_work'] }, lookup)(allocate(tx({ categoryId: 'cat_fuel' }), ctx)[0])).toBe(true);
  });
  it('totals refunds against spending', () => {
    const allocs = [tx({ amount: 1000, baseAmount: 1000 }), tx({ kind: 'refund', amount: 300, baseAmount: 300 }), tx({ kind: 'income', amount: 5000, baseAmount: 5000 })]
      .flatMap((t) => allocate(t, ctx));
    const t = totals(allocs);
    expect(t.spent).toBe(700);
    expect(t.income).toBe(5000);
    expect(groupBy(allocs, (a) => a.categoryId ?? '').find((g) => g.key === 'cat_groceries')?.spend).toBe(700);
  });
});

describe('budgets', () => {
  const cats = new Map(seedCategories().map((c) => [c.id, c]));
  const lookup = { categories: cats, merchants: new Map(), tags: new Map() };
  const budget: Budget = {
    id: 'b', type: 'budget', rev: 'x', createdAt: '', name: 'Treats', amount: 2000,
    period: { unit: 'week', count: 1, anchor: '2024-01-01' }, filter: { categoryIds: ['cat_treats'] },
    warnAt: 0.8, icon: '', order: 0, archived: false,
  };
  it('evaluates spend, pace and status', () => {
    const allocs = [
      tx({ categoryId: 'cat_treats', amount: 1700, baseAmount: 1700, occurredAt: '2026-10-06T10:00:00-04:00' }),
      tx({ categoryId: 'cat_treats', amount: 500, baseAmount: 500, occurredAt: '2026-10-04T10:00:00-04:00' }), // previous week
      tx({ categoryId: 'cat_coffee', amount: 900, baseAmount: 900, occurredAt: '2026-10-06T10:00:00-04:00' }),
    ].flatMap((t) => allocate(t, ctx));
    const s = evaluateBudget(budget, allocs, lookup, { weekStart: 1, monthStartDay: 1 }, '2026-10-07');
    expect(s.spent).toBe(1700);
    expect(s.remaining).toBe(300);
    expect(s.status).toBe('warn');
    expect(s.daysLeft).toBe(5);
    expect(s.perDayLeft).toBe(60);
    const h = budgetHistory(budget, allocs, lookup, { weekStart: 1, monthStartDay: 1 }, 2, '2026-10-07');
    expect(h.map((x) => x.spent)).toEqual([500, 1700]);
  });
  it('leaves out excluded tags', () => {
    const food: Budget = { ...budget, filter: { categoryIds: ['cat_food'], excludeTagIds: ['tag_work'] } };
    const allocs = [
      tx({ categoryId: 'cat_groceries', amount: 1200, baseAmount: 1200, occurredAt: '2026-10-06T10:00:00-04:00' }),
      tx({ categoryId: 'cat_coffee', amount: 500, baseAmount: 500, occurredAt: '2026-10-06T10:00:00-04:00', tagIds: ['tag_work'] }),
    ].flatMap((t) => allocate(t, ctx));
    expect(evaluateBudget(food, allocs, lookup, { weekStart: 1, monthStartDay: 1 }, '2026-10-07').spent).toBe(1200);
  });
});

describe('recurring', () => {
  const rule: Recurring = {
    id: 'r1', type: 'recurring', rev: 'x', createdAt: '', name: 'Rent', freq: 'month', interval: 1,
    startDate: '2026-01-31', endDate: null, mode: 'auto', active: true,
    template: { kind: 'expense', amount: 150000, currency: 'CAD', merchantId: null, name: 'Rent', categoryId: 'cat_rent', paymentMethodId: null, channel: null, tagIds: [], description: '', purpose: '', time: '09:00' },
  };
  it('clamps month ends and finds due occurrences', () => {
    expect(occurrences(rule, '2026-04-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    const due = dueOccurrences([rule], (id) => id.endsWith('2026-01-31'), '2026-03-31');
    expect(due.map((d) => d.date)).toEqual(['2026-02-28', '2026-03-31']);
    expect(nextOccurrence(rule, '2026-04-30')).toBe('2026-05-31');
  });
  it('handles long-running daily rules', () => {
    const daily = { ...rule, freq: 'day' as const, startDate: '2020-01-01' };
    const due = dueOccurrences([daily], () => false, '2026-10-07');
    expect(due[due.length - 1].date).toBe('2026-10-07');
  });
});

import { sparseIndices, niceTicks } from '../src/lib/charts/scale';
describe('chart scales', () => {
  it('never labels adjacent columns when thinning', () => {
    const idx = [...sparseIndices(30, 16)].sort((a, b) => a - b);
    for (let i = 1; i < idx.length; i++) expect(idx[i] - idx[i - 1]).toBeGreaterThan(1);
    expect(sparseIndices(5, 10).size).toBe(5);
  });
  it('makes round ticks', () => {
    expect(niceTicks(1450, 4)).toEqual([0, 500, 1000, 1500]);
  });
});
