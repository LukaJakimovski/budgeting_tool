/**
 * Edits that touch many documents at once: bulk transaction edits (History's
 * selection mode) and merging merchants. Every operation returns an `undo`
 * that puts the previous versions back.
 */
import { repo } from './db/repo.svelte';
import { emit } from './modules/events';
import { cleanDescriptor, isUsefulAlias, looksLikeBankText, merchantGroupKey, merchantKey } from './core/banktext';
import type { Budget, Doc, ID, Merchant, Recurring, Tag, Transaction } from './core/types';

export type Undo = () => Promise<void>;

async function saveChunked(docs: Doc[]): Promise<void> {
  for (let i = 0; i < docs.length; i += 400) await repo.save(docs.slice(i, i + 400));
}

/** Save new versions of documents; the undo restores what was there before (or deletes what was new). */
async function apply(next: Doc[]): Promise<Undo> {
  const before = next.map((d) => repo.raw(d.id));
  await saveChunked(next);
  return async () => {
    await saveChunked(next.map((d, i) => before[i] ?? { ...(repo.raw(d.id) ?? d), deleted: true }));
  };
}

function liveTxs(ids: Iterable<ID>): Transaction[] {
  const out: Transaction[] = [];
  for (const id of ids) {
    const t = repo.get<Transaction>(id);
    if (t?.type === 'transaction') out.push(t);
  }
  return out;
}

export interface BulkResult {
  /** Transactions changed. */
  count: number;
  /** Selected transactions left alone (e.g. split purchases for "set category"). */
  skipped: number;
  undo: Undo;
}

export async function deleteTransactions(ids: Iterable<ID>): Promise<BulkResult> {
  const txs = liveTxs(ids);
  const undo = await apply(txs.map((t) => ({ ...t, deleted: true })));
  for (const tx of txs) emit('transaction:deleted', { tx });
  return { count: txs.length, skipped: 0, undo };
}

/** Split purchases keep their per-split categories. */
export async function setCategory(ids: Iterable<ID>, categoryId: ID | null): Promise<BulkResult> {
  const txs = liveTxs(ids);
  const change = txs.filter((t) => !t.splits.length && t.categoryId !== categoryId);
  const undo = await apply(change.map((t) => ({ ...t, categoryId })));
  return { count: change.length, skipped: txs.filter((t) => t.splits.length).length, undo };
}

