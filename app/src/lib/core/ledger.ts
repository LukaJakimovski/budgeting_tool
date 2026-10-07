/**
 * Turning transactions into numbers: allocation lines, filters, grouping.
 *
 * An "allocation" is one category-sized piece of a transaction. A normal
 * purchase is one allocation; a split purchase is one per split. Everything
 * analytical (budgets, stats, widgets) works on allocations, so split
 * purchases count towards the right categories everywhere.
 */
import { allocateProportional, convert } from './money';
import { txDate } from './dates';
import type { DateRange } from './dates';
import type {
  Category,
  CurrencyCode,
  Filter,
  ID,
  LocalDate,
  Merchant,
  Minor,
  Tag,
  Transaction,
} from './types';

export interface MoneyContext {
  baseCurrency: CurrencyCode;
  /** Units of base currency per 1 unit of the keyed currency. */
  rates: Record<CurrencyCode, number>;
}

export interface Allocation {
  tx: Transaction;
  date: LocalDate;
  /** Positive, base-currency minor units. */
  amount: Minor;
  /** +amount for expenses, -amount for refunds, 0 for income. */
  spend: Minor;
  categoryId: ID | null;
  tagIds: ID[];
  /** Index into tx.splits, or -1 for an unsplit transaction. */
  split: number;
}

export function baseAmountOf(tx: Transaction, ctx: MoneyContext): Minor {
  if (tx.baseCurrency === ctx.baseCurrency) return tx.baseAmount;
  if (tx.currency === ctx.baseCurrency) return tx.amount;
  const rate = ctx.rates[tx.baseCurrency];
  return rate ? convert(tx.baseAmount, tx.baseCurrency, ctx.baseCurrency, rate) : tx.baseAmount;
}

export function allocate(tx: Transaction, ctx: MoneyContext): Allocation[] {
  const date = txDate(tx.occurredAt);
  const base = baseAmountOf(tx, ctx);
  const sign = tx.kind === 'expense' ? 1 : tx.kind === 'refund' ? -1 : 0;
  if (!tx.splits || tx.splits.length === 0) {
    return [{ tx, date, amount: base, spend: sign * base, categoryId: tx.categoryId, tagIds: tx.tagIds, split: -1 }];
  }
  const parts = allocateProportional(base, tx.splits.map((s) => s.amount));
  return tx.splits.map((s, i) => ({
    tx,
    date,
    amount: parts[i],
    spend: sign * parts[i],
    categoryId: s.categoryId ?? tx.categoryId,
    tagIds: s.tagIds.length ? Array.from(new Set([...tx.tagIds, ...s.tagIds])) : tx.tagIds,
    split: i,
  }));
}

export function allocateAll(txs: Iterable<Transaction>, ctx: MoneyContext): Allocation[] {
  const out: Allocation[] = [];
  for (const tx of txs) if (!tx.deleted) for (const a of allocate(tx, ctx)) out.push(a);
  return out;
}

// ---------------------------------------------------------------------------
// Filtering

export interface Lookup {
  categories: Map<ID, Category>;
  merchants: Map<ID, Merchant>;
  tags: Map<ID, Tag>;
}

/** Category ids plus all their descendants. */
export function expandCategories(ids: ID[], categories: Map<ID, Category>): Set<ID> {
  const out = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of categories.values()) {
      if (c.parentId && out.has(c.parentId) && !out.has(c.id)) {
        out.add(c.id);
        grew = true;
      }
    }
  }
  return out;
}

export function isFilterEmpty(f: Filter | undefined): boolean {
  if (!f) return true;
  return (
    !f.categoryIds?.length &&
    !f.tagIds?.length &&
    !f.merchantIds?.length &&
    !f.paymentMethodIds?.length &&
    !f.channels?.length &&
    !f.kinds?.length &&
    !f.text?.trim() &&
    f.minAmount == null &&
    f.maxAmount == null &&
    f.hasAttachment == null
  );
}

export type Matcher = (a: Allocation) => boolean;

