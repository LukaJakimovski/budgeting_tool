/**
 * Budget evaluation. A budget is a limit on the spend of every allocation that
 * matches its filter, inside a repeating period. Budgets may overlap freely
 * (e.g. "Food / week" and "Sweet treats / week").
 */
import { compileFilter, type Allocation, type Lookup } from './ledger';
import { daysBetween, periodContaining, shiftPeriod, today, type CalendarPrefs, type DateRange } from './dates';
import type { Budget, LocalDate, Minor } from './types';

export type BudgetStatus = 'ok' | 'warn' | 'over';

export interface BudgetState {
  budget: Budget;
  range: DateRange;
  spent: Minor;
  limit: Minor;
  remaining: Minor;
  /** spent / limit (can exceed 1). */
  ratio: number;
  /** Fraction of the period that has elapsed, counting today (0..1). */
  elapsed: number;
  /** Spend you'd expect by now if spending evenly. */
  expectedByNow: Minor;
  /** What's left to spend per remaining day (including today). */
  perDayLeft: Minor;
  daysLeft: number;
  status: BudgetStatus;
  /** True when spending is ahead of an even pace. */
  aheadOfPace: boolean;
}

export function statusFor(ratio: number, warnAt: number): BudgetStatus {
  if (ratio > 1) return 'over';
  if (ratio >= warnAt) return 'warn';
  return 'ok';
}

export function evaluateBudget(
  budget: Budget,
  allocs: Allocation[],
  lookup: Lookup,
  prefs: CalendarPrefs,
  date: LocalDate = today(),
  match = compileFilter(budget.filter, lookup),
): BudgetState {
  const range = periodContaining(date, budget.period, prefs);
  return stateFor(budget, range, allocs, match, date);
}

function stateFor(budget: Budget, range: DateRange, allocs: Allocation[], match: (a: Allocation) => boolean, date: LocalDate): BudgetState {
  let spent = 0;
  for (const a of allocs) {
    if (a.date >= range.start && a.date < range.end && a.spend !== 0 && match(a)) spent += a.spend;
  }
  const total = Math.max(1, daysBetween(range.start, range.end));
  const done = Math.min(total, Math.max(0, daysBetween(range.start, date) + 1));
  const elapsed = done / total;
  const limit = budget.amount;
  const remaining = limit - spent;
  const daysLeft = Math.max(1, total - done + 1);
  const ratio = limit > 0 ? spent / limit : spent > 0 ? Infinity : 0;
  const expectedByNow = Math.round(limit * elapsed);
  return {
    budget,
    range,
    spent,
    limit,
    remaining,
    ratio,
    elapsed,
    expectedByNow,
    perDayLeft: remaining > 0 ? Math.floor(remaining / daysLeft) : 0,
    daysLeft,
    status: statusFor(ratio, budget.warnAt),
    aheadOfPace: spent > expectedByNow,
  };
}

/** The current period and `n - 1` previous ones, oldest first. */
export function budgetHistory(
  budget: Budget,
  allocs: Allocation[],
  lookup: Lookup,
  prefs: CalendarPrefs,
  n: number,
  date: LocalDate = today(),
): BudgetState[] {
  const match = compileFilter(budget.filter, lookup);
  const current = periodContaining(date, budget.period, prefs);
  const out: BudgetState[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const r = shiftPeriod(current, budget.period, -i, prefs);
    out.push(stateFor(budget, r, allocs, match, i === 0 ? date : r.end));
  }
  return out;
}

/** Budgets a given allocation counts towards (used for the "after you save" feedback). */
export function budgetsAffectedBy(allocs: Allocation[], budgets: Budget[], lookup: Lookup): Budget[] {
  return budgets.filter((b) => {
    const m = compileFilter(b.filter, lookup);
    return allocs.some((a) => a.spend !== 0 && m(a));
  });
}