function newMerchantDoc(name: string, like: Transaction[]): Merchant {
  // Default category: the one most of these purchases already have.
  const n = new Map<ID, number>();
  for (const t of like) if (t.categoryId && !t.splits.length) n.set(t.categoryId, (n.get(t.categoryId) ?? 0) + 1);
  const categoryId = [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return {
    id: repo.newId('merchant'),
    type: 'merchant',
    rev: '',
    createdAt: new Date().toISOString(),
    name: name.trim(),
    aliases: [],
    defaults: { categoryId, paymentMethodId: null, channel: null, tagIds: [], name: '', currency: null },
    learnDefaults: true,
    archived: false,
  };
}

function merchantByName(name: string): Merchant | undefined {
  const key = name.trim().toLowerCase();
  return repo.merchants(true).find((m) => m.name.toLowerCase() === key);
}

/** Give the selected transactions one merchant: an existing one (id) or one by name (created if new). */
export async function setMerchant(ids: Iterable<ID>, target: { id: ID } | { name: string }): Promise<BulkResult> {
  const txs = liveTxs(ids);
  const docs: Doc[] = [];
  let merchant = 'id' in target ? repo.get<Merchant>(target.id) : merchantByName(target.name);
  if (!merchant && 'name' in target && target.name.trim()) {
    merchant = newMerchantDoc(target.name, txs);
    docs.push(merchant);
  } else if (merchant?.archived) docs.push({ ...merchant, archived: false });
  if (!merchant) return { count: 0, skipped: txs.length, undo: async () => {} };
  const change = txs.filter((t) => t.merchantId !== merchant!.id);
  docs.push(...change.map((t) => ({ ...t, merchantId: merchant!.id })));
  return { count: change.length, skipped: 0, undo: await apply(docs) };
}

export async function addTag(ids: Iterable<ID>, name: string): Promise<BulkResult> {
  const clean = name.trim().replace(/^#/, '');
  const txs = liveTxs(ids);
  if (!clean) return { count: 0, skipped: txs.length, undo: async () => {} };
  const docs: Doc[] = [];
  let tag = repo.tags(true).find((t) => t.name.toLowerCase() === clean.toLowerCase());
  if (!tag) {
    tag = { id: repo.newId('tag'), type: 'tag', rev: '', createdAt: new Date().toISOString(), name: clean, color: '', archived: false } satisfies Tag;
    docs.push(tag);
  } else if (tag.archived) docs.push({ ...tag, archived: false });
  const change = txs.filter((t) => !t.tagIds.includes(tag!.id));
  docs.push(...change.map((t) => ({ ...t, tagIds: [...t.tagIds, tag!.id] })));
  return { count: change.length, skipped: 0, undo: await apply(docs) };
}

/** Removes the tag from the purchase and from each of its splits. */
export async function removeTag(ids: Iterable<ID>, tagId: ID): Promise<BulkResult> {
  const change = liveTxs(ids).filter((t) => t.tagIds.includes(tagId) || t.splits.some((s) => s.tagIds.includes(tagId)));
  const drop = (ids: ID[]) => ids.filter((x) => x !== tagId);
  const undo = await apply(change.map((t) => ({ ...t, tagIds: drop(t.tagIds), splits: t.splits.map((s) => ({ ...s, tagIds: drop(s.tagIds) })) })));
  return { count: change.length, skipped: 0, undo };
}

// ---------------------------------------------------------------------------
// Merchants

/** Merchants still used by transactions are archived instead (their history keeps the name). */
export async function deleteMerchants(ids: Iterable<ID>): Promise<{ deleted: number; archived: number; undo: Undo }> {
  const used = new Set(repo.transactions().map((t) => t.merchantId));
  const docs: Merchant[] = [];
  let archived = 0;
  for (const id of ids) {
    const m = repo.get<Merchant>(id);
    if (!m) continue;
    if (used.has(id)) {
      if (!m.archived) (docs.push({ ...m, archived: true }), archived++);
    } else docs.push({ ...m, deleted: true });
  }
  return { deleted: docs.length - archived, archived, undo: await apply(docs) };
}

export interface MergeResult {
  merchants: number;
  transactions: number;
  undo: Undo;
}

/** Pending edits while planning several merges: later steps see earlier ones. */
class Plan {
  docs = new Map<ID, Doc>();
  get<T extends Doc>(id: ID): T | undefined {
    const d = (this.docs.get(id) ?? repo.get(id)) as T | undefined;
    return d && !d.deleted ? d : undefined;
  }
  put(d: Doc) {
    this.docs.set(d.id, d);
  }
}

function planMerge(plan: Plan, sourceIds: ID[], target: { id: ID } | { name: string }): { merchants: number; transactions: number } {
  const sources = sourceIds.map((id) => plan.get<Merchant>(id)).filter((m): m is Merchant => !!m);
  const txCount = new Map<ID, number>();
  for (const t of repo.transactions()) if (t.merchantId) txCount.set(t.merchantId, (txCount.get(t.merchantId) ?? 0) + 1);
  sources.sort((a, b) => (txCount.get(b.id) ?? 0) - (txCount.get(a.id) ?? 0));

  let into: Merchant | undefined;
  if ('id' in target) into = plan.get<Merchant>(target.id);
  else {
    const name = target.name.trim();
    if (!name) return { merchants: 0, transactions: 0 };
    // An existing merchant with that name, else the busiest source renamed, else a new one.
    into = merchantByName(name) ?? sources.find((m) => m.name.toLowerCase() === name.toLowerCase());
    into = into ? { ...into, name } : sources.length ? { ...sources[0], name } : newMerchantDoc(name, []);
  }
  if (!into) return { merchants: 0, transactions: 0 };
  const targetId = into.id;
  const from = sources.filter((m) => m.id !== targetId);
  const fromIds = new Set(from.map((m) => m.id));

  // Bank names of the merged merchants become aliases, so future imports find the target.
  const aliases = new Set(into.aliases.filter(isUsefulAlias));
  const targetKey = merchantKey(into.name);
  for (const m of [...from, ...sources.filter((m) => m.id === targetId)]) {
    for (const a of m.aliases) if (isUsefulAlias(a)) aliases.add(a);
    const bankName = (looksLikeBankText(m.name) ? cleanDescriptor(m.name) : m.name).toLowerCase();
    if (merchantKey(bankName) !== targetKey && isUsefulAlias(bankName)) aliases.add(bankName);
  }
  const defaults = { ...into.defaults };
  if (!defaults.categoryId) defaults.categoryId = from.find((m) => m.defaults.categoryId)?.defaults.categoryId ?? null;
  plan.put({ ...into, aliases: [...aliases], defaults, archived: false });

  let moved = 0;
  for (const t of repo.transactions()) {
    const cur = plan.get<Transaction>(t.id) ?? t;
    if (cur.merchantId && fromIds.has(cur.merchantId)) {
      plan.put({ ...cur, merchantId: targetId });
      moved++;
    }
  }
  for (const r of repo.list('recurring')) {
    const cur = plan.get<Recurring>(r.id) ?? r;
    if (cur.template.merchantId && fromIds.has(cur.template.merchantId)) plan.put({ ...cur, template: { ...cur.template, merchantId: targetId } });
  }
  for (const b of repo.list('budget')) {
    const cur = plan.get<Budget>(b.id) ?? b;
    const ids = cur.filter.merchantIds;
    if (ids?.some((id) => fromIds.has(id))) {
      plan.put({ ...cur, filter: { ...cur.filter, merchantIds: Array.from(new Set(ids.map((id) => (fromIds.has(id) ? targetId : id)))) } });
    }
  }
  for (const m of from) plan.put({ ...m, deleted: true });
  return { merchants: from.length, transactions: moved };
}

/**
 * Merge merchants into one: their transactions, recurring rules and budget
 * filters move over, their bank names become aliases, and they are deleted.
 * The target is an existing merchant, or a name (an existing merchant with
 * that name, else the busiest of the merged ones renamed).
 */
export async function mergeMerchants(sourceIds: ID[], target: { id: ID } | { name: string }): Promise<MergeResult> {
  return mergeMerchantGroups([{ ids: sourceIds, target }]);
}

export async function mergeMerchantGroups(groups: { ids: ID[]; target: { id: ID } | { name: string } }[]): Promise<MergeResult> {
  const plan = new Plan();
  let merchants = 0;
  let transactions = 0;
  for (const g of groups) {
    const r = planMerge(plan, g.ids, g.target);
    merchants += r.merchants;
    transactions += r.transactions;
  }
  return { merchants, transactions, undo: await apply([...plan.docs.values()]) };
}

export interface MerchantGroup {
  /** Suggested name for the merged merchant. */
  name: string;
  merchants: Merchant[];
  transactions: number;
}

/**
 * Merchants that look like the same place ("Point of Sale … TIM HORTONS #53",
 * "TIM HORTONS #12", "Tim Hortons"), plus single merchants still named with raw
 * bank text. Busiest first.
 */
export function suggestMerchantCleanup(): MerchantGroup[] {
  const txCount = new Map<ID, number>();
  for (const t of repo.transactions()) if (t.merchantId) txCount.set(t.merchantId, (txCount.get(t.merchantId) ?? 0) + 1);
  const groups = new Map<string, Merchant[]>();
  for (const m of repo.merchants(true)) {
    const k = merchantGroupKey(m.name);
    if (k) groups.set(k, [...(groups.get(k) ?? []), m]);
  }
  const out: MerchantGroup[] = [];
  for (const ms of groups.values()) {
    ms.sort((a, b) => (txCount.get(b.id) ?? 0) - (txCount.get(a.id) ?? 0));
    const typed = ms.find((m) => !looksLikeBankText(m.name));
    const name = typed?.name ?? cleanDescriptor(ms[0].name);
    const rename = ms.length === 1 && merchantKey(ms[0].name) !== merchantKey(name);
    if (ms.length > 1 || rename) out.push({ name, merchants: ms, transactions: ms.reduce((n, m) => n + (txCount.get(m.id) ?? 0), 0) });
  }
  return out.sort((a, b) => b.merchants.length - a.merchants.length || b.transactions - a.transactions);
}
