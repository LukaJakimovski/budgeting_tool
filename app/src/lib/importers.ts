/**
 * Bank statement import (CSV).
 *
 * Works with any CSV via column mapping; the CIBC preset matches the files
 * CIBC online banking exports (no header row):
 *   date (YYYY-MM-DD), description, debit, credit[, card number]
 * Bank text is cleaned into merchant names (core/banktext.ts); rows are
 * matched to merchants by name or alias, checked against previous imports
 * (fingerprint) and against purchases you already entered by hand (same
 * amount within ±3 days), so importing a statement never double-counts.
 */
import { repo } from './db/repo.svelte';
import { parseAmount } from './core/money';
import { daysBetween, makeOccurredAt, txDate } from './core/dates';
import { toBase, findOrCreateMerchant } from './actions';
import { cleanDescriptor, isRawBankLine, merchantKey, merchantGroupKey, parseBankText } from './core/banktext';
import type { ID, Merchant, Transaction, TxKind } from './core/types';

export { cleanDescriptor };

export function parseCSV(text: string, delimiter?: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const delim = delimiter ?? ([',', ';', '\t'].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0]);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

export type DateOrder = 'ymd' | 'dmy' | 'mdy';

export interface Mapping {
  hasHeader: boolean;
  date: number;
  dateOrder: DateOrder;
  description: number;
  /** Either a single signed amount column… */
  amount: number | null;
  /** …or separate debit/credit columns. */
  debit: number | null;
  credit: number | null;
  /** For a single amount column: are purchases negative? */
  negativeIsExpense: boolean;
  currency: string;
  paymentMethodId: ID | null;
}

export const CIBC_PRESET: Omit<Mapping, 'currency' | 'paymentMethodId'> = {
  hasHeader: false,
  date: 0,
  dateOrder: 'ymd',
  description: 1,
  amount: null,
  debit: 2,
  credit: 3,
  negativeIsExpense: true,
};

/** Guess a mapping from the file's shape. */
export function guessMapping(rows: string[][], currency: string): Mapping & { preset: 'cibc' | 'generic' } {
  const first = rows[0] ?? [];
  const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s.trim()) || /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(s.trim());
  const looksCIBC = /^\d{4}-\d{2}-\d{2}$/.test((first[0] ?? '').trim()) && first.length >= 4 && first.length <= 5;
  if (looksCIBC) return { ...CIBC_PRESET, currency, paymentMethodId: first.length === 5 ? 'pm_credit' : 'pm_debit', preset: 'cibc' };
  const header = first.map((h) => h.toLowerCase());
  const hasHeader = !first.some(isDate);
  const find = (...names: string[]) => {
    const i = header.findIndex((h) => names.some((n) => h.includes(n)));
    return i >= 0 ? i : null;
  };
  const sample = rows[hasHeader ? 1 : 0] ?? [];
  const dateCol = hasHeader ? (find('date') ?? 0) : Math.max(0, sample.findIndex(isDate));
  const debit = hasHeader ? find('debit', 'withdrawal', 'out') : null;
  const credit = hasHeader ? find('credit', 'deposit', 'in') : null;
  const amount = debit === null ? (hasHeader ? find('amount', 'value') : null) : null;
  const ds = (sample[dateCol] ?? '').trim();
  const dateOrder: DateOrder = /^\d{4}/.test(ds) ? 'ymd' : Number(ds.split(/[/.-]/)[0]) > 12 ? 'dmy' : 'mdy';
  return {
    hasHeader,
    date: dateCol,
    dateOrder,
    description: hasHeader ? (find('description', 'merchant', 'payee', 'details', 'name') ?? 1) : 1,
    amount: amount ?? (debit === null ? 2 : null),
    debit,
    credit,
    negativeIsExpense: true,
    currency,
    paymentMethodId: null,
    preset: 'generic',
  };
}

export function parseDate(s: string, order: DateOrder): string | null {
  const t = s.trim();
  let y: number, m: number, d: number;
  const iso = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else {
    const p = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (!p) return null;
    const [a, b, c] = [Number(p[1]), Number(p[2]), Number(p[3])];
    y = c < 100 ? 2000 + c : c;
    if (order === 'mdy') [m, d] = [a, b];
    else [d, m] = [a, b];
  }
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y > 1900)) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export interface ImportRow {
  index: number;
  date: string;
  description: string;
  amount: number;
  kind: TxKind;
  fingerprint: string;
  merchantId: ID | null;
  categoryId: ID | null;
  /** What we suggest doing with it. Importing a `duplicate` row updates the transaction it was imported as. */
  action: 'import' | 'skip';
  reason: '' | 'duplicate' | 'matches-existing' | 'payment' | 'invalid';
  /** The existing transaction: the one imported from this row (duplicate) or entered by hand (matches-existing). */
  matchId: ID | null;
}

