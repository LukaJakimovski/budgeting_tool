import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { repo } from '../src/lib/db/repo.svelte';
import { LocalDB } from '../src/lib/db/idb';
import { cleanDescriptor, isUsefulAlias, looksLikeBankText, merchantGroupKey, parseBankText } from '../src/lib/core/banktext';
import { buildRows, commitImport, guessMapping, matchMerchant, parseCSV } from '../src/lib/importers';
import {
  addTag,
  deleteTransactions,
  mergeMerchantGroups,
  mergeMerchants,
  removeTag,
  setCategory,
  setMerchant,
  suggestMerchantCleanup,
} from '../src/lib/bulk';
import { saveTransaction } from '../src/lib/actions';
import { makeOccurredAt } from '../src/lib/core/dates';
import type { Budget, Merchant, Recurring, Transaction } from '../src/lib/core/types';

beforeAll(async () => {
  await repo.init(await LocalDB.open('bulk'));
});

describe('bank text', () => {
  it('finds the merchant inside CIBC chequing text', () => {
    expect(cleanDescriptor('Point of Sale - Interac RETAIL PURCHASE 531214272782 TIM HORTONS #53')).toBe('Tim Hortons');
    expect(cleanDescriptor('24lmvmsy0000 Lindt Canada')).toBe('Lindt Canada');
    expect(cleanDescriptor('Point of Sale - Visa Debit VISA DEBIT PURCHASE 24lmvmsy0000 Lindt Canada')).toBe('Lindt Canada');
    expect(cleanDescriptor('Point of Sale - Visa Debit INTL VISA DEB PURCHASE 1234 SPOTIFY P1234ABC')).toBe('Spotify');
    expect(cleanDescriptor('Internet Banking INTERNET BILL PAY 000000123456 HYDRO ONE')).toBe('Hydro One');
    expect(cleanDescriptor('Internet Banking E-TRANSFER 105012345678 John Smith')).toBe('John Smith');
    expect(cleanDescriptor('Electronic Funds Transfer PREAUTHORIZED DEBIT ROGERS')).toBe('Rogers');
    // Nothing but a reference left: fall back to the transaction type
    expect(cleanDescriptor('Internet Banking INTERNET TRANSFER 000000123456')).toBe('Internet Transfer');
    expect(parseBankText('Point of Sale - Interac RETAIL PURCHASE 531214272782 TIM HORTONS #53')).toEqual({ type: 'RETAIL PURCHASE', core: 'TIM HORTONS #53' });
  });
  it('keeps credit card cleaning and casing sensible', () => {
    expect(cleanDescriptor('TIM HORTONS #1234 TORONTO, ON')).toBe('Tim Hortons');
    expect(cleanDescriptor('PETRO-CANADA 12345 TORONTO ON')).toBe('Petro-Canada');
    expect(cleanDescriptor('UBER* EATS')).toBe('Uber Eats');
    expect(cleanDescriptor('1PASSWORD')).toBe('1Password');
    expect(cleanDescriptor('A&W #1234')).toBe('A&W');
  });
  it('groups names of the same place', () => {
    const k = merchantGroupKey('Tim Hortons');
    expect(merchantGroupKey('Point of Sale - Interac RETAIL PURCHASE 531214272782 TIM HORTONS #53')).toBe(k);
    expect(merchantGroupKey('TIM HORTONS #1207')).toBe(k);
    expect(looksLikeBankText('Tim Hortons')).toBe(false);
    expect(looksLikeBankText('Joe’s Pizza Place Downtown')).toBe(false);
    expect(merchantGroupKey('Joe’s Pizza Place Downtown')).not.toBe(merchantGroupKey('Joe’s Pizza Place'));
    expect(isUsefulAlias('tim hortons #')).toBe(true);
    expect(isUsefulAlias('point of sale - interac retail purchase')).toBe(false);
    expect(isUsefulAlias('531214272782')).toBe(false);
  });
});

const tx = (p: Partial<Transaction>) =>
  saveTransaction({
    kind: 'expense', occurredAt: makeOccurredAt('2026-09-10', '12:00'), amount: 500, currency: 'CAD', merchantId: null, name: '',
    categoryId: 'cat_groceries', paymentMethodId: null, channel: null, tagIds: [], description: '', purpose: '', splits: [],
    ...p,
  }).then((r) => r.tx);

