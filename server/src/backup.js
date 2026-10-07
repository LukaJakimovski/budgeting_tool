/**
 * Backups and plain exports.
 *
 * Snapshots: <backupDir>/<vault>/<vault>-YYYY-MM-DD.json.gz — the whole vault
 * (ciphertext for encrypted vaults), taken at most once a day when something
 * changed, plus on demand. Retention keeps the newest N daily, N weekly
 * (Mondays) and N monthly (1st of month) snapshots.
 *
 * Receipt files: copied once into <backupDir>/<vault>/blobs/ (they never
 * change, so this is incremental and kept even if a receipt is later deleted).
 *
 * Plain export: <dataDir>/exports/<vault>.json — for unencrypted vaults, the
 * current documents as a single readable JSON file in the same format as the
 * app's "Export JSON", handy for scripts running on the server.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const today = () => new Date().toISOString().slice(0, 10);

export class Backups {
  constructor(config, store, log = console) {
    this.cfg = config.backup;
    this.dataDir = config.dataDir;
    this.plainExport = config.plainExport;
    this.store = store;
    this.log = log;
    this.timer = null;
    this.exportTimers = new Map();
  }

  dirFor(vault) {
    return path.join(this.cfg.dir, vault);
  }

  list(vault) {
    const dir = this.dirFor(vault);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json.gz'))
      .sort()
      .reverse()
      .map((name) => {
        const st = fs.statSync(path.join(dir, name));
        return { name, date: name.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? '', size: st.size, createdAt: st.mtime.toISOString() };
      });
  }

  read(vault, name) {
    if (!/^[a-z0-9_-]+-\d{4}-\d{2}-\d{2}(-manual-\d+)?\.json\.gz$/.test(name)) return null;
    const file = path.join(this.dirFor(vault), name);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
  }

  /** Copy receipt files that aren't in the backup folder yet. Returns how many were copied. */
  backupBlobs(vault) {
    const v = this.store.get(vault);
    if (!v) return 0;
    const dest = path.join(this.dirFor(vault), 'blobs');
    let n = 0;
    for (const { id } of v.listBlobs()) {
      const target = path.join(dest, id);
      if (fs.existsSync(target)) continue;
      fs.mkdirSync(dest, { recursive: true });
      fs.copyFileSync(path.join(v.blobDir, id), target);
      n++;
    }
    return n;
  }

  /** A receipt from the backup folder (used if the live copy was deleted). */
  backedUpBlob(vault, id) {
    const file = path.join(this.dirFor(vault), 'blobs', id);
    return fs.existsSync(file) ? file : null;
  }

  /** Write a snapshot now. `manual` snapshots never overwrite the daily one. */
  snapshot(vault, { manual = false } = {}) {
    const v = this.store.get(vault);
    if (!v) return null;
    const dir = this.dirFor(vault);
    fs.mkdirSync(dir, { recursive: true });
    const name = manual ? `${vault}-${today()}-manual-${Date.now()}.json.gz` : `${vault}-${today()}.json.gz`;
    const tmp = path.join(dir, name + '.tmp');
    fs.writeFileSync(tmp, zlib.gzipSync(JSON.stringify(v.snapshot())));
    fs.renameSync(tmp, path.join(dir, name));
    v.backedUpSeq = v.seq;
    this.backupBlobs(vault);
    this.prune(vault);
    return name;
  }

  /** Daily snapshot for every vault that changed since its last one. */
  runDaily() {
    if (!this.cfg.enabled) return;
    for (const v of this.store.vaults.values()) {
      try {
        const name = `${v.name}-${today()}.json.gz`;
        const exists = fs.existsSync(path.join(this.dirFor(v.name), name));
        const last = this.list(v.name)[0];
        const changed = v.backedUpSeq === undefined ? !last || v.seq > 0 : v.seq !== v.backedUpSeq;
        if (!exists && changed && v.seq > 0) {
          this.snapshot(v.name);
          this.log.info?.(`[backup] ${v.name}: wrote ${name}`);
        } else if (v.backedUpSeq === undefined) {
          v.backedUpSeq = v.seq;
        }
        // Receipts can be added without a document change on this day.
        this.backupBlobs(v.name);
      } catch (err) {
        this.log.error?.(`[backup] ${v.name}: ${err.message}`);
      }
    }
  }

  prune(vault) {
    // Newest first. Daily: newest N. Weekly/monthly: the first snapshot of each
    // week (Monday-based) / month, newest N of those.
    const files = this.list(vault).filter((f) => !f.name.includes('-manual-'));
    const keep = new Set(files.slice(0, this.cfg.keepDaily).map((f) => f.name));
    const firstOf = (keyOf) => {
      const groups = new Map();
      for (const f of files) groups.set(keyOf(f.date), f.name); // newest-first → ends on the earliest
      return [...groups.values()];
    };
    const weekKey = (date) => {
      const d = new Date(date + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      return d.toISOString().slice(0, 10);
    };
    firstOf(weekKey).slice(0, this.cfg.keepWeekly).forEach((n) => keep.add(n));
    firstOf((date) => date.slice(0, 7)).slice(0, this.cfg.keepMonthly).forEach((n) => keep.add(n));
    for (const f of files) {
      if (!keep.has(f.name)) fs.rmSync(path.join(this.dirFor(vault), f.name), { force: true });
    }
    // Manual snapshots: keep the newest 10.
    const manual = this.list(vault).filter((f) => f.name.includes('-manual-'));
    for (const f of manual.slice(10)) fs.rmSync(path.join(this.dirFor(vault), f.name), { force: true });
  }

  /** Debounced rewrite of the plain export (unencrypted vaults only). */
  scheduleExport(vault) {
    if (!this.plainExport) return;
    const v = this.store.get(vault);
    if (!v || v.meta.encrypted) return;
    clearTimeout(this.exportTimers.get(vault));
    const t = setTimeout(() => this.writeExport(vault), 5000);
    t.unref?.();
    this.exportTimers.set(vault, t);
  }

  writeExport(vault) {
    const v = this.store.get(vault);
    if (!v || v.meta.encrypted) return null;
    const dir = path.join(this.dataDir, 'exports');
    fs.mkdirSync(dir, { recursive: true });
    const docs = [...v.entries.values()].map((e) => e.data).filter((d) => d && typeof d === 'object');
    const out = {
      format: 'tally-export',
      version: 1,
      exportedAt: new Date().toISOString(),
      source: `server:${vault}`,
      documents: docs,
    };
    const file = path.join(dir, `${vault}.json`);
    fs.writeFileSync(file + '.tmp', JSON.stringify(out, null, 1));
    fs.renameSync(file + '.tmp', file);
    return file;
  }

  start() {
    if (!this.cfg.enabled) return;
    this.runDaily();
    this.timer = setInterval(() => this.runDaily(), 60 * 60 * 1000);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
    for (const t of this.exportTimers.values()) clearTimeout(t);
  }
}
