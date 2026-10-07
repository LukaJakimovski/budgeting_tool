/**
 * Recurring transactions (rent, subscriptions…).
 *
 * Each occurrence gets a deterministic id ("rec_<ruleId>_<date>"), so two
 * offline devices generating the same occurrence produce the same document and
 * sync merges them instead of duplicating. Skipping an occurrence stores a
 * deleted tombstone under that id, which also stops it being regenerated.
 */
import { addDays, addMonths, daysBetween, makeOccurredAt, parts, today } from './dates';
import type { LocalDate, Recurring, Transaction } from './types';

const MAX_PER_RUN = 400;

export function occurrenceId(ruleId: string, date: LocalDate): string {
  return `rec_${ruleId}_${date}`;
}

function nth(rule: Recurring, i: number, startDay: number): LocalDate {
  const interval = Math.max(1, Math.floor(rule.interval || 1));
  switch (rule.freq) {
    case 'day':
      return addDays(rule.startDate, i * interval);
    case 'week':
      return addDays(rule.startDate, i * interval * 7);
    case 'month':
      return addMonths(rule.startDate, i * interval, startDay);
    case 'year':
      return addMonths(rule.startDate, i * interval * 12, startDay);
  }
}

/** Occurrence dates of a rule within [from, until] (inclusive). */
export function occurrences(rule: Recurring, until: LocalDate = today(), from: LocalDate = rule.startDate): LocalDate[] {
  const out: LocalDate[] = [];
  const last = rule.endDate && rule.endDate < until ? rule.endDate : until;
  const [, , startDay] = parts(rule.startDate);
  const interval = Math.max(1, Math.floor(rule.interval || 1));
  // Jump close to `from` instead of walking from the start date.
  let i = 0;
  if (from > rule.startDate) {
    const unitDays = { day: 1, week: 7, month: 31, year: 366 }[rule.freq];
    i = Math.max(0, Math.floor(daysBetween(rule.startDate, from) / (unitDays * interval)) - 1);
  }
  for (; out.length < MAX_PER_RUN; i++) {
    const d = nth(rule, i, startDay);
    if (d > last) break;
    if (d >= from) out.push(d);
  }
  return out;
}

export function nextOccurrence(rule: Recurring, after: LocalDate = today()): LocalDate | null {
  const unitDays = { day: 1, week: 7, month: 31, year: 366 }[rule.freq];
  const horizon = addDays(after, unitDays * Math.max(1, rule.interval) + 1);
  return occurrences(rule, horizon, addDays(after, 1))[0] ?? null;
}

export interface DueOccurrence {
  rule: Recurring;
  date: LocalDate;
  id: string;
}

/** Occurrences up to today that have no document yet (neither created nor skipped). */
export function dueOccurrences(rules: Recurring[], exists: (id: string) => boolean, until: LocalDate = today()): DueOccurrence[] {
  const out: DueOccurrence[] = [];
  for (const rule of rules) {
    if (!rule.active || rule.deleted) continue;
    // Look back at most a year so an old daily rule stays cheap.
    const from = rule.startDate > addDays(until, -366) ? rule.startDate : addDays(until, -366);
    for (const date of occurrences(rule, until, from)) {
      const id = occurrenceId(rule.id, date);
      if (!exists(id)) out.push({ rule, date, id });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function transactionFromOccurrence(
  o: DueOccurrence,
  base: { baseCurrency: string; baseAmount: number },
  rev: string,
): Transaction {
  const t = o.rule.template;
  return {
    id: o.id,
    type: 'transaction',
    rev,
    createdAt: new Date().toISOString(),
    kind: t.kind,
    occurredAt: makeOccurredAt(o.date, t.time || '09:00'),
    amount: t.amount,
    currency: t.currency,
    baseAmount: base.baseAmount,
    baseCurrency: base.baseCurrency,
    merchantId: t.merchantId,
    name: t.name || o.rule.name,
    categoryId: t.categoryId,
    paymentMethodId: t.paymentMethodId,
    channel: t.channel,
    tagIds: [...t.tagIds],
    description: t.description,
    purpose: t.purpose,
    splits: [],
    recurringId: o.rule.id,
  };
}

export function describeSchedule(rule: Pick<Recurring, 'freq' | 'interval'>): string {
  const n = Math.max(1, rule.interval);
  const unit = { day: 'day', week: 'week', month: 'month', year: 'year' }[rule.freq];
  if (n === 1) return { day: 'Daily', week: 'Weekly', month: 'Monthly', year: 'Yearly' }[rule.freq];
  return `Every ${n} ${unit}s`;
}

