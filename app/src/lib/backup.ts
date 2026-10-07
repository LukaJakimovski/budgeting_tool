/**
 * Backups from the app's side.
 *   - With sync on, the server writes daily rotating snapshots automatically.
 *   - Without sync, the app reminds you to download a JSON backup every
 *     N days (Settings → General) and can restore from it.
 */
import { repo } from './db/repo.svelte';
import { sync } from './sync/sync.svelte';
import { exportJSON, stamp } from './exporters';
import { saveFile } from './platform';
import { emit } from './modules/events';
import { SCHEMA_VERSION, type Attachment, type Doc, type Transaction } from './core/types';
import { extensionFor, loadAttachment } from './attachments';
import { strToU8, strFromU8, unzipSync, zipSync, type Zippable } from 'fflate';

const KEY = 'tally-last-backup';

function lastBackup(): number | null {
  try {
    const v = localStorage.getItem(KEY);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

export function backupStatus(): { due: boolean; message: string; last: number | null } {
  void repo.version;
  const last = lastBackup();
  const days = repo.setting('backupReminderDays');
  if (sync.config) return { due: false, last, message: 'Your sync server keeps daily snapshots.' };
  if (!days || repo.list('transaction').length < 5) return { due: false, last, message: '' };
  const age = last ? (Date.now() - last) / 86_400_000 : Infinity;
  return {
    due: age > days,
    last,
    message: last ? `Last backup ${Math.floor(age)} days ago. Your data only lives on this device.` : 'Your data only lives on this device — keep a copy somewhere safe.',
  };
}

function liveAttachments(): Attachment[] {
  return (repo.list('transaction') as Transaction[]).flatMap((t) => t.attachments ?? []);
}

/**
 * Build a backup: plain JSON, or — when there are receipts — a .zip with
 * tally-backup.json plus receipts/<id>.<ext>. Receipts not on this device are
 * downloaded from the sync server first when possible.
 */
export async function buildBackup(): Promise<{ name: string; data: string | Uint8Array; mime: string; missing: number }> {
  const json = exportJSON();
  const atts = liveAttachments();
  if (!atts.length) return { name: `tally-backup-${stamp()}.json`, data: json, mime: 'application/json', missing: 0 };
  const files: Zippable = { 'tally-backup.json': [strToU8(json), { level: 6 }] };
  let missing = 0;
  for (const a of atts) {
    const blob = await loadAttachment(a).catch(() => null);
    if (!blob) {
      missing++;
      continue;
    }
    // Photos are already compressed; store them as-is.
    files[`receipts/${a.id}.${extensionFor(a.mime)}`] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
  }
  return { name: `tally-backup-${stamp()}.zip`, data: zipSync(files), mime: 'application/zip', missing };
}

export async function downloadBackup(): Promise<{ saved: boolean; missing: number }> {
  const b = await buildBackup();
  const res = await saveFile(b.name, b.data, b.mime);
  if (res === 'saved') {
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    emit('backup:created', { kind: 'local', at: new Date().toISOString() });
    return { saved: true, missing: b.missing };
  }
  return { saved: false, missing: b.missing };
}

export interface ParsedBackup {
  documents: Doc[];
  exportedAt: string | null;
  counts: Record<string, number>;
  /** Receipt files from a .zip backup, by attachment id. */
  files?: Map<string, Uint8Array>;
}

/** Accepts a Tally JSON export or a server snapshot (unencrypted). */
export function parseBackup(text: string): ParsedBackup {
  const data = JSON.parse(text);
  let docs: Doc[];
  if (data?.format === 'tally-export') docs = data.documents;
  else if (data?.format === 'tally-vault-snapshot') {
    if (data.encrypted) throw new Error('This server snapshot is encrypted — restore it from Settings → Sync → Server backups.');
    docs = data.entries.map((e: { data: Doc }) => e.data);
  } else if (Array.isArray(data)) docs = data;
  else throw new Error('Not a Tally backup file.');
  if (data?.version > SCHEMA_VERSION) throw new Error('This backup is from a newer version of Tally. Update the app first.');
  docs = docs.filter((d) => d && typeof d.id === 'string' && typeof d.type === 'string' && typeof d.rev === 'string');
  const counts: Record<string, number> = {};
  for (const d of docs) if (!d.deleted) counts[d.type] = (counts[d.type] ?? 0) + 1;
  return { documents: docs, exportedAt: data?.exportedAt ?? null, counts };
}

/** Read a backup file: .json, or .zip with receipts. */
export async function parseBackupFile(file: Blob): Promise<ParsedBackup> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return parseBackup(strFromU8(bytes));
  const entries = unzipSync(bytes);
  const json = entries['tally-backup.json'];
  if (!json) throw new Error('This zip has no tally-backup.json.');
  const parsed = parseBackup(strFromU8(json));
  const files = new Map<string, Uint8Array>();
  for (const [path, data] of Object.entries(entries)) {
    const m = path.match(/^receipts\/([A-Za-z0-9_-]+)\.\w+$/);
    if (m) files.set(m[1], data);
  }
  parsed.files = files;
  if (files.size) parsed.counts.receipt = files.size;
  return parsed;
}

/** merge: keep newer of each document. replace: make everything equal to the backup (on all devices). */
export async function restore(b: ParsedBackup, mode: 'merge' | 'replace'): Promise<void> {
  if (b.files?.size) {
    const mimes = new Map<string, string>();
    for (const d of b.documents) if (d.type === 'transaction') for (const a of (d as Transaction).attachments ?? []) mimes.set(a.id, a.mime);
    for (const [id, data] of b.files) await repo.db.putBlob({ id, mime: mimes.get(id) ?? 'application/octet-stream', data }, true);
    void sync.refreshBlobPending();
  }
  if (mode === 'replace') await repo.replaceAll(b.documents);
  else await repo.merge(b.documents, true);
}
