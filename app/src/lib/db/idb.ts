/**
 * IndexedDB persistence. Three object stores:
 *   docs   – every document (the source of truth on this device)
 *   outbox – {id, rev} of local changes not yet acknowledged by the sync server
 *   meta   – device-local key/values (device id, sync cursor, keys, PIN…)
 * A local save writes the doc and its outbox entry in one transaction, so a
 * change is never stored without being queued for sync.
 */
import type { Doc } from '../core/types';

export interface OutboxEntry {
  id: string;
  rev: string;
}

const DB_VERSION = 1;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export class LocalDB {
  private constructor(private db: IDBDatabase) {}

  static async open(name = 'tally'): Promise<LocalDB> {
    const open = indexedDB.open(name, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    const db = await req(open);
    // Ask the browser not to evict our data under storage pressure.
    try {
      await navigator.storage?.persist?.();
    } catch {
      /* not supported */
    }
    return new LocalDB(db);
  }

  async loadAll(): Promise<Doc[]> {
    const tx = this.db.transaction('docs', 'readonly');
    return req(tx.objectStore('docs').getAll() as IDBRequest<Doc[]>);
  }

  /** Store docs; when `queue` is set also record them in the outbox for sync. */
  async put(docs: Doc[], queue: boolean): Promise<void> {
    if (!docs.length) return;
    const tx = this.db.transaction(['docs', 'outbox'], 'readwrite');
    const store = tx.objectStore('docs');
    const outbox = tx.objectStore('outbox');
    for (const d of docs) {
      store.put($snapshot(d));
      if (queue) outbox.put({ id: d.id, rev: d.rev } satisfies OutboxEntry);
    }
    await done(tx);
  }

  async outbox(): Promise<OutboxEntry[]> {
    const tx = this.db.transaction('outbox', 'readonly');
    return req(tx.objectStore('outbox').getAll() as IDBRequest<OutboxEntry[]>);
  }

  async outboxCount(): Promise<number> {
    const tx = this.db.transaction('outbox', 'readonly');
    return req(tx.objectStore('outbox').count());
  }

  /** Queue every stored doc (used when connecting a device to a new vault). */
  async queueAll(): Promise<void> {
    const docs = await this.loadAll();
    const tx = this.db.transaction('outbox', 'readwrite');
    for (const d of docs) tx.objectStore('outbox').put({ id: d.id, rev: d.rev });
    await done(tx);
  }

  /** Remove acknowledged entries — only if they still have the pushed revision. */
  async ack(entries: OutboxEntry[]): Promise<void> {
    if (!entries.length) return;
    const tx = this.db.transaction('outbox', 'readwrite');
    const store = tx.objectStore('outbox');
    for (const e of entries) {
      const cur = store.get(e.id);
      cur.onsuccess = () => {
        const v = cur.result as OutboxEntry | undefined;
        if (v && v.rev === e.rev) store.delete(e.id);
      };
    }
    await done(tx);
  }

  async clearOutbox(): Promise<void> {
    const tx = this.db.transaction('outbox', 'readwrite');
    tx.objectStore('outbox').clear();
    await done(tx);
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    const tx = this.db.transaction('meta', 'readonly');
    return req(tx.objectStore('meta').get(key) as IDBRequest<T | undefined>);
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    const tx = this.db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put($snapshot(value), key);
    await done(tx);
  }

  async deleteMeta(key: string): Promise<void> {
    const tx = this.db.transaction('meta', 'readwrite');
    tx.objectStore('meta').delete(key);
    await done(tx);
  }

  /** Delete all documents and the outbox (keeps device meta unless `everything`). */
  async wipe(everything = false): Promise<void> {
    const stores = everything ? ['docs', 'outbox', 'meta'] : ['docs', 'outbox'];
    const tx = this.db.transaction(stores, 'readwrite');
    for (const s of stores) tx.objectStore(s).clear();
    await done(tx);
  }

  close(): void {
    this.db.close();
  }
}

/** Strip Svelte proxies / non-cloneable bits before handing data to IndexedDB. */
function $snapshot<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}