export function compileFilter(f: Filter | undefined, lookup: Lookup): Matcher {
  if (isFilterEmpty(f)) return () => true;
  const filter = f!;
  const cats = filter.categoryIds?.length ? expandCategories(filter.categoryIds, lookup.categories) : null;
  const tags = filter.tagIds?.length ? new Set(filter.tagIds) : null;
  const merchants = filter.merchantIds?.length ? new Set(filter.merchantIds) : null;
  const methods = filter.paymentMethodIds?.length ? new Set(filter.paymentMethodIds) : null;
  const channels = filter.channels?.length ? new Set(filter.channels) : null;
  const kinds = filter.kinds?.length ? new Set(filter.kinds) : null;
  const words = (filter.text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  return (a) => {
    const tx = a.tx;
    if (cats && !(a.categoryId && cats.has(a.categoryId))) return false;
    if (tags && !a.tagIds.some((t) => tags.has(t))) return false;
    if (merchants && !(tx.merchantId && merchants.has(tx.merchantId))) return false;
    if (methods && !(tx.paymentMethodId && methods.has(tx.paymentMethodId))) return false;
    if (channels && !(tx.channel && channels.has(tx.channel))) return false;
    if (kinds && !kinds.has(tx.kind)) return false;
    if (filter.minAmount != null && a.amount < filter.minAmount) return false;
    if (filter.maxAmount != null && a.amount > filter.maxAmount) return false;
    if (filter.hasAttachment != null && ((tx.attachments?.length ?? 0) > 0) !== filter.hasAttachment) return false;
    if (words.length) {
      const hay = searchText(a, lookup);
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  };
}

function searchText(a: Allocation, lookup: Lookup): string {
  const tx = a.tx;
  const bits = [
    tx.name,
    tx.description,
    tx.purpose,
    tx.bankDescription ?? '',
    tx.merchantId ? lookup.merchants.get(tx.merchantId)?.name ?? '' : '',
    a.categoryId ? lookup.categories.get(a.categoryId)?.name ?? '' : '',
    ...a.tagIds.map((t) => lookup.tags.get(t)?.name ?? ''),
    a.split >= 0 ? tx.splits[a.split].note : '',
  ];
  return bits.join(' ').toLowerCase();
}

export function inDateRange(range: DateRange): Matcher {
  return (a) => a.date >= range.start && a.date < range.end;
}

// ---------------------------------------------------------------------------
// Aggregation

export interface Totals {
  /** Expenses minus refunds. */
  spent: Minor;
  expenses: Minor;
  refunds: Minor;
  income: Minor;
  /** Number of distinct transactions. */
  count: number;
}

export function totals(allocs: Allocation[]): Totals {
  const t: Totals = { spent: 0, expenses: 0, refunds: 0, income: 0, count: 0 };
  const seen = new Set<string>();
  for (const a of allocs) {
    if (a.tx.kind === 'expense') t.expenses += a.amount;
    else if (a.tx.kind === 'refund') t.refunds += a.amount;
    else t.income += a.amount;
    if (!seen.has(a.tx.id)) {
      seen.add(a.tx.id);
      t.count++;
    }
  }
  t.spent = t.expenses - t.refunds;
  return t;
}

export interface Group {
  key: string;
  spend: Minor;
  income: Minor;
  count: number;
}

/** Group allocations by a key; one allocation may land in several groups (e.g. tags). */
export function groupBy(allocs: Allocation[], keys: (a: Allocation) => string | string[]): Group[] {
  const map = new Map<string, Group & { txs: Set<string> }>();
  for (const a of allocs) {
    const k = keys(a);
    for (const key of Array.isArray(k) ? k : [k]) {
      let g = map.get(key);
      if (!g) map.set(key, (g = { key, spend: 0, income: 0, count: 0, txs: new Set() }));
      if (a.tx.kind === 'income') g.income += a.amount;
      else g.spend += a.spend;
      g.txs.add(a.tx.id);
    }
  }
  return Array.from(map.values(), ({ txs, ...g }) => ({ ...g, count: txs.size }));
}

/** Spend per local date. */
export function spendByDay(allocs: Allocation[]): Map<LocalDate, Minor> {
  const m = new Map<LocalDate, Minor>();
  for (const a of allocs) if (a.spend) m.set(a.date, (m.get(a.date) ?? 0) + a.spend);
  return m;
}

/** Top-level ancestor of a category (for roll-ups). */
export function rootCategory(id: ID | null, categories: Map<ID, Category>): ID | null {
  let cur = id ? categories.get(id) : undefined;
  let guard = 0;
  while (cur?.parentId && guard++ < 20) {
    const p = categories.get(cur.parentId);
    if (!p) break;
    cur = p;
  }
  return cur?.id ?? id;
}

export function categoryPath(id: ID | null, categories: Map<ID, Category>): string {
  const names: string[] = [];
  let cur = id ? categories.get(id) : undefined;
  let guard = 0;
  while (cur && guard++ < 20) {
    names.unshift(cur.name);
    cur = cur.parentId ? categories.get(cur.parentId) : undefined;
  }
  return names.join(' › ');
}
