/**
 * Vault storage.
 *
 * A vault is one person's (or household's) data set. On disk:
 *
 *   <dataDir>/vaults/<name>/vault.json   metadata (auth hash, encrypted flag…)
 *   <dataDir>/vaults/<name>/log.jsonl    append-only change log, one entry per line:
 *                                        {"seq":12,"id":"tx_…","rev":"…","data":{…},"at":"…"}
 *
 * `data` is the document itself (unencrypted vaults) or an opaque string
 * (end-to-end encrypted vaults — the server never sees the contents).
 * The server keeps the latest entry per id in memory, accepts a pushed entry
 * only if its revision is newer (last writer wins), and periodically compacts
 * the log down to one line per id.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const VAULT_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const BLOB_ID = /^[A-Za-z0-9_-]{1,100}$/;
const MAX_ID = 200;
const MAX_REV = 120;
const MAX_ENTRY_BYTES = 512 * 1024;

export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function safeEqual(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export class Vault {
  constructor(dir, meta) {
    this.dir = dir;
    this.meta = meta;
    /** @type {Map<string, {seq:number,id:string,rev:string,data:unknown,at:string}>} */
    this.entries = new Map();
    this.seq = 0;
    this.lines = 0;
    this.fd = null;
    this.changedAt = 0;
  }

  get name() {
    return this.meta.name;
  }

  get logPath() {
    return path.join(this.dir, 'log.jsonl');
  }

  load() {
    if (fs.existsSync(this.logPath)) {
      const text = fs.readFileSync(this.logPath, 'utf8');
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        let e;
        try {
          e = JSON.parse(line);
        } catch {
          continue; // a torn final line after a crash — ignore it
        }
        this.lines++;
        if (e.seq > this.seq) this.seq = e.seq;
        const cur = this.entries.get(e.id);
        if (!cur || e.rev > cur.rev) this.entries.set(e.id, e);
      }
    }
    this.fd = fs.openSync(this.logPath, 'a');
    if (this.lines > this.entries.size * 2 + 100) this.compact();
    return this;
  }

  checkToken(token) {
    return typeof token === 'string' && token.length > 0 && safeEqual(hashToken(token), this.meta.authHash);
  }

  /**
   * Store pushed entries (keeping only those newer than what we have) and
   * return everything after `since`.
   */
  sync({ since = 0, push = [], limit = 1000 }) {
    const accepted = [];
    const at = new Date().toISOString();
    for (const p of push) {
      const err = validateEntry(p);
      if (err) throw Object.assign(new Error(err), { status: 400 });
      const cur = this.entries.get(p.id);
      if (cur && !(p.rev > cur.rev)) continue;
      const entry = { seq: ++this.seq, id: p.id, rev: p.rev, data: p.data, at };
      this.entries.set(p.id, entry);
      accepted.push(entry);
    }
    if (accepted.length) this.append(accepted);

    const mine = new Set(accepted.map((e) => e.seq));
    const all = [];
    for (const e of this.entries.values()) if (e.seq > since && !mine.has(e.seq)) all.push(e);
    all.sort((a, b) => a.seq - b.seq);
    const max = Math.max(1, Math.min(limit, 5000));
    const page = all.slice(0, max);
    const more = all.length > max;
    return {
      accepted: accepted.length,
      entries: page.map(({ seq, id, rev, data }) => ({ seq, id, rev, data })),
      more,
      seq: more ? page[page.length - 1].seq : this.seq,
    };
  }

  append(entries) {
    const text = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
    fs.writeSync(this.fd, text);
    fs.fdatasyncSync(this.fd);
    this.lines += entries.length;
    this.changedAt = Date.now();
    if (this.lines > this.entries.size * 2 + 1000) this.compact();
  }

  /** Rewrite the log with one line per document (atomic rename). */
  compact() {
    const sorted = [...this.entries.values()].sort((a, b) => a.seq - b.seq);
    const tmp = this.logPath + '.tmp';
    const fd = fs.openSync(tmp, 'w');
    fs.writeSync(fd, sorted.map((e) => JSON.stringify(e)).join('\n') + (sorted.length ? '\n' : ''));
    fs.fdatasyncSync(fd);
    fs.closeSync(fd);
    if (this.fd !== null) fs.closeSync(this.fd);
    fs.renameSync(tmp, this.logPath);
    this.fd = fs.openSync(this.logPath, 'a');
    this.lines = sorted.length;
  }

  // ---------------------------------------------------------------------------
  // Blobs: receipt files, stored as-is (ciphertext for encrypted vaults) in
  // <vault>/blobs/<id>. Ids are random and never reused, so blobs are immutable.

  get blobDir() {
    return path.join(this.dir, 'blobs');
  }

  blobPath(id) {
    if (!BLOB_ID.test(id)) throw Object.assign(new Error('invalid blob id'), { status: 400 });
    return path.join(this.blobDir, id);
  }

  putBlob(id, data) {
    const file = this.blobPath(id);
    fs.mkdirSync(this.blobDir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    const fd = fs.openSync(tmp, 'w');
    fs.writeSync(fd, data);
    fs.fdatasyncSync(fd);
    fs.closeSync(fd);
    fs.renameSync(tmp, file);
    this.changedAt = Date.now();
  }

  /** Path to the blob, or null. */
  blobFile(id) {
    const file = this.blobPath(id);
    return fs.existsSync(file) ? file : null;
  }

  deleteBlob(id) {
    const file = this.blobPath(id);
    if (!fs.existsSync(file)) return false;
    fs.rmSync(file);
    return true;
  }

  listBlobs() {
    if (!fs.existsSync(this.blobDir)) return [];
    return fs
      .readdirSync(this.blobDir)
      .filter((f) => BLOB_ID.test(f))
      .map((id) => ({ id, size: fs.statSync(path.join(this.blobDir, id)).size }));
  }

  /** All current entries (for backups / exports). */
  snapshot() {
    return {
      format: 'tally-vault-snapshot',
      version: 1,
      vault: this.meta.name,
      encrypted: this.meta.encrypted,
      seq: this.seq,
      createdAt: new Date().toISOString(),
      entries: [...this.entries.values()].sort((a, b) => a.seq - b.seq),
    };
  }

  info() {
    const blobs = this.listBlobs();
    return {
      vault: this.meta.name,
      encrypted: this.meta.encrypted,
      createdAt: this.meta.createdAt,
      seq: this.seq,
      docs: this.entries.size,
      blobs: blobs.length,
      blobBytes: blobs.reduce((n, b) => n + b.size, 0),
    };
  }

  close() {
    if (this.fd !== null) fs.closeSync(this.fd);
    this.fd = null;
  }
}

