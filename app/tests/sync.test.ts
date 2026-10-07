// @vitest-environment node
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Repo } from '../src/lib/db/repo.svelte';
import { LocalDB } from '../src/lib/db/idb';
import { SyncEngine } from '../src/lib/sync/sync.svelte';
import { deriveVaultKeys, encryptJSON, decryptJSON } from '../src/lib/sync/crypto';
// @ts-expect-error plain JS server module
import { loadConfig } from '../../server/src/config.js';
// @ts-expect-error plain JS server module
import { Store } from '../../server/src/store.js';
// @ts-expect-error plain JS server module
import { Backups } from '../../server/src/backup.js';
// @ts-expect-error plain JS server module
import { createServer } from '../../server/src/http.js';

let server: any;
let store: any;
let url = '';
let n = 0;

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-sync-'));
  const config = loadConfig({ TALLY_DATA_DIR: dir, TALLY_STATIC_DIR: '' });
  store = new Store(config.dataDir).loadAll();
  const quiet = { info() {}, error() {} };
  server = createServer({ config, store, backups: new Backups(config, store, quiet), log: quiet });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  store.closeAll();
});

async function device() {
  const r = new Repo();
  await r.init(await LocalDB.open(`sync-${n++}`));
  return { r, s: new SyncEngine(r) };
}

describe('crypto', () => {
  it('derives the same keys with WebCrypto and pure JS', async () => {
    const a = await deriveVaultKeys('correct horse', 'luka', 1000);
    const subtle = globalThis.crypto.subtle;
    Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true });
    try {
      const b = await deriveVaultKeys('correct horse', 'luka', 1000);
      expect(b).toEqual(a);
    } finally {
      Object.defineProperty(globalThis.crypto, 'subtle', { value: subtle, configurable: true });
    }
    expect(a.key).not.toEqual(a.token);
  });
  it('round-trips and binds ciphertext to the id', async () => {
    const { key } = await deriveVaultKeys('pw', 'v', 1000);
    const c = encryptJSON(key, 'tx_1', { hello: 'world' });
    expect(decryptJSON(key, 'tx_1', c)).toEqual({ hello: 'world' });
    expect(() => decryptJSON(key, 'tx_2', c)).toThrow();
  });
});

for (const encrypted of [false, true]) {
  describe(`two devices syncing (${encrypted ? 'encrypted' : 'plain'})`, () => {
    it('converges, including offline edits and deletes', async () => {
      const vault = `v${n}${encrypted ? 'e' : 'p'}`;
      const A = await device();
      const B = await device();
      const tag = await A.r.create('tag', { name: 'work', color: '', archived: false });
      await A.s.connect({ serverUrl: url, vault, passphrase: 'pass phrase', create: true, encrypted });
      expect(A.r.pending).toBe(0);
      if (encrypted) {
        const raw = store.get(vault).entries.get(tag.id).data;
        expect(typeof raw).toBe('string');
        expect(raw).not.toContain('work');
      }

      // B had its own data before joining
      await B.r.create('tag', { name: 'gift', color: '', archived: false });
      await B.s.connect({ serverUrl: url, vault, passphrase: 'pass phrase', create: false, encrypted: false });
      expect(B.s.config?.encrypted).toBe(encrypted);
      expect(B.r.tags().map((t) => t.name)).toEqual(['gift', 'work']);

      await A.s.syncNow();
      expect(A.r.tags().map((t) => t.name)).toEqual(['gift', 'work']);

      // concurrent offline edits: the later one wins everywhere
      await A.r.update(tag.id, { name: 'job' });
      await new Promise((r) => setTimeout(r, 5));
      await B.r.update(tag.id, { name: 'office' });
      await A.s.syncNow();
      await B.s.syncNow();
      await A.s.syncNow();
      expect(A.r.get<any>(tag.id).name).toBe('office');
      expect(B.r.get<any>(tag.id).name).toBe('office');

      await A.r.remove(tag.id);
      await A.s.syncNow();
      await B.s.syncNow();
      expect(B.r.get(tag.id)).toBeUndefined();
      expect(B.s.state).toBe('synced');
    });
  });
}

it('rejects a wrong passphrase', async () => {
  const A = await device();
  await A.s.connect({ serverUrl: url, vault: 'locked', passphrase: 'right', create: true, encrypted: true });
  const B = await device();
  await expect(B.s.connect({ serverUrl: url, vault: 'locked', passphrase: 'wrong', create: false, encrypted: true })).rejects.toThrow(/wrong passphrase/);
});

it('keeps working offline and reports pending changes', async () => {
  const A = await device();
  await A.s.connect({ serverUrl: url, vault: 'offline', passphrase: 'x', create: true, encrypted: false });
  A.s.config = { ...A.s.config!, serverUrl: 'http://127.0.0.1:9' };
  await A.r.create('tag', { name: 'later', color: '', archived: false });
  await expect(A.s.syncNow()).rejects.toThrow();
  expect(A.r.pending).toBe(1);
  expect(A.s.state).toBe('error');
  A.s.config = { ...A.s.config!, serverUrl: url };
  await A.s.syncNow();
  expect(A.r.pending).toBe(0);
});

for (const encrypted of [false, true]) {
  it(`syncs receipt files between devices (${encrypted ? 'encrypted' : 'plain'})`, async () => {
    const vault = `blobs${encrypted ? 'e' : 'p'}`;
    const A = await device();
    const B = await device();
    await A.s.connect({ serverUrl: url, vault, passphrase: 'pw for blobs', create: true, encrypted });
    await B.s.connect({ serverUrl: url, vault, passphrase: 'pw for blobs', create: false, encrypted: false });

    const bytes = new Uint8Array(50_000).map((_, i) => (i * 7) % 256);
    await A.r.db.putBlob({ id: 'att_test1', mime: 'image/jpeg', data: bytes }, true);
    await A.s.refreshBlobPending();
    expect(A.s.pendingBlobs).toBe(1);
    expect(A.s.state).toBe('pending');
    await A.s.syncNow();
    expect(A.s.pendingBlobs).toBe(0);

    const onServer = store.get(vault).blobFile('att_test1');
    const raw = new Uint8Array(fs.readFileSync(onServer));
    if (encrypted) expect(raw).not.toEqual(bytes);
    else expect(raw).toEqual(bytes);

    expect(await B.s.downloadBlob('att_test1')).toEqual(bytes);
    expect(await B.s.listServerBlobs()).toEqual(['att_test1']);
    expect(await B.s.downloadBlob('att_nope')).toBeNull();

    await A.r.db.deleteBlob('att_test1', true);
    await A.s.syncNow();
    expect(store.get(vault).blobFile('att_test1')).toBeNull();
  });
}
