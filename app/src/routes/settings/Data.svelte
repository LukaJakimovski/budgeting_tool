<script lang="ts">
  import { repo } from '$lib/db/repo.svelte';
  import { sync } from '$lib/sync/sync.svelte';
  import { toasts } from '$lib/ui/toast.svelte';
  import { router } from '$lib/ui/router.svelte';
  import { backupStatus, downloadBackup, parseBackup, restore, type ParsedBackup } from '$lib/backup';
  import { exportCSV, exportJSON, exportSQLite, stamp } from '$lib/exporters';
  import { saveFile } from '$lib/platform';
  import { relativeTime } from '$lib/ui/format';
  import Icon from '$lib/ui/Icon.svelte';

  let parsed = $state<ParsedBackup | null>(null);
  let busy = $state('');
  const status = $derived(backupStatus());

  async function run(label: string, fn: () => Promise<unknown>) {
    busy = label;
    try {
      await fn();
    } catch (err) {
      toasts.error(`${label} failed: ${(err as Error).message}`);
    } finally {
      busy = '';
    }
  }

  async function pick(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!f) return;
    try {
      parsed = parseBackup(await f.text());
    } catch (err) {
      toasts.error((err as Error).message);
    }
  }

  async function doRestore(mode: 'merge' | 'replace') {
    if (!parsed) return;
    if (mode === 'replace' && !confirm('Replace ALL data with this backup? Anything not in the backup is deleted' + (sync.config ? ' on every synced device.' : '.'))) return;
    await run('Restore', async () => {
      await restore(parsed!, mode);
      toasts.show(mode === 'merge' ? 'Backup merged' : 'Backup restored', { tone: 'success' });
      parsed = null;
    });
  }

  async function wipe() {
    if (!confirm('Erase all Tally data on THIS device? (Synced data stays on the server.)')) return;
    if (!confirm('Really erase? This cannot be undone.')) return;
    await repo.db.wipe(true);
    localStorage.clear();
    location.reload();
  }
</script>

<div class="stack">
  <section class="card stack">
    <h2>Backup</h2>
    <p class="muted small">
      {#if sync.config}
        Your sync server snapshots your data daily (Settings → Sync). You can also keep your own copy here.
      {:else}
        Without sync your data lives only on this device. Last backup: <strong>{status.last ? relativeTime(status.last) : 'never'}</strong>.
      {/if}
    </p>
    <div class="row wrap">
      <button class="btn primary" disabled={!!busy} onclick={() => run('Backup', async () => (await downloadBackup()) && toasts.show('Backup saved', { tone: 'success' }))}>
        <Icon name="download" size={16} /> Download backup
      </button>
      <label class="btn">
        <Icon name="upload" size={16} /> Restore from file…
        <input type="file" accept=".json,application/json" class="sr-only" onchange={pick} />
      </label>
    </div>
    {#if parsed}
      <div class="restore stack">
        <strong>Backup{parsed.exportedAt ? ` from ${parsed.exportedAt.slice(0, 16).replace('T', ' ')}` : ''}</strong>
        <span class="small muted">{Object.entries(parsed.counts).map(([k, v]) => `${v} ${k}${v === 1 ? '' : 's'}`).join(' · ')}</span>
        <div class="row wrap">
          <button class="btn" onclick={() => doRestore('merge')}>Merge (keep newer of each)</button>
          <button class="btn danger" onclick={() => doRestore('replace')}>Replace everything</button>
          <button class="btn ghost" onclick={() => (parsed = null)}>Cancel</button>
        </div>
      </div>
    {/if}
  </section>

  <section class="card stack">
    <h2>Import</h2>
    <p class="muted small">Bring in a bank statement (CIBC CSV or any CSV) — duplicates and purchases you already logged are detected.</p>
    <button class="btn" onclick={() => router.go('/import')}><Icon name="upload" size={16} /> Import bank CSV</button>
  </section>

  <section class="card stack">
    <h2>Export</h2>
    <p class="muted small">Open formats you can load in Python, R, a spreadsheet, or a future tool. The format is documented in <code>docs/data-format.md</code>.</p>
    <div class="exports">
      <button class="btn" disabled={!!busy} onclick={() => run('Export', () => saveFile(`tally-${stamp()}.json`, exportJSON(), 'application/json'))}>
        <Icon name="download" size={16} /> JSON <span class="faint small">everything, lossless</span>
      </button>
      <button class="btn" disabled={!!busy} onclick={() => run('Export', () => saveFile(`tally-transactions-${stamp()}.csv`, exportCSV(), 'text/csv'))}>
        <Icon name="download" size={16} /> CSV <span class="faint small">one row per line item</span>
      </button>
      <button class="btn" disabled={!!busy} onclick={() => run('Export', async () => saveFile(`tally-${stamp()}.sqlite`, await exportSQLite(), 'application/vnd.sqlite3'))}>
        <Icon name="download" size={16} /> SQLite <span class="faint small">{busy === 'Export' ? 'preparing…' : 'tables, ready for SQL'}</span>
      </button>
    </div>
  </section>

  <section class="card stack">
    <h2>This device</h2>
    <p class="muted small">{repo.allDocs(false).length} documents stored · device id <span class="num">{repo.deviceId}</span></p>
    <button class="btn danger" onclick={wipe}><Icon name="trash" size={16} /> Erase data on this device</button>
  </section>
</div>

<style>
  .restore {
    padding: var(--s3);
    border-radius: var(--radius);
    background: var(--surface2);
  }
  .exports {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
  }
  .exports .btn {
    justify-content: flex-start;
  }
  label.btn {
    position: relative;
  }
</style>