function validateEntry(p) {
  if (!p || typeof p !== 'object') return 'entry must be an object';
  if (typeof p.id !== 'string' || !p.id || p.id.length > MAX_ID) return 'invalid id';
  if (typeof p.rev !== 'string' || !p.rev || p.rev.length > MAX_REV) return 'invalid rev';
  if (p.data === undefined) return 'missing data';
  if (JSON.stringify(p.data).length > MAX_ENTRY_BYTES) return 'entry too large';
  return null;
}

export class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.vaultsDir = path.join(dataDir, 'vaults');
    /** @type {Map<string, Vault>} */
    this.vaults = new Map();
    fs.mkdirSync(this.vaultsDir, { recursive: true });
  }

  loadAll() {
    for (const name of fs.readdirSync(this.vaultsDir)) {
      if (!VAULT_NAME.test(name)) continue;
      this.open(name);
    }
    return this;
  }

  open(name) {
    if (this.vaults.has(name)) return this.vaults.get(name);
    const dir = path.join(this.vaultsDir, name);
    const metaPath = path.join(dir, 'vault.json');
    if (!fs.existsSync(metaPath)) return null;
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const v = new Vault(dir, meta).load();
    this.vaults.set(name, v);
    return v;
  }

  get(name) {
    if (!VAULT_NAME.test(name)) return null;
    return this.vaults.get(name) ?? this.open(name);
  }

  create(name, token, encrypted) {
    if (!VAULT_NAME.test(name)) throw Object.assign(new Error('Vault names use a–z, 0–9, "-" and "_" (max 64).'), { status: 400 });
    if (typeof token !== 'string' || token.length < 32) throw Object.assign(new Error('invalid token'), { status: 400 });
    if (this.get(name)) throw Object.assign(new Error('A vault with that name already exists.'), { status: 409 });
    const dir = path.join(this.vaultsDir, name);
    fs.mkdirSync(dir, { recursive: true });
    const meta = {
      name,
      authHash: hashToken(token),
      encrypted: Boolean(encrypted),
      createdAt: new Date().toISOString(),
      schema: 1,
    };
    fs.writeFileSync(path.join(dir, 'vault.json'), JSON.stringify(meta, null, 2));
    const v = new Vault(dir, meta).load();
    this.vaults.set(name, v);
    return v;
  }

  /** Move a vault to <dataDir>/trash so it can still be recovered by hand. */
  remove(name) {
    const v = this.get(name);
    if (!v) return false;
    v.close();
    this.vaults.delete(name);
    const trash = path.join(this.dataDir, 'trash');
    fs.mkdirSync(trash, { recursive: true });
    fs.renameSync(v.dir, path.join(trash, `${name}-${Date.now()}`));
    return true;
  }

  closeAll() {
    for (const v of this.vaults.values()) v.close();
  }
}
