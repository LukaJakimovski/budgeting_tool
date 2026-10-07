/**
 * The repository: in-memory copy of every document, persisted to IndexedDB.
 *
 * Reads are synchronous and served from memory (fast even on slow phones);
 * writes update memory first so the UI reacts instantly, then persist and
 * queue the change for sync. Derived data (sorted lists, lookups, allocations)
 * is memoised per data version.
 */
import { Clock, newer } from '../core/hlc';
import { newId } from '../core/ids';
import { allocateAll, type Allocation, type Lookup, type MoneyContext } from '../core/ledger';
import { DEFAULT_SETTINGS, seedCategories, seedPaymentMethods, type SettingKey, type SettingsMap } from '../core/defaults';
import type { CalendarPrefs } from '../core/dates';
import type { Category, Doc, DocOf, DocType, ID, Merchant, PaymentMethod, Setting, Tag, Transaction } from '../core/types';
import { emit } from '../modules/events';
import { LocalDB } from './idb';

const ID_PREFIX: Record<DocType, string> = {
  transaction: 'tx_',
  merchant: 'mer_',
  category: 'cat_',
  tag: 'tag_',
  paymentMethod: 'pm_',
  budget: 'bud_',
  recurring: 'rule_',
  setting: 'setting:',
};

type NewDoc<T extends Doc> = Omit<T, 'id' | 'rev' | 'createdAt' | 'type'> & { id?: ID };

export class Repo {
  /** Bumped on every change; read it (directly or via any getter) to react to data changes. */
  version = $state(0);
  ready = $state(false);
  /** Local changes waiting to be pushed to the sync server. */
  pending = $state(0);
  /** Last persistence error, shown to the user. */
  storageError = $state<string | null>(null);

  db!: LocalDB;
  clock!: Clock;
  deviceId = '';

  private docs = new Map<ID, Doc>();
  private v = 0;
  private memo = new Map<string, { v: number; value: unknown }>();
  private changeListeners = new Set<() => void>();

  async init(db?: LocalDB): Promise<void> {
    this.db = db ?? (await LocalDB.open());
    let deviceId = await this.db.getMeta<string>('deviceId');
    if (!deviceId) {
      deviceId = newId().slice(-8);
      await this.db.setMeta('deviceId', deviceId);
    }
    this.deviceId = deviceId;
    this.clock = new Clock(deviceId);
    for (const d of await this.db.loadAll()) {
      this.docs.set(d.id, d);
      this.clock.observe(d.rev);
    }
    const seeds: Doc[] = [...seedCategories(), ...seedPaymentMethods()].filter((s) => !this.docs.has(s.id));
    if (seeds.length) {
      for (const s of seeds) this.docs.set(s.id, s);
      await this.db.put(seeds, false);
    }
    this.pending = await this.db.outboxCount();
    this.bump();
    this.ready = true;
  }

  // -------------------------------------------------------------------------
  // Reading

  private bump() {
    this.v++;
    this.version = this.v;
  }

  private cached<T>(key: string, compute: () => T): T {
    void this.version; // register reactive dependency
    const hit = this.memo.get(key);
    if (hit && hit.v === this.v) return hit.value as T;
    const value = compute();
    this.memo.set(key, { v: this.v, value });
    return value;
  }

  get<T extends Doc = Doc>(id: ID | null | undefined): T | undefined {
    void this.version;
    if (!id) return undefined;
    const d = this.docs.get(id);
    return d && !d.deleted ? (d as T) : undefined;
  }

  /** Includes deleted tombstones. */
  raw(id: ID): Doc | undefined {
    return this.docs.get(id);
  }

  has(id: ID): boolean {
    return this.docs.has(id);
  }

  /** All live documents of a type. */
  list<K extends DocType>(type: K): DocOf<K>[] {
    return this.cached(`list:${type}`, () => {
      const out: DocOf<K>[] = [];
      for (const d of this.docs.values()) if (d.type === type && !d.deleted) out.push(d as DocOf<K>);
      return out;
    });
  }

  allDocs(includeDeleted = true): Doc[] {
    return Array.from(this.docs.values()).filter((d) => includeDeleted || !d.deleted);
  }

  /** Transactions, newest first. */
  transactions(): Transaction[] {
    return this.cached('transactions', () =>
      [...this.list('transaction')].sort((a, b) =>
        a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : a.createdAt < b.createdAt ? 1 : -1,
      ),
    );
  }

  categories(includeArchived = false): Category[] {
    return this.cached(`categories:${includeArchived}`, () =>
      this.list('category')
        .filter((c) => includeArchived || !c.archived)
        .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
    );
  }

