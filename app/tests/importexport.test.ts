import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { repo } from '../src/lib/db/repo.svelte';
import { LocalDB } from '../src/lib/db/idb';
import { parseCSV, guessMapping, buildRows, cleanDescriptor, commitImport, parseDate } from '../src/lib/importers';
import { exportCSV, exportJSON, CSV_COLUMNS } from '../src/lib/exporters';
import { parseBackup } from '../src/lib/backup';
import { saveTransaction } from '../src/lib/actions';
import { makeOccurredAt } from '../src/lib/core/dates';

(globalThis as any).__APP_VERSION__ = 'test';

beforeAll(async () => {
  await repo.init(await LocalDB.open('importexport'));
});

const csv = readFileSync(new URL('./fixtures/cibc-credit.csv', import.meta.url), 'utf8');

describe('csv parsing', () => {
  it('handles quotes, commas and CRLF', () => {
    expect(parseCSV('a,"b, c","d ""e"""\r\n1,2,3\r\n')).toEqual([
      ['a', 'b, c', 'd "e"'],
      ['1', '2', '3'],
    ]);
    expect(parseCSV('x;y\n1;2')).toEqual([['x', 'y'], ['1', '2']]);
  });
  it('reads dates in several orders', () => {
    expect(parseDate('2026-10-07', 'dmy')).toBe('2026-10-07');
    expect(parseDate('07/10/2026', 'dmy')).toBe('2026-10-07');
    expect(parseDate('10/07/26', 'mdy')).toBe('2026-10-07');
    expect(parseDate('31/02/2026', 'mdy')).toBeNull();
  });
  it('cleans bank descriptors', () => {
    expect(cleanDescriptor('TIM HORTONS #1234 TORONTO, ON')).toBe('Tim Hortons');
    expect(cleanDescriptor('SQ *FRESH BAKERY TORONTO ON')).toBe('Fresh Bakery Toronto');
  });
});

describe('CIBC import', () => {
  it('detects the format and flags payments, duplicates and manual entries', async () => {
    const rows = parseCSV(csv);
    const m = guessMapping(rows, 'CAD');
    expect(m.preset).toBe('cibc');
    expect(m.paymentMethodId).toBe('pm_credit');

    // A purchase already entered by hand two days later than the bank date
    const manual = await saveTransaction({
      kind: 'expense', occurredAt: makeOccurredAt('2026-10-03', '18:00'), amount: 675, currency: 'CAD', merchantId: null, name: 'Croissant',
      categoryId: 'cat_treats', paymentMethodId: null, channel: null, tagIds: [], description: '', purpose: '', splits: [],
    });

    const built = buildRows(rows, m);
    expect(built.map((r) => [r.kind, r.amount, r.action, r.reason])).toEqual([
      ['expense', 362, 'import', ''],
      ['expense', 8410, 'import', ''],
      ['expense', 8410, 'import', ''], // same day + amount twice is legit (two shops), kept
      ['refund', 50000, 'skip', 'payment'],
      ['refund', 2599, 'import', ''],
      ['expense', 675, 'skip', 'matches-existing'],
    ]);
    expect(built[5].matchId).toBe(manual.tx.id);
    expect(built[1].fingerprint).not.toBe(built[2].fingerprint);

    const names = new Map(built.filter((r) => r.action === 'import').map((r) => [r.index, cleanDescriptor(r.description)]));
    const n = await commitImport(built, m, names);
    expect(n).toEqual({ imported: 4, updated: 0 });
    const tims = repo.merchants().find((x) => x.name === 'Tim Hortons');
    expect(tims?.aliases).toEqual([]); // the name itself is what the bank text contains
    expect(repo.get<any>(manual.tx.id).importRef).toBe(built[5].fingerprint);

    // Importing the same file again finds nothing new
    const again = buildRows(rows, m);
    expect(again.filter((r) => r.action === 'import')).toHaveLength(0);
    // …and next time Tim Hortons is matched to the merchant automatically
    expect(again[0].merchantId).toBe(tims?.id);
  });
});

describe('exports', () => {
  it('writes a CSV row per line and a re-importable JSON', () => {
    const text = exportCSV();
    const rows = parseCSV(text);
    expect(rows[0]).toEqual([...CSV_COLUMNS]);
    expect(rows.length).toBe(repo.transactions().length + 1);
    const parsed = parseBackup(exportJSON());
    expect(parsed.counts.transaction).toBe(repo.transactions().length);
    expect(parsed.documents.every((d) => !d.deleted)).toBe(true);
  });
  it('rejects things that are not backups', () => {
    expect(() => parseBackup('{"hello":1}')).toThrow(/Not a Tally backup/);
    expect(() => parseBackup(JSON.stringify({ format: 'tally-export', version: 99, documents: [] }))).toThrow(/newer version/);
  });
});

describe('backups with receipts', () => {
  it('round-trips receipts through a zip backup', async () => {
    const { buildBackup, parseBackupFile, restore } = await import('../src/lib/backup');
    const bytes = new Uint8Array(30_000).map((_, i) => (i * 13) % 256);
    await repo.db.putBlob({ id: 'att_zip1', mime: 'image/jpeg', data: bytes }, true);
    await saveTransaction({
      kind: 'expense', occurredAt: makeOccurredAt('2026-10-06', '12:00'), amount: 1234, currency: 'CAD', merchantId: null, name: 'With receipt',
      categoryId: 'cat_groceries', paymentMethodId: null, channel: null, tagIds: [], description: '', purpose: '', splits: [],
      attachments: [{ id: 'att_zip1', name: 'r.jpg', mime: 'image/jpeg', size: bytes.length, addedAt: new Date().toISOString() }],
    });
    const b = await buildBackup();
    expect(b.name).toMatch(/\.zip$/);
    expect(b.missing).toBe(0);
    const parsed = await parseBackupFile(new Blob([b.data as BlobPart]));
    expect(parsed.files?.get('att_zip1')).toEqual(bytes);
    expect(parsed.counts.receipt).toBe(1);

    await repo.db.deleteBlob('att_zip1', false);
    expect(await repo.db.getBlob('att_zip1')).toBeUndefined();
    await restore(parsed, 'merge');
    expect((await repo.db.getBlob('att_zip1'))?.data).toEqual(bytes);
    // receipts show up in the CSV export too
    expect(exportCSV()).toContain('att_zip1');
  });

  it('filters by having a receipt', async () => {
    const { compileFilter, allocateAll } = await import('../src/lib/core/ledger');
    const allocs = allocateAll(repo.transactions(), repo.moneyContext());
    const withR = allocs.filter(compileFilter({ hasAttachment: true }, repo.lookup()));
    expect(withR.map((a) => a.tx.name)).toEqual(['With receipt']);
    expect(allocs.filter(compileFilter({ hasAttachment: false }, repo.lookup())).length).toBe(allocs.length - 1);
  });
});
