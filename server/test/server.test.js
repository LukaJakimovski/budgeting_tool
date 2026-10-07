import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { Store } from '../src/store.js';
import { Backups } from '../src/backup.js';
import { createServer } from '../src/http.js';

const quiet = { info() {}, error() {} };
const TOKEN = 'a'.repeat(64);

async function setup(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-'));
  const config = loadConfig({ TALLY_DATA_DIR: dir, TALLY_STATIC_DIR: '', ...env });
  const store = new Store(config.dataDir).loadAll();
  const backups = new Backups(config, store, quiet);
  const server = createServer({ config, store, backups, log: quiet });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const call = async (method, p, body, token = TOKEN) => {
    const res = await fetch(base + p, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
  const close = () => new Promise((r) => { server.close(r); store.closeAll(); });
  return { dir, config, store, backups, call, close };
}

test('health reports signup mode', async () => {
  const s = await setup({ TALLY_SIGNUP_SECRET: 'x' });
  const r = await s.call('GET', '/health');
  assert.equal(r.body.signup, 'secret');
  await s.close();
});

test('create vault, auth, sync, LWW, pagination', async () => {
  const s = await setup();
  assert.equal((await s.call('POST', '/vaults', { vault: 'luka', token: TOKEN, encrypted: false })).status, 201);
  assert.equal((await s.call('POST', '/vaults', { vault: 'luka', token: TOKEN })).status, 409);
  assert.equal((await s.call('GET', '/vaults/luka', null, 'b'.repeat(64))).status, 401);
  assert.equal((await s.call('POST', '/vaults', { vault: 'Bad Name', token: TOKEN })).status, 400);

  // device A pushes two docs
  let r = await s.call('POST', '/vaults/luka/sync', { since: 0, push: [
    { id: 'tx_1', rev: '00001-0000-a', data: { id: 'tx_1', v: 1 } },
    { id: 'tx_2', rev: '00001-0001-a', data: { id: 'tx_2', v: 1 } },
  ] });
  assert.equal(r.body.accepted, 2);
  assert.equal(r.body.entries.length, 0, 'own pushes are not echoed');
  assert.equal(r.body.seq, 2);

  // device B pulls everything, then pushes an older rev (ignored) and a newer one
  r = await s.call('POST', '/vaults/luka/sync', { since: 0, push: [
    { id: 'tx_1', rev: '00000-0000-b', data: { id: 'tx_1', v: 'old' } },
    { id: 'tx_2', rev: '00002-0000-b', data: { id: 'tx_2', v: 2 } },
  ] });
  assert.equal(r.body.accepted, 1);
  assert.deepEqual(r.body.entries.map((e) => e.id), ['tx_1']);
  assert.equal(r.body.seq, 3);

  // device A catches up from its cursor
  r = await s.call('POST', '/vaults/luka/sync', { since: 2, push: [] });
  assert.deepEqual(r.body.entries.map((e) => [e.id, e.data.v]), [['tx_2', 2]]);

  // pagination
  const push = Array.from({ length: 25 }, (_, i) => ({ id: `d${i}`, rev: '00003-0000-a', data: { i } }));
  await s.call('POST', '/vaults/luka/sync', { since: 3, push });
  r = await s.call('POST', '/vaults/luka/sync', { since: 0, limit: 10 });
  assert.equal(r.body.entries.length, 10);
  assert.equal(r.body.more, true);
  const seen = new Set(r.body.entries.map((e) => e.id));
  let since = r.body.seq;
  while (r.body.more) {
    r = await s.call('POST', '/vaults/luka/sync', { since, limit: 10 });
    r.body.entries.forEach((e) => seen.add(e.id));
    since = r.body.seq;
  }
  assert.equal(seen.size, 27);
  await s.close();
});

test('log survives restart and compacts', async () => {
  const s = await setup();
  await s.call('POST', '/vaults', { vault: 'v', token: TOKEN });
  for (let i = 0; i < 5; i++) {
    await s.call('POST', '/vaults/v/sync', { since: 0, push: [{ id: 'x', rev: `0000${i}-0000-a`, data: { i } }] });
  }
  await s.close();
  const store = new Store(s.config.dataDir).loadAll();
  const v = store.get('v');
  assert.equal(v.entries.get('x').data.i, 4);
  assert.equal(v.seq, 5);
  v.compact();
  const lines = fs.readFileSync(v.logPath, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  store.closeAll();
});

test('signup secret and closed signup', async () => {
  const s = await setup({ TALLY_SIGNUP_SECRET: 'pi' });
  assert.equal((await s.call('POST', '/vaults', { vault: 'a', token: TOKEN })).status, 403);
  assert.equal((await s.call('POST', '/vaults', { vault: 'a', token: TOKEN, signupSecret: 'pi' })).status, 201);
  await s.close();
  const c = await setup({ TALLY_ALLOW_SIGNUP: 'false' });
  assert.equal((await c.call('POST', '/vaults', { vault: 'a', token: TOKEN })).status, 403);
  await c.close();
});

test('backups: snapshot, list, read, retention, plain export', async () => {
  const s = await setup({ TALLY_BACKUP_KEEP_DAILY: '2', TALLY_BACKUP_KEEP_WEEKLY: '1', TALLY_BACKUP_KEEP_MONTHLY: '1' });
  await s.call('POST', '/vaults', { vault: 'v', token: TOKEN });
  await s.call('POST', '/vaults/v/sync', { since: 0, push: [{ id: 'tx_1', rev: '1', data: { id: 'tx_1', type: 'transaction' } }] });
  const made = await s.call('POST', '/vaults/v/backups');
  assert.equal(made.status, 201);
  const list = await s.call('GET', '/vaults/v/backups');
  assert.equal(list.body.backups.length, 1);
  const snap = await s.call('GET', `/vaults/v/backups/${made.body.name}`);
  assert.equal(snap.body.entries[0].id, 'tx_1');

  // retention on fake daily files
  const dir = s.backups.dirFor('v');
  for (const d of ['2026-08-03', '2026-09-01', '2026-09-02', '2026-10-05', '2026-10-06', '2026-10-07']) {
    fs.writeFileSync(path.join(dir, `v-${d}.json.gz`), '');
  }
  s.backups.prune('v');
  const left = fs.readdirSync(dir).filter((f) => !f.includes('manual')).sort();
  // newest 2 daily + first of newest week (10-05) + first of newest month (10-05)
  assert.deepEqual(left, ['v-2026-10-05.json.gz', 'v-2026-10-06.json.gz', 'v-2026-10-07.json.gz']);

  const file = s.backups.writeExport('v');
  const out = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(out.documents[0].id, 'tx_1');
  await s.close();
});

test('rejects bad entries and rate-limits bad tokens', async () => {
  const s = await setup();
  await s.call('POST', '/vaults', { vault: 'v', token: TOKEN });
  const bad = await s.call('POST', '/vaults/v/sync', { push: [{ id: '', rev: '1', data: 1 }] });
  assert.equal(bad.status, 400);
  let last;
  for (let i = 0; i < 22; i++) last = await s.call('GET', '/vaults/v', null, 'wrong'.padEnd(64, 'x'));
  assert.equal(last.status, 429);
  await s.close();
});

test('static files: serves the app, SPA fallback, no path traversal', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-static-'));
  const site = path.join(dir, 'dist');
  fs.mkdirSync(path.join(site, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'dist-secret'));
  fs.writeFileSync(path.join(site, 'index.html'), '<!doctype html><title>Tally</title>');
  fs.writeFileSync(path.join(site, 'assets', 'app-abc.js'), 'console.log(1)');
  fs.writeFileSync(path.join(dir, 'dist-secret', 'key.txt'), 'secret');
  const config = loadConfig({ TALLY_DATA_DIR: dir, TALLY_STATIC_DIR: site });
  const store = new Store(config.dataDir).loadAll();
  const server = createServer({ config, store, backups: new Backups(config, store, quiet), log: quiet });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const get = (p) => fetch(origin + p).then(async (r) => ({ status: r.status, text: await r.text(), headers: r.headers }));
  try {
  const index = await get('/');
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-security-policy') ?? '', /default-src 'self'/);
  assert.equal((await get('/some/route')).text, index.text);
  const asset = await get('/assets/app-abc.js');
  assert.match(asset.headers.get('cache-control') ?? '', /immutable/);
  for (const evil of ['/../dist-secret/key.txt', '/%2e%2e/dist-secret/key.txt', '/assets/..%2f..%2fdist-secret%2fkey.txt']) {
    const r = await get(evil);
    assert.notEqual(r.text, 'secret', evil);
  }
  assert.equal((await get('/%E0%A4%A')).status, 400);
  } finally {
    await new Promise((r) => server.close(r));
    store.closeAll();
  }
});
