/**
 * Exports in open formats (spec: docs/data-format.md).
 *   JSON   – every document, exactly as stored. Lossless; can be re-imported.
 *   CSV    – one row per transaction line (splits expanded), for spreadsheets.
 *   SQLite – normalised tables + a flat `transaction_lines` view.
 */
import { repo } from './db/repo.svelte';
import { SCHEMA_VERSION, type Category, type Doc, type Merchant, type PaymentMethod, type Tag, type Transaction } from './core/types';
import { allocate, categoryPath } from './core/ledger';
import { toDecimalString } from './core/money';
import { txDate, txTime } from './core/dates';

export interface ExportFile {
  format: 'tally-export';
  version: number;
  exportedAt: string;
  app: string;
  documents: Doc[];
}

export function exportJSON(): string {
  const out: ExportFile = {
    format: 'tally-export',
    version: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    app: `tally ${__APP_VERSION__}`,
    documents: repo.allDocs(false),
  };
  return JSON.stringify(out, null, 1);
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_COLUMNS = [
  'transaction_id', 'line', 'date', 'time', 'kind', 'name', 'merchant', 'amount', 'currency', 'amount_base', 'base_currency',
  'category', 'category_path', 'tags', 'payment_method', 'channel', 'description', 'purpose', 'split_note', 'bank_description',
  'receipts',
] as const;

export function transactionLines(): Record<(typeof CSV_COLUMNS)[number], string>[] {
  const lookup = repo.lookup();
  const ctx = repo.moneyContext();
  const rows: Record<(typeof CSV_COLUMNS)[number], string>[] = [];
  const txs = [...repo.transactions()].reverse();
  for (const tx of txs) {
    const allocs = allocate(tx, ctx);
    allocs.forEach((a, i) => {
      const split = a.split >= 0 ? tx.splits[a.split] : null;
      rows.push({
        transaction_id: tx.id,
        line: String(i + 1),
        date: txDate(tx.occurredAt),
        time: txTime(tx.occurredAt),
        kind: tx.kind,
        name: tx.name,
        merchant: tx.merchantId ? (lookup.merchants.get(tx.merchantId)?.name ?? '') : '',
        amount: toDecimalString(split ? split.amount : tx.amount, tx.currency),
        currency: tx.currency,
        amount_base: toDecimalString(a.amount, ctx.baseCurrency),
        base_currency: ctx.baseCurrency,
        category: a.categoryId ? (lookup.categories.get(a.categoryId)?.name ?? '') : '',
        category_path: categoryPath(a.categoryId, lookup.categories),
        tags: a.tagIds.map((t) => lookup.tags.get(t)?.name ?? '').filter(Boolean).join(';'),
        payment_method: tx.paymentMethodId ? (repo.get<PaymentMethod>(tx.paymentMethodId)?.name ?? '') : '',
        channel: tx.channel ?? '',
        description: tx.description,
        purpose: tx.purpose,
        split_note: split?.note ?? '',
        bank_description: tx.bankDescription ?? '',
        receipts: (tx.attachments ?? []).map((a) => a.id).join(';'),
      });
    });
  }
  return rows;
}

export function exportCSV(): string {
  const rows = transactionLines();
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of rows) lines.push(CSV_COLUMNS.map((c) => csvCell(r[c])).join(','));
  return lines.join('\r\n') + '\r\n';
}