describe('importing CIBC chequing', () => {
  const rows = parseCSV(readFileSync(new URL('./fixtures/cibc-chequing.csv', import.meta.url), 'utf8'));

  it('makes one merchant per place, and re-importing can overwrite what an older import made', async () => {
    // What an older version did: one merchant per bank line, named with the raw text.
    const raw = 'Point of Sale - Interac RETAIL PURCHASE 531214272782 TIM HORTONS #53';
    const old = await repo.create('merchant', {
      name: raw, aliases: ['point of sale - interac retail purchase'], learnDefaults: true, archived: false,
      defaults: { categoryId: 'cat_coffee', paymentMethodId: null, channel: null, tagIds: [], name: '', currency: null },
    });
    // …which must not swallow every other point-of-sale row
    expect(matchMerchant('Point of Sale - Interac RETAIL PURCHASE 000001234567 LOBLAWS #1234', [old])).toBeNull();

    const m = guessMapping(rows, 'CAD');
    expect(m.preset).toBe('cibc');
    const built = buildRows(rows, m);
    expect(built.every((r) => r.merchantId === null)).toBe(true); // raw-named merchants aren't reused
    const names = new Map(built.map((r) => [r.index, cleanDescriptor(r.description)]));
    expect([...new Set(names.values())]).toEqual(['Tim Hortons', 'Lindt Canada', 'Hydro One', 'Acme Corp']);
    expect(built.map((r) => r.kind)).toEqual(['expense', 'expense', 'expense', 'expense', 'expense', 'expense', 'income']);
    expect(await commitImport(built, m, names)).toEqual({ imported: 7, updated: 0 });
    const tims = repo.merchants().filter((x) => x.name === 'Tim Hortons');
    expect(tims).toHaveLength(1);
    expect(repo.transactions().filter((t) => t.merchantId === tims[0].id)).toHaveLength(3);

    // Same file again: all rows are duplicates; ticking one updates instead of duplicating.
    const again = buildRows(rows, m);
    expect(again.every((r) => r.action === 'skip' && r.reason === 'duplicate' && r.matchId)).toBe(true);
    const target = repo.get<Transaction>(again[3].matchId!)!;
    expect(again[3].merchantId).toBe(target.merchantId); // the clean merchant is matched now
    again[3].action = 'import';
    again[3].categoryId = 'cat_treats';
    const before = repo.transactions().length;
    expect(await commitImport(again, m, new Map())).toEqual({ imported: 0, updated: 1 });
    expect(repo.transactions()).toHaveLength(before);
    expect(repo.get<Transaction>(target.id)?.categoryId).toBe('cat_treats');

    // The leftover raw merchant is offered for tidying together with the new one.
    const group = suggestMerchantCleanup().find((g) => g.name === 'Tim Hortons');
    expect(group?.merchants.map((x) => x.id).sort()).toEqual([old.id, tims[0].id].sort());
  });
});

describe('bulk edits', () => {
  it('deletes, recategorises and tags many at once, with undo', async () => {
    const a = await tx({ amount: 100 });
    const b = await tx({ amount: 200, splits: [{ amount: 150, categoryId: 'cat_groceries', tagIds: ['tag_x'], note: '' }, { amount: 50, categoryId: 'cat_treats', tagIds: [], note: '' }] });
    const c = await tx({ amount: 300 });

    const cat = await setCategory([a.id, b.id], 'cat_household');
    expect(cat.count).toBe(1);
    expect(cat.skipped).toBe(1); // the split purchase keeps its split categories
    expect(repo.get<Transaction>(a.id)?.categoryId).toBe('cat_household');
    await cat.undo();
    expect(repo.get<Transaction>(a.id)?.categoryId).toBe('cat_groceries');

    const tagged = await addTag([a.id, b.id, c.id], '#bulk-test');
    expect(tagged.count).toBe(3);
    const tag = repo.tags().find((t) => t.name === 'bulk-test')!;
    expect(repo.get<Transaction>(c.id)?.tagIds).toEqual([tag.id]);
    await tagged.undo();
    expect(repo.get<Transaction>(c.id)?.tagIds).toEqual([]);
    expect(repo.tags().some((t) => t.name === 'bulk-test')).toBe(false); // the tag it created is gone too

    expect((await removeTag([b.id], 'tag_x')).count).toBe(1);
    expect(repo.get<Transaction>(b.id)?.splits[0].tagIds).toEqual([]);

    const del = await deleteTransactions([a.id, c.id]);
    expect(del.count).toBe(2);
    expect(repo.get(a.id)).toBeUndefined();
    await del.undo();
    expect(repo.get(a.id)).toBeDefined();
    expect(repo.get(c.id)).toBeDefined();
  });

  it('moves transactions to a new merchant named on the spot', async () => {
    const a = await tx({ categoryId: 'cat_coffee' });
    const b = await tx({ categoryId: 'cat_coffee' });
    const r = await setMerchant([a.id, b.id], { name: 'Second Cup' });
    const sc = repo.merchants().find((m) => m.name === 'Second Cup')!;
    expect(sc.defaults.categoryId).toBe('cat_coffee');
    expect(repo.get<Transaction>(a.id)?.merchantId).toBe(sc.id);
    await r.undo();
    expect(repo.get<Transaction>(a.id)?.merchantId).toBeNull();
    expect(repo.merchants().some((m) => m.name === 'Second Cup')).toBe(false);
  });
});

