import { describe, expect, it } from 'vitest';
import { Repo } from '../src/lib/db/repo.svelte';
import { LocalDB } from '../src/lib/db/idb';
import { SEED_REV } from '../src/lib/core/hlc';

let n = 0;
async function fresh() {
  const db = await LocalDB.open(`test-${n++}`);
  const r = new Repo();
  await r.init(db);
  return { r, db };
}

describe('repo', () => {
  it('seeds categories with the seed revision and does not queue them', async () => {
    const { r } = await fresh();
    expect(r.categories().length).toBeGreaterThan(10);
    expect(r.get('cat_food')?.rev).toBe(SEED_REV);
    expect(r.pending).toBe(0);
  });

  it('persists, queues and reloads', async () => {
    const { r, db } = await fresh();
    const m = await r.create('merchant', {
      name: 'Tim Hortons', aliases: [], learnDefaults: true, archived: false,
      defaults: { categoryId: 'cat_coffee', paymentMethodId: null, channel: null, tagIds: [], name: '', currency: null },
    });
    expect(r.pending).toBe(1);
    await r.update(m.id, { name: 'Tims' });
    expect(r.pending).toBe(1);
    const r2 = new Repo();
    await r2.init(db);
    expect(r2.get<any>(m.id).name).toBe('Tims');
    expect(r2.deviceId).toBe(r.deviceId);
  });

  it('merges remote docs last-writer-wins', async () => {
    const { r } = await fresh();
    const t = await r.create('tag', { name: 'work', color: '', archived: false });
    const older = { ...t, name: 'old', rev: '000000001-0000-zz' };
    expect(await r.merge([older])).toHaveLength(0);
    const newerDoc = { ...t, name: 'remote', rev: 'zzzzzzzzz-0000-zz' };
    expect(await r.merge([newerDoc])).toHaveLength(1);
    expect(r.get<any>(t.id).name).toBe('remote');
    // a later local edit still wins over the remote revision
    await r.update(t.id, { name: 'local' });
    expect(r.get<any>(t.id).rev > newerDoc.rev).toBe(true);
  });

  it('remote edits beat seeds; deletes tombstone', async () => {
    const { r } = await fresh();
    await r.merge([{ ...r.get<any>('cat_food'), name: 'Food & drink', rev: '0mfx00000-0000-aa' }]);
    expect(r.get<any>('cat_food').name).toBe('Food & drink');
    await r.remove('cat_food');
    expect(r.get('cat_food')).toBeUndefined();
    expect(r.raw('cat_food')?.deleted).toBe(true);
  });

  it('restoring a backup wins and deletes extras', async () => {
    const { r } = await fresh();
    const a = await r.create('tag', { name: 'a', color: '', archived: false });
    const snapshot = r.allDocs();
    await r.create('tag', { name: 'b', color: '', archived: false });
    await r.update(a.id, { name: 'renamed' });
    await r.replaceAll(snapshot);
    expect(r.tags().map((t) => t.name)).toEqual(['a']);
  });

  it('settings fall back to defaults and merge objects', async () => {
    const { r } = await fresh();
    expect(r.setting('baseCurrency')).toBe('CAD');
    await r.setSetting('weekStart', 0);
    expect(r.calendar().weekStart).toBe(0);
  });
});