/**
 * Finds the merchant a bank row belongs to. Names and aliases are looked for in
 * the merchant part of the text (channel, transaction type and reference number
 * removed), longest first; failing that, a merchant whose name cleans to the
 * same thing ("TIM HORTONS #53" → an existing "Tim Hortons").
 */
export function merchantMatcher(merchants: Merchant[]): (description: string) => Merchant | null {
  // Merchants named with a whole bank line (older imports made one per line)
  // aren't reused: the row gets a clean name and Settings → Merchants → Tidy up
  // folds the old ones in.
  const usable = merchants.filter((m) => !isRawBankLine(m.name));
  const names = usable.flatMap((m) => [...m.aliases, m.name.toLowerCase()].filter((a) => a.length >= 3).map((a) => [a, m] as const));
  names.sort((a, b) => b[0].length - a[0].length);
  const byKey = new Map<string, Merchant>();
  for (const m of usable) {
    const k = merchantGroupKey(m.name);
    const cur = byKey.get(k);
    if (k && (!cur || (cur.archived && !m.archived))) byKey.set(k, m);
  }
  return (description) => {
    const d = parseBankText(description).core.toLowerCase().replace(/\s+/g, ' ');
    for (const [alias, m] of names) if (d.includes(alias)) return m;
    return byKey.get(merchantKey(cleanDescriptor(description))) ?? null;
  };
}

export function matchMerchant(description: string, merchants: Merchant[]): Merchant | null {
  return merchantMatcher(merchants)(description);
}