describe('merging merchants', () => {
  it('moves transactions, recurring rules and budgets, keeps bank names, and undoes', async () => {
    const mk = (name: string, aliases: string[] = []) =>
      repo.create('merchant', { name, aliases, learnDefaults: true, archived: false, defaults: { categoryId: null, paymentMethodId: null, channel: null, tagIds: [], name: '', currency: null } });
    const m1 = await mk('Point of Sale - Visa Debit VISA DEBIT PURCHASE 24lmvmsy0000 Purdys Chocolatier', ['point of sale - visa debit visa debit purchase']);
    const m2 = await mk('Point of Sale - Visa Debit VISA DEBIT PURCHASE 24lpqrst0000 PURDYS CHOCOLATIER');
    const m3 = await mk('Purdys', ['purdys #']);
    const t1 = await tx({ merchantId: m1.id });
    const t2 = await tx({ merchantId: m2.id });
    const rule = await repo.create('recurring', {
      name: 'Chocolate', freq: 'month', interval: 1, startDate: '2026-01-01', endDate: null, mode: 'confirm', active: false,
      template: { kind: 'expense', amount: 500, currency: 'CAD', merchantId: m2.id, name: '', categoryId: null, paymentMethodId: null, channel: null, tagIds: [], description: '', purpose: '', time: '12:00' },
    });
    const budget = await repo.create('budget', {
      name: 'Lindt', icon: '', amount: 1000, period: { unit: 'month', count: 1, anchor: '2026-01-01' }, filter: { merchantIds: [m1.id, m3.id] }, warnAt: 0.8, order: 0, archived: false,
    });

    const r = await mergeMerchants([m1.id, m2.id], { id: m3.id });
    expect(r).toMatchObject({ merchants: 2, transactions: 2 });
    expect(repo.get(m1.id)).toBeUndefined();
    expect(repo.get<Transaction>(t1.id)?.merchantId).toBe(m3.id);
    expect(repo.get<Transaction>(t2.id)?.merchantId).toBe(m3.id);
    expect(repo.get<Recurring>(rule.id)?.template.merchantId).toBe(m3.id);
    expect(repo.get<Budget>(budget.id)?.filter.merchantIds).toEqual([m3.id]);
    // Junk aliases from the old import are dropped; the bank's name for the place is kept
    expect(repo.get<Merchant>(m3.id)?.aliases.sort()).toEqual(['purdys #', 'purdys chocolatier']);
    expect(matchMerchant('Point of Sale - Visa Debit VISA DEBIT PURCHASE 99zzzzzz0000 Purdys Chocolatier', repo.merchants())?.id).toBe(m3.id);

    await r.undo();
    expect(repo.get(m1.id)).toBeDefined();
    expect(repo.get<Transaction>(t1.id)?.merchantId).toBe(m1.id);
    expect(repo.get<Budget>(budget.id)?.filter.merchantIds).toEqual([m1.id, m3.id]);
  });

  it('tidies groups by name, renaming raw bank names', async () => {
    const mk = (name: string) =>
      repo.create('merchant', { name, aliases: [], learnDefaults: true, archived: false, defaults: { categoryId: null, paymentMethodId: null, channel: null, tagIds: [], name: '', currency: null } });
    const a = await mk('Point of Sale - Interac RETAIL PURCHASE 111111111111 SHOPPERS DRUG MART #0921');
    const b = await mk('Point of Sale - Interac RETAIL PURCHASE 222222222222 SHOPPERS DRUG MART #0921');
    await tx({ merchantId: a.id });
    await tx({ merchantId: b.id });
    const lone = await mk('Point of Sale - Interac RETAIL PURCHASE 333333333333 DOLLARAMA #1234');
    const groups = suggestMerchantCleanup();
    const shoppers = groups.find((g) => g.merchants.some((m) => m.id === a.id))!;
    expect(shoppers.name).toBe('Shoppers Drug Mart');
    expect(shoppers.merchants).toHaveLength(2);
    expect(groups.find((g) => g.merchants[0].id === lone.id)?.name).toBe('Dollarama');

    const r = await mergeMerchantGroups(groups.map((g) => ({ ids: g.merchants.map((m) => m.id), target: { name: g.name } })));
    expect(repo.merchants().filter((m) => m.name === 'Shoppers Drug Mart')).toHaveLength(1);
    expect(repo.get<Merchant>(lone.id)?.name).toBe('Dollarama');
    expect(suggestMerchantCleanup()).toEqual([]);
    await r.undo();
    expect(repo.get<Merchant>(lone.id)?.name).toMatch(/^Point of Sale/);
  });
});
