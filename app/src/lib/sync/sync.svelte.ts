/**
 * Sync engine. Local-first: the app never waits for the network. Changes are
 * saved on the device, queued in the outbox, and pushed/pulled in the
 * background whenever a connection is available.
 *
 * One round = POST /api/v1/vaults/<vault>/sync with {since, push} and merge of
 * the returned entries; repeated until nothing is left to push or pull.
 * Protocol: docs/sync-protocol.md
 */
import { repo as defaultRepo, type Repo } from '../db/repo.svelte';
import type { Doc } from '../core/types';
import { decryptBytes, decryptJSON, deriveVaultKeys, encryptBytes, encryptJSON } from './crypto';
import { emit } from '../modules/events';

export interface SyncConfig {
  serverUrl: string;
  vault: string;
  encrypted: boolean;
  token: string;
  key: string | null;
}

export type SyncState = 'off' | 'synced' | 'pending' | 'syncing' | 'offline' | 'error';

interface Entry {
  seq?: number;
  id: string;
  rev: string;
  data: unknown;
}

export interface ServerBackup {
  name: string;
  date: string;
  size: number;
  createdAt: string;
}

const PUSH_BATCH = 400;
const TIMEOUT_MS = 20_000;
/** Receipts can be slow to upload on a bad connection. */
const BLOB_TIMEOUT_MS = 180_000;
const PERIODIC_MS = 60_000;
/** Warn when local changes have waited this long without reaching the server. */
export const UNSYNCED_WARN_MS = 10 * 60_000;

export class SyncError extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}

export function normaliseServerUrl(url: string): string {
  let u = url.trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = (u.startsWith('localhost') || u.startsWith('127.') ? 'http://' : 'https://') + u;
  return u.replace(/\/+$/, '');
}

async function request<T>(url: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  let body = init.body;
  if (typeof body === 'string') {
    headers['Content-Type'] = 'application/json';
    // Compress bigger uploads — helps a lot on slow mobile connections.
    if (body.length > 8192 && typeof CompressionStream !== 'undefined') {
      body = await new Response(new Blob([body]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
      headers['Content-Encoding'] = 'gzip';
    }
  }
  try {
    const res = await fetch(url, { ...init, body, headers, signal: ctrl.signal, cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new SyncError((data as { error?: string }).error ?? `Server responded ${res.status}`, res.status);
    return data as T;
  } catch (err) {
    if (err instanceof SyncError) throw err;
    if ((err as Error).name === 'AbortError') throw new SyncError('The server took too long to answer.');
    throw new SyncError('Could not reach the sync server.');
  } finally {
    clearTimeout(timer);
  }
}

async function requestBytes(
  url: string,
  init: { method?: string; token: string; body?: Uint8Array },
): Promise<Uint8Array | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), BLOB_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: init.method ?? 'GET',
      headers: { Authorization: `Bearer ${init.token}`, ...(init.body ? { 'Content-Type': 'application/octet-stream' } : {}) },
      body: init.body as BodyInit | undefined,
      signal: ctrl.signal,
      cache: 'no-store',
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new SyncError((data as { error?: string }).error ?? `Server responded ${res.status}`, res.status);
    }
    return new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    if (err instanceof SyncError) throw err;
    if ((err as Error).name === 'AbortError') throw new SyncError('Uploading a receipt took too long; will retry.');
    throw new SyncError('Could not reach the sync server.');
  } finally {
    clearTimeout(timer);
  }
}

export class SyncEngine {
  config = $state<SyncConfig | null>(null);
  busy = $state(false);
  online = $state(typeof navigator === 'undefined' || navigator.onLine !== false);
  lastSyncAt = $state<number | null>(null);
  lastError = $state<string | null>(null);
  /** When the oldest unsynced change happened (approx.). */
  pendingSince = $state<number | null>(null);
  /** Receipt uploads/deletions waiting for the server. */
  pendingBlobs = $state(0);

  private r: Repo;
  constructor(r: Repo = defaultRepo) {
    this.r = r;
  }

  private timer: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private failures = 0;
  private again = false;

  get state(): SyncState {
    if (!this.config) return 'off';
    if (this.busy) return 'syncing';
    if (!this.online) return 'offline';
    if (this.lastError) return 'error';
    if (this.r.pending > 0 || this.pendingBlobs > 0) return 'pending';
    return 'synced';
  }

  /** True when there are local changes that should have been synced by now. */
  get unsyncedWarning(): boolean {
    if (!this.config || this.r.pending === 0) return false;
    return this.pendingSince !== null && Date.now() - this.pendingSince > UNSYNCED_WARN_MS;
  }