  merchants(includeArchived = false): Merchant[] {
    return this.cached(`merchants:${includeArchived}`, () =>
      this.list('merchant')
        .filter((m) => includeArchived || !m.archived)
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  }

  tags(includeArchived = false): Tag[] {
    return this.cached(`tags:${includeArchived}`, () =>
      this.list('tag')
        .filter((t) => includeArchived || !t.archived)
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  }

  paymentMethods(includeArchived = false): PaymentMethod[] {
    return this.cached(`pms:${includeArchived}`, () =>
      this.list('paymentMethod')
        .filter((p) => includeArchived || !p.archived)
        .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
    );
  }

  lookup(): Lookup {
    return this.cached('lookup', () => ({
      categories: new Map(this.list('category').map((c) => [c.id, c])),
      merchants: new Map(this.list('merchant').map((m) => [m.id, m])),
      tags: new Map(this.list('tag').map((t) => [t.id, t])),
    }));
  }

  setting<K extends SettingKey>(key: K): SettingsMap[K] {
    const doc = this.get<Setting>(`setting:${key}`);
    if (!doc) return DEFAULT_SETTINGS[key];
    const def = DEFAULT_SETTINGS[key];
    // Merge objects so new default fields appear for old saved settings.
    if (def && typeof def === 'object' && !Array.isArray(def) && doc.value && typeof doc.value === 'object') {
      return { ...def, ...(doc.value as object) } as SettingsMap[K];
    }
    return doc.value as SettingsMap[K];
  }

  calendar(): CalendarPrefs {
    return { weekStart: this.setting('weekStart'), monthStartDay: this.setting('monthStartDay') };
  }

  moneyContext(): MoneyContext {
    return this.cached('money', () => ({ baseCurrency: this.setting('baseCurrency'), rates: this.setting('rates') }));
  }

  /** Every transaction broken into category-level allocation lines. */
  allocations(): Allocation[] {
    return this.cached('allocations', () => allocateAll(this.transactions(), this.moneyContext()));
  }

  // -------------------------------------------------------------------------
  // Writing

  onLocalChange(fn: () => void): () => void {
    this.changeListeners.add(fn);
    return () => this.changeListeners.delete(fn);
  }

  newId(type: DocType): ID {
    return newId(ID_PREFIX[type]);
  }

  /** Create a document of `type`. Returns it once persisted. */
  async create<K extends DocType>(type: K, fields: NewDoc<DocOf<K>>): Promise<DocOf<K>> {
    const doc = {
      ...fields,
      id: fields.id ?? this.newId(type),
      type,
      rev: '',
      createdAt: new Date().toISOString(),
    } as unknown as DocOf<K>;
    await this.save([doc]);
    return this.docs.get(doc.id) as DocOf<K>;
  }

  /** Apply a partial update to a document. */
  async update<T extends Doc>(id: ID, patch: Partial<T>): Promise<T> {
    const cur = this.docs.get(id);
    if (!cur) throw new Error(`No document ${id}`);
    const next = { ...cur, ...patch, id, type: cur.type } as T;
    await this.save([next]);
    return this.docs.get(id) as T;
  }

  /** Tombstone a document (kept so the deletion syncs; restorable with `restore`). */
  async remove(id: ID): Promise<void> {
    const cur = this.docs.get(id);
    if (!cur || cur.deleted) return;
    await this.save([{ ...cur, deleted: true }]);
  }

  async restore(id: ID): Promise<void> {
    const cur = this.docs.get(id);
    if (!cur) return;
    await this.save([{ ...cur, deleted: false }]);
  }

  async setSetting<K extends SettingKey>(key: K, value: SettingsMap[K]): Promise<void> {
    const id = `setting:${key}`;
    const cur = this.docs.get(id) as Setting | undefined;
    const doc: Setting = {
      id,
      type: 'setting',
      key,
      value: JSON.parse(JSON.stringify(value)),
      rev: '',
      createdAt: cur?.createdAt ?? new Date().toISOString(),
    };
    await this.save([doc]);
  }

  /** Low-level local write: stamps revisions, updates memory, persists, queues for sync. */
  async save(docs: Doc[]): Promise<void> {
    const stamped: Doc[] = [];
    for (const d of docs) {
      const previous = this.docs.get(d.id);
      const doc = { ...d, rev: this.clock.tick() } as Doc;
      if (!doc.deleted) delete doc.deleted;
      this.docs.set(doc.id, doc);
      stamped.push(doc);
      emit('doc:saved', { doc, previous, origin: 'local' });
    }
    this.bump();
    try {
      await this.db.put(stamped, true);
      this.storageError = null;
    } catch (err) {
      this.storageError = `Could not save to this device: ${(err as Error).message}`;
      throw err;
    }
    this.pending = await this.db.outboxCount();
    for (const fn of this.changeListeners) fn();
  }

  /**
   * Merge documents that came from elsewhere (sync, import). Last writer wins
   * by revision. With `queue`, accepted docs are also queued for sync (used
   * by file imports so they reach the other devices).
   */
  async merge(docs: Doc[], queue = false): Promise<Doc[]> {
    const accepted: Doc[] = [];
    for (const d of docs) {
      if (!d || typeof d.id !== 'string' || typeof d.rev !== 'string') continue;
      const cur = this.docs.get(d.id);
      if (cur && !newer(d.rev, cur.rev)) continue;
      this.clock.observe(d.rev);
      this.docs.set(d.id, d);
      accepted.push(d);
      emit('doc:saved', { doc: d, previous: cur, origin: 'remote' });
    }
    if (accepted.length) {
      this.bump();
      await this.db.put(accepted, queue);
      if (queue) {
        this.pending = await this.db.outboxCount();
        for (const fn of this.changeListeners) fn();
      }
    }
    return accepted;
  }

  /**
   * Make the data equal to `docs` (restore from a backup) on this device and,
   * through sync, on every device: backup docs are re-stamped so they win, and
   * anything not in the backup is deleted.
   */
  async replaceAll(docs: Doc[]): Promise<void> {
    const keep = new Set(docs.map((d) => d.id));
    const tombstones: Doc[] = [];
    for (const d of this.docs.values()) {
      if (!keep.has(d.id) && !d.deleted && !d.rev.endsWith('-seed')) tombstones.push({ ...d, deleted: true });
    }
    await this.save([...docs, ...tombstones]);
  }

  async refreshPending(): Promise<void> {
    this.pending = await this.db.outboxCount();
  }
}

export const repo = new Repo();
