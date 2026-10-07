/**
 * Domain operations used by the UI. Anything more involved than "update this
 * field" lives here so screens stay thin and modules can reuse it.
 */
import { repo } from './db/repo.svelte';
import { allocate, compileFilter, type Allocation } from './core/ledger';
import { evaluateBudget, type BudgetState } from './core/budgets';
import { convert } from './core/money';
import { dueOccurrences, transactionFromOccurrence, type DueOccurrence } from './core/recurring';
import { emit } from './modules/events';
import type { Budget, ID, Merchant, Tag, Transaction } from './core/types';

export type TxInput = Omit<Transaction, 'id' | 'type' | 'rev' | 'createdAt' | 'baseAmount' | 'baseCurrency' | 'deleted'> & {
  /** Exact amount in base currency (e.g. from the card statement); otherwise converted with the saved rate. */
  baseAmount?: number | null;
};

export function toBase(amount: number, currency: string, override?: number | null): { baseAmount: number; baseCurrency: string } {
  const base = repo.setting('baseCurrency');
  if (currency === base) return { baseAmount: amount, baseCurrency: base };
  if (override != null) return { baseAmount: override, baseCurrency: base };
  const rate = repo.setting('rates')[currency] ?? 1;
  return { baseAmount: convert(amount, currency, base, rate), baseCurrency: base };
}

export async function findOrCreateMerchant(name: string): Promise<Merchant> {
  const clean = name.trim();
  const existing = repo.merchants(true).find((m) => m.name.toLowerCase() === clean.toLowerCase());
  if (existing) {
    if (existing.archived) await repo.update<Merchant>(existing.id, { archived: false });
    return existing;
  }
  return repo.create('merchant', {
    name: clean,
    aliases: [],
    defaults: { categoryId: null, paymentMethodId: null, channel: null, tagIds: [], name: '', currency: null },
    learnDefaults: true,
    archived: false,
  });
}

export async function findOrCreateTag(name: string): Promise<Tag> {
  const clean = name.trim().replace(/^#/, '');
  const existing = repo.tags(true).find((t) => t.name.toLowerCase() === clean.toLowerCase());
  if (existing) {
    if (existing.archived) await repo.update<Tag>(existing.id, { archived: false });
    return existing;
  }
  return repo.create('tag', { name: clean, color: '', archived: false });
}

function activeBudgets(): Budget[] {
  return repo.list('budget').filter((b) => !b.archived);
}

/** Budget states for budgets that the given allocations count towards. */
export function budgetsFor(allocs: Allocation[]): BudgetState[] {
  const lookup = repo.lookup();
  const all = repo.allocations();
  const prefs = repo.calendar();
  const out: BudgetState[] = [];
  for (const b of activeBudgets()) {
    const m = compileFilter(b.filter, lookup);
    if (!allocs.some((a) => a.spend !== 0 && m(a))) continue;
    // Evaluate the period the transaction falls in (usually the current one).
    out.push(evaluateBudget(b, all, lookup, prefs, allocs[0].date, m));
  }
  return out;
}

export interface SaveResult {
  tx: Transaction;
  budgets: BudgetState[];
}

export async function saveTransaction(input: TxInput, existingId?: ID): Promise<SaveResult> {
  const { baseAmount: override, ...fields } = input;
  const base = toBase(fields.amount, fields.currency, override);
  const previous = existingId ? repo.get<Transaction>(existingId) : undefined;
  const beforeStates = previous ? [] : budgetsFor(allocate({ ...(fields as Transaction), ...base, id: '_', type: 'transaction', rev: '', createdAt: '' }, repo.moneyContext()));

  let tx: Transaction;
  if (previous) {
    tx = await repo.update<Transaction>(previous.id, { ...fields, ...base });
  } else {
    tx = await repo.create('transaction', { ...fields, ...base });
  }

  await learnMerchantDefaults(tx);

  const states = budgetsFor(allocate(tx, repo.moneyContext()));
  if (previous) {
    emit('transaction:updated', { tx, previous });
  } else {
    emit('transaction:created', { tx, budgets: states });
    for (const s of states) {
      const before = beforeStates.find((b) => b.budget.id === s.budget.id);
      if (s.status === 'over' && before?.status !== 'over') emit('budget:threshold', { state: s, crossed: 'over' });
      else if (s.status === 'warn' && before?.status === 'ok') emit('budget:threshold', { state: s, crossed: 'warn' });
    }
  }
  return { tx, budgets: states };
}

async function learnMerchantDefaults(tx: Transaction): Promise<void> {
  if (!tx.merchantId || tx.kind !== 'expense') return;
  const m = repo.get<Merchant>(tx.merchantId);
  if (!m || !m.learnDefaults) return;
  const next = {
    categoryId: tx.splits.length ? m.defaults.categoryId : tx.categoryId,
    paymentMethodId: tx.paymentMethodId,
    channel: tx.channel,
    tagIds: m.defaults.tagIds, // tags are usually per-purchase; don't learn them
    name: tx.name,
    currency: tx.currency,
  };
  if (JSON.stringify(next) !== JSON.stringify(m.defaults)) {
    await repo.update<Merchant>(m.id, { defaults: next });
  }
}

export async function deleteTransaction(id: ID): Promise<void> {
  const tx = repo.get<Transaction>(id);
  if (!tx) return;
  await repo.remove(id);
  emit('transaction:deleted', { tx });
}

/** Most-used categories (recent purchases weigh more), for quick-pick chips. */
export function frequentCategories(limit = 8): ID[] {
  const score = new Map<ID, number>();
  const txs = repo.transactions().slice(0, 300);
  txs.forEach((t, i) => {
    const w = 1 + (300 - i) / 300;
    const ids = t.splits.length ? t.splits.map((s) => s.categoryId) : [t.categoryId];
    for (const id of ids) if (id) score.set(id, (score.get(id) ?? 0) + w);
  });
  return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id);
}

/** Merchants ordered by how often and how recently they were used. */
export function frequentMerchants(): Map<ID, number> {
  const score = new Map<ID, number>();
  const txs = repo.transactions().slice(0, 500);
  txs.forEach((t, i) => {
    if (t.merchantId) score.set(t.merchantId, (score.get(t.merchantId) ?? 0) + 1 + (500 - i) / 250);
  });
  return score;
}

// ---------------------------------------------------------------------------
// Recurring

export function pendingRecurring(): DueOccurrence[] {
  return dueOccurrences(repo.list('recurring'), (id) => repo.has(id)).filter((o) => o.rule.mode === 'confirm');
}

/** Create transactions for due "auto" rules. Called at start-up and daily. */
export async function runRecurring(): Promise<number> {
  const due = dueOccurrences(repo.list('recurring'), (id) => repo.has(id)).filter((o) => o.rule.mode === 'auto');
  if (!due.length) return 0;
  await repo.save(due.map((o) => occurrenceTx(o)));
  return due.length;
}

function occurrenceTx(o: DueOccurrence): Transaction {
  const t = o.rule.template;
  return transactionFromOccurrence(o, toBase(t.amount, t.currency), '');
}

export async function confirmOccurrence(o: DueOccurrence): Promise<void> {
  await repo.save([occurrenceTx(o)]);
}

export async function skipOccurrence(o: DueOccurrence): Promise<void> {
  await repo.save([{ ...occurrenceTx(o), deleted: true }]);
}