export async function exportSQLite(): Promise<Uint8Array> {
  const [{ default: initSqlJs }, { default: wasmUrl }] = await Promise.all([import('sql.js'), import('sql.js/dist/sql-wasm.wasm?url')]);
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const db = new SQL.Database();
  db.run(`
    PRAGMA user_version = ${SCHEMA_VERSION};
    CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT, parent_id TEXT, icon TEXT, kind TEXT, path TEXT, archived INTEGER);
    CREATE TABLE merchants (id TEXT PRIMARY KEY, name TEXT, aliases TEXT, default_category_id TEXT, archived INTEGER);
    CREATE TABLE tags (id TEXT PRIMARY KEY, name TEXT, archived INTEGER);
    CREATE TABLE payment_methods (id TEXT PRIMARY KEY, name TEXT, archived INTEGER);
    CREATE TABLE transactions (
      id TEXT PRIMARY KEY, kind TEXT, occurred_at TEXT, date TEXT, time TEXT,
      amount_minor INTEGER, currency TEXT, base_amount_minor INTEGER, base_currency TEXT,
      merchant_id TEXT, name TEXT, category_id TEXT, payment_method_id TEXT, channel TEXT,
      description TEXT, purpose TEXT, recurring_id TEXT, bank_description TEXT, created_at TEXT
    );
    CREATE TABLE transaction_tags (transaction_id TEXT, tag_id TEXT);
    CREATE TABLE splits (transaction_id TEXT, line INTEGER, amount_minor INTEGER, category_id TEXT, note TEXT, tag_ids TEXT);
    CREATE TABLE attachments (id TEXT PRIMARY KEY, transaction_id TEXT, name TEXT, mime TEXT, size INTEGER, width INTEGER, height INTEGER, added_at TEXT);
    CREATE TABLE budgets (id TEXT PRIMARY KEY, name TEXT, amount_minor INTEGER, period_unit TEXT, period_count INTEGER, period_anchor TEXT, filter_json TEXT, warn_at REAL);
    CREATE TABLE documents (id TEXT PRIMARY KEY, type TEXT, json TEXT);
    CREATE TABLE transaction_lines (${CSV_COLUMNS.map((c) => `${c} TEXT`).join(', ')});
  `);
  const lookup = repo.lookup();
  const ins = (sql: string, rows: unknown[][]) => {
    const st = db.prepare(sql);
    for (const r of rows) st.run(r as (string | number | null)[]);
    st.free();
  };
  db.run('BEGIN');
  ins('INSERT INTO categories VALUES (?,?,?,?,?,?,?)', repo.categories(true).map((c: Category) => [c.id, c.name, c.parentId, c.icon, c.kind, categoryPath(c.id, lookup.categories), c.archived ? 1 : 0]));
  ins('INSERT INTO merchants VALUES (?,?,?,?,?)', repo.merchants(true).map((m: Merchant) => [m.id, m.name, m.aliases.join(';'), m.defaults.categoryId, m.archived ? 1 : 0]));
  ins('INSERT INTO tags VALUES (?,?,?)', repo.tags(true).map((t: Tag) => [t.id, t.name, t.archived ? 1 : 0]));
  ins('INSERT INTO payment_methods VALUES (?,?,?)', repo.paymentMethods(true).map((p: PaymentMethod) => [p.id, p.name, p.archived ? 1 : 0]));
  const txs = repo.transactions();
  ins(
    'INSERT INTO transactions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    txs.map((t: Transaction) => [t.id, t.kind, t.occurredAt, txDate(t.occurredAt), txTime(t.occurredAt), t.amount, t.currency, t.baseAmount, t.baseCurrency, t.merchantId, t.name, t.categoryId, t.paymentMethodId, t.channel, t.description, t.purpose, t.recurringId ?? null, t.bankDescription ?? null, t.createdAt]),
  );
  ins('INSERT INTO transaction_tags VALUES (?,?)', txs.flatMap((t) => t.tagIds.map((g) => [t.id, g])));
  ins('INSERT INTO attachments VALUES (?,?,?,?,?,?,?,?)', txs.flatMap((t) => (t.attachments ?? []).map((a) => [a.id, t.id, a.name, a.mime, a.size, a.width ?? null, a.height ?? null, a.addedAt])));
  ins('INSERT INTO splits VALUES (?,?,?,?,?,?)', txs.flatMap((t) => t.splits.map((s, i) => [t.id, i + 1, s.amount, s.categoryId, s.note, s.tagIds.join(';')])));
  ins('INSERT INTO budgets VALUES (?,?,?,?,?,?,?,?)', repo.list('budget').map((b) => [b.id, b.name, b.amount, b.period.unit, b.period.count, b.period.anchor, JSON.stringify(b.filter), b.warnAt]));
  ins('INSERT INTO documents VALUES (?,?,?)', repo.allDocs(false).map((d) => [d.id, d.type, JSON.stringify(d)]));
  ins(`INSERT INTO transaction_lines VALUES (${CSV_COLUMNS.map(() => '?').join(',')})`, transactionLines().map((r) => CSV_COLUMNS.map((c) => r[c])));
  db.run('COMMIT');
  const bytes = db.export();
  db.close();
  return bytes;
}

export function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}