function fingerprintOf(date: string, description: string, amount: number, occurrence: number): string {
  const s = `${date}|${description.trim().toUpperCase()}|${amount}|${occurrence}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return `bank:${(h >>> 0).toString(36)}:${s.length}`;
}

export function buildRows(rows: string[][], m: Mapping): ImportRow[] {
  const body = m.hasHeader ? rows.slice(1) : rows;
  const match = merchantMatcher(repo.merchants(true));
  const existing = repo.transactions();
  const byRef = new Map(existing.filter((t) => t.importRef).map((t) => [t.importRef!, t.id]));
  const usedMatches = new Set<ID>();
  const seen = new Map<string, number>();
  const out: ImportRow[] = [];
  for (let i = 0; i < body.length; i++) {
    const r = body[i];
    const date = parseDate(r[m.date] ?? '', m.dateOrder);
    const description = (r[m.description] ?? '').trim();
    let amount = 0;
    let kind: TxKind = 'expense';
    if (m.amount !== null) {
      const v = parseAmount(r[m.amount] ?? '', m.currency) ?? 0;
      const expense = m.negativeIsExpense ? v < 0 : v > 0;
      amount = Math.abs(v);
      kind = expense ? 'expense' : 'refund';
    } else {
      const debit = parseAmount(r[m.debit ?? -1] ?? '', m.currency) ?? 0;
      const credit = parseAmount(r[m.credit ?? -1] ?? '', m.currency) ?? 0;
      if (debit) {
        amount = Math.abs(debit);
        kind = 'expense';
      } else {
        amount = Math.abs(credit);
        kind = 'refund';
      }
    }
    const bank = parseBankText(description);
    // Money in on a chequing account: pay and deposits are income, not refunds.
    if (kind === 'refund' && /^(pay|payroll\s+deposit|deposit)$/i.test(bank.type)) kind = 'income';
    if (!date || !amount) {
      out.push({ index: i, date: date ?? '', description, amount, kind, fingerprint: '', merchantId: null, categoryId: null, action: 'skip', reason: 'invalid', matchId: null });
      continue;
    }
    const key = `${date}|${description}|${amount}`;
    const occ = (seen.get(key) ?? 0) + 1;
    seen.set(key, occ);
    const fingerprint = fingerprintOf(date, description, amount, occ);
    const merchant = match(description);
    const row: ImportRow = {
      index: i,
      date,
      description,
      amount,
      kind,
      fingerprint,
      merchantId: merchant?.id ?? null,
      categoryId: merchant?.defaults.categoryId ?? null,
      action: 'import',
      reason: '',
      matchId: null,
    };
    if (byRef.has(fingerprint)) {
      row.action = 'skip';
      row.reason = 'duplicate';
      row.matchId = byRef.get(fingerprint)!;
    } else if (kind === 'refund' && (/payment|thank you|paiement/i.test(description) || /transfer/i.test(bank.type || bank.core))) {
      // Card payments and transfers between your own accounts aren't income or refunds.
      row.action = 'skip';
      row.reason = 'payment';
    } else {
      const match = existing.find(
        (t) =>
          !usedMatches.has(t.id) &&
          !t.importRef &&
          t.kind === kind &&
          (t.currency === m.currency ? t.amount === amount : t.baseAmount === amount) &&
          Math.abs(daysBetween(txDate(t.occurredAt), date)) <= 3,
      );
      if (match) {
        usedMatches.add(match.id);
        row.action = 'skip';
        row.reason = 'matches-existing';
        row.matchId = match.id;
      }
    }
    out.push(row);
  }
  return out;
}

/**
 * Create transactions for rows marked "import"; link matched manual entries to
 * the bank row. Already-imported rows marked "import" update the transaction
 * they were imported as (merchant, category, type) instead of adding it again.
 */
export async function commitImport(rows: ImportRow[], m: Mapping, newMerchantNames: Map<number, string>): Promise<{ imported: number; updated: number }> {
  const docs: Transaction[] = [];
  const merchantCache = new Map<string, Merchant>();
  let updated = 0;
  for (const r of rows) {
    if (r.action !== 'import') {
      if (r.reason === 'matches-existing' && r.matchId) {
        const t = repo.get<Transaction>(r.matchId);
        if (t && !t.importRef) docs.push({ ...t, importRef: r.fingerprint, bankDescription: r.description });
      }
      continue;
    }
    let merchantId = r.merchantId;
    const newName = newMerchantNames.get(r.index);
    if (!merchantId && newName) {
      const key = newName.toLowerCase();
      let mer = merchantCache.get(key);
      if (!mer) {
        mer = await findOrCreateMerchant(newName);
        // Renamed from what the bank calls it ("Tims" for TIM HORTONS)? Remember the bank's name.
        const alias = cleanDescriptor(r.description).toLowerCase();
        if (alias.length >= 3 && merchantKey(alias) !== merchantKey(mer.name) && !mer.aliases.includes(alias)) {
          mer = await repo.update<Merchant>(mer.id, { aliases: [...mer.aliases, alias] });
        }
        merchantCache.set(key, mer);
      }
      merchantId = mer.id;
    }
    const merchant = merchantId ? repo.get<Merchant>(merchantId) : undefined;
    const previous = r.reason === 'duplicate' && r.matchId ? repo.get<Transaction>(r.matchId) : undefined;
    if (previous) {
      docs.push({
        ...previous,
        kind: r.kind,
        merchantId: merchantId ?? previous.merchantId,
        categoryId: previous.splits.length ? previous.categoryId : (r.categoryId ?? merchant?.defaults.categoryId ?? previous.categoryId),
        paymentMethodId: m.paymentMethodId ?? previous.paymentMethodId,
        bankDescription: r.description,
      });
      updated++;
      continue;
    }
    docs.push({
      id: repo.newId('transaction'),
      type: 'transaction',
      rev: '',
      createdAt: new Date().toISOString(),
      kind: r.kind,
      occurredAt: makeOccurredAt(r.date, '12:00'),
      amount: r.amount,
      currency: m.currency,
      ...toBase(r.amount, m.currency),
      merchantId,
      name: '',
      categoryId: r.categoryId ?? merchant?.defaults.categoryId ?? null,
      paymentMethodId: m.paymentMethodId ?? merchant?.defaults.paymentMethodId ?? null,
      channel: merchant?.defaults.channel ?? null,
      tagIds: [],
      description: '',
      purpose: '',
      splits: [],
      importRef: r.fingerprint,
      bankDescription: r.description,
    });
  }
  // Save in chunks so a big statement doesn't block the UI.
  for (let i = 0; i < docs.length; i += 300) await repo.save(docs.slice(i, i + 300));
  return { imported: rows.filter((r) => r.action === 'import').length - updated, updated };
}

