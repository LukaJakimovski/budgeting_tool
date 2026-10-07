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
import { SCHEMA_VERSION, type Doc } from './core/types';

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

export async function downloadBackup(): Promise<boolean> {
  const res = await saveFile(`tally-backup-${stamp()}.json`, exportJSON(), 'application/json');
  if (res === 'saved') {
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    emit('backup:created', { kind: 'local', at: new Date().toISOString() });
    repo.version; // keep reactive readers fresh
    return true;
  }
  return false;
}

export interface ParsedBackup {
  documents: Doc[];
  exportedAt: string | null;
  counts: Record<string, number>;
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

/** merge: keep newer of each document. replace: make everything equal to the backup (on all devices). */
export async function restore(b: ParsedBackup, mode: 'merge' | 'replace'): Promise<void> {
  if (mode === 'replace') await repo.replaceAll(b.documents);
  else await repo.merge(b.documents, true);
}