  async refreshBlobPending(): Promise<void> {
    this.pendingBlobs = (await this.r.db.blobOutbox()).length;
    if (this.pendingBlobs) this.schedule(1500);
  }

  async init(): Promise<void> {
    this.config = (await this.r.db.getMeta<SyncConfig>('sync')) ?? null;
    await this.refreshBlobPending();
    this.lastSyncAt = (await this.r.db.getMeta<number>('lastSyncAt')) ?? null;
    if (this.r.pending > 0) this.pendingSince = (await this.r.db.getMeta<number>('pendingSince')) ?? Date.now();
    this.r.onLocalChange(() => {
      if (this.pendingSince === null) {
        this.pendingSince = Date.now();
        void this.r.db.setMeta('pendingSince', this.pendingSince);
      }
      this.schedule(1500);
    });
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.online = true;
        this.schedule(200);
      });
      window.addEventListener('offline', () => (this.online = false));
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.schedule(300);
      });
      this.interval = setInterval(() => {
        if (document.visibilityState === 'visible') this.schedule(0);
      }, PERIODIC_MS);
    }
    if (this.config) this.schedule(100);
  }

  schedule(delay = 1500): void {
    if (!this.config) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.syncNow().catch(() => undefined);
    }, delay);
  }

  private url(path: string): string {
    return `${this.config!.serverUrl}/api/v1${path}`;
  }

  /** Check a server URL and return what it reports. */
  static async probe(serverUrl: string): Promise<{ ok: boolean; version: string; signup: 'open' | 'secret' | 'closed' }> {
    return request(`${normaliseServerUrl(serverUrl)}/api/v1/health`);
  }

  /**
   * Connect this device to a vault (creating it when `create` is set). All
   * local data is queued so it reaches the vault too.
   */
  async connect(opts: {
    serverUrl: string;
    vault: string;
    passphrase: string;
    create: boolean;
    encrypted: boolean;
    signupSecret?: string;
  }): Promise<void> {
    const serverUrl = normaliseServerUrl(opts.serverUrl);
    const vault = opts.vault.trim().toLowerCase();
    const keys = await deriveVaultKeys(opts.passphrase, vault);
    let encrypted = opts.encrypted;
    if (opts.create) {
      const info = await request<{ encrypted: boolean }>(`${serverUrl}/api/v1/vaults`, {
        method: 'POST',
        body: JSON.stringify({ vault, token: keys.token, encrypted: opts.encrypted, signupSecret: opts.signupSecret }),
      });
      encrypted = info.encrypted;
    } else {
      const info = await request<{ encrypted: boolean }>(`${serverUrl}/api/v1/vaults/${encodeURIComponent(vault)}`, { token: keys.token });
      encrypted = info.encrypted;
    }
    const config: SyncConfig = { serverUrl, vault, encrypted, token: keys.token, key: encrypted ? keys.key : null };
    await this.r.db.setMeta('sync', config);
    await this.r.db.setMeta('syncCursor', 0);
    await this.r.db.queueAll();
    await this.r.db.queueAllBlobs();
    await this.r.refreshPending();
    this.config = config;
    this.lastError = null;
    this.failures = 0;
    await this.syncNow();
  }

  async disconnect(): Promise<void> {
    await this.r.db.deleteMeta('sync');
    await this.r.db.deleteMeta('syncCursor');
    this.config = null;
    this.lastError = null;
  }

  private encode(doc: Doc): Entry {
    const c = this.config!;
    return { id: doc.id, rev: doc.rev, data: c.encrypted && c.key ? encryptJSON(c.key, doc.id, doc) : doc };
  }

  private decode(e: Entry): Doc | null {
    const c = this.config!;
    try {
      const doc = (c.encrypted && c.key ? decryptJSON<Doc>(c.key, e.id, e.data as string) : (e.data as Doc));
      return doc && doc.id === e.id ? doc : null;
    } catch {
      throw new SyncError('Could not decrypt data from the server. Is the passphrase right?');
    }
  }

  /** Push everything pending and pull everything new. */
  async syncNow(): Promise<void> {
    if (!this.config) return;
    if (this.busy) {
      this.again = true;
      return;
    }
    this.busy = true;
    let pulledTotal = 0;
    let pushedTotal = 0;
    try {
      for (let round = 0; round < 1000; round++) {
        const outbox = (await this.r.db.outbox()).slice(0, PUSH_BATCH);
        const push: Entry[] = [];
        for (const o of outbox) {
          const doc = this.r.raw(o.id);
          if (doc) push.push(this.encode(doc));
        }
        const since = (await this.r.db.getMeta<number>('syncCursor')) ?? 0;
        const res = await request<{ entries: Entry[]; seq: number; more: boolean; accepted: number }>(
          this.url(`/vaults/${encodeURIComponent(this.config.vault)}/sync`),
          { method: 'POST', token: this.config.token, body: JSON.stringify({ since, push, limit: 1000 }) },
        );
        const docs = res.entries.map((e) => this.decode(e)).filter((d): d is Doc => d !== null);
        if (docs.length) await this.r.merge(docs);
        await this.r.db.ack(outbox);
        await this.r.db.setMeta('syncCursor', res.seq);
        pulledTotal += docs.length;
        pushedTotal += push.length;
        const left = await this.r.db.outboxCount();
        if (!res.more && left === 0) break;
        if (!res.more && outbox.length === 0) break;
      }
      await this.r.refreshPending();
      pushedTotal += await this.syncBlobs();
      this.lastSyncAt = Date.now();
      this.lastError = null;
      this.failures = 0;
      if (this.r.pending === 0) {
        this.pendingSince = null;
        await this.r.db.deleteMeta('pendingSince');
      }
      await this.r.db.setMeta('lastSyncAt', this.lastSyncAt);
      emit('sync:completed', { pulled: pulledTotal, pushed: pushedTotal });
    } catch (err) {
      const e = err as SyncError;
      this.lastError = e.message;
      if (e.status === 0 && typeof navigator !== 'undefined' && navigator.onLine === false) this.online = false;
      this.failures++;
      // Back off: 5s, 10s, 20s … up to 5 minutes. Auth errors wait for the user.
      if (e.status !== 401 && e.status !== 403) this.schedule(Math.min(300_000, 5000 * 2 ** (this.failures - 1)));
      throw err;
    } finally {
      this.busy = false;
      if (this.again) {
        this.again = false;
        this.schedule(100);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Receipts (blobs)

  private blobUrl(id = ''): string {
    return this.url(`/vaults/${encodeURIComponent(this.config!.vault)}/blobs${id ? '/' + encodeURIComponent(id) : ''}`);
  }

  /** Upload/delete queued receipt files. Returns how many were sent. */
  private async syncBlobs(): Promise<number> {
    const c = this.config!;
    let sent = 0;
    for (const entry of await this.r.db.blobOutbox()) {
      if (entry.op === 'put') {
        const blob = await this.r.db.getBlob(entry.id);
        if (blob) {
          const body = c.encrypted && c.key ? encryptBytes(c.key, entry.id, blob.data) : blob.data;
          await requestBytes(this.blobUrl(entry.id), { method: 'PUT', token: c.token, body });
          sent++;
        }
      } else {
        await requestBytes(this.blobUrl(entry.id), { method: 'DELETE', token: c.token });
        sent++;
      }
      await this.r.db.ackBlob(entry);
      this.pendingBlobs = Math.max(0, this.pendingBlobs - 1);
    }
    await this.refreshBlobPending();
    return sent;
  }

  /** Fetch a receipt's bytes from the server (null if it isn't there). */
  async downloadBlob(id: string): Promise<Uint8Array | null> {
    const c = this.config;
    if (!c) return null;
    const data = await requestBytes(this.blobUrl(id), { token: c.token });
    if (!data) return null;
    try {
      return c.encrypted && c.key ? decryptBytes(c.key, id, data) : data;
    } catch {
      throw new SyncError('Could not decrypt a receipt from the server.');
    }
  }

  async listServerBlobs(): Promise<string[]> {
    if (!this.config) return [];
    const r = await request<{ blobs: { id: string }[] }>(this.blobUrl(), { token: this.config.token });
    return r.blobs.map((b) => b.id);
  }

  // -------------------------------------------------------------------------
  // Server backups

  async listBackups(): Promise<ServerBackup[]> {
    if (!this.config) return [];
    const r = await request<{ backups: ServerBackup[] }>(this.url(`/vaults/${encodeURIComponent(this.config.vault)}/backups`), {
      token: this.config.token,
    });
    return r.backups;
  }

  async createBackup(): Promise<string> {
    const r = await request<{ name: string }>(this.url(`/vaults/${encodeURIComponent(this.config!.vault)}/backups`), {
      method: 'POST',
      token: this.config!.token,
    });
    emit('backup:created', { kind: 'server', at: new Date().toISOString() });
    return r.name;
  }

  /** Download a server snapshot and decode it into documents. */
  async fetchBackup(name: string): Promise<Doc[]> {
    const snap = await request<{ entries: Entry[] }>(
      this.url(`/vaults/${encodeURIComponent(this.config!.vault)}/backups/${encodeURIComponent(name)}`),
      { token: this.config!.token },
    );
    return snap.entries.map((e) => this.decode(e)).filter((d): d is Doc => d !== null);
  }
}

export const sync = new SyncEngine();
