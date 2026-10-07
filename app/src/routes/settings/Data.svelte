<script lang="ts">
  import { repo } from '$lib/db/repo.svelte';
  import { sync } from '$lib/sync/sync.svelte';
  import { toasts } from '$lib/ui/toast.svelte';
  import { router } from '$lib/ui/router.svelte';
  import { backupStatus, downloadBackup, parseBackupFile, restore, type ParsedBackup } from '$lib/backup';
  import { cleanupUnusedAttachments, downloadAllAttachments, formatBytes } from '$lib/attachments';
  import { exportCSV, exportJSON, exportSQLite, stamp } from '$lib/exporters';
  import { saveFile } from '$lib/platform';
  import { relativeTime } from '$lib/ui/format';
  import Icon from '$lib/ui/Icon.svelte';

  let parsed = $state<ParsedBackup | null>(null);
  let receiptStats = $state(repo.db.blobStats());
  const receiptCount = $derived(repo.list('transaction').reduce((n, t) => n + (t.attachments?.length ?? 0), 0));
  function refreshStats() {
    receiptStats = repo.db.blobStats();
  }
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
      parsed = await parseBackupFile(f);
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
      <button
        class="btn primary"
        disabled={!!busy}
        onclick={() =>
          run('Backup', async () => {
            const r = await downloadBackup();
            if (r.saved) toasts.show(r.missing ? `Backup saved — ${r.missing} receipt${r.missing > 1 ? 's' : ''} couldn't be included (not on this device or the server)` : 'Backup saved', { tone: 'success', timeout: r.missing ? 8000 : 3500 });
          })}
      >
        <Icon name="download" size={16} /> Download backup
      </button>
      <label class="btn">
        <Icon name="upload" size={16} /> Restore from file…
        <input type="file" accept=".json,.zip,application/json,application/zip" class="sr-only" onchange={pick} />
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
    <h2>Receipts</h2>
    {#await receiptStats then st}
      <p class="muted small">
        {receiptCount} receipt{receiptCount === 1 ? '' : 's'} attached · {st.count} file{st.count === 1 ? '' : 's'} ({formatBytes(st.bytes)}) stored on this device.
        {#if sync.config}Other receipts download from your server the first time you open them.{/if}
      </p>
    {/await}
    <div class="row wrap">
      {#if sync.config}
        <button class="btn" disabled={!!busy} onclick={() => run('Download', async () => { const n = await downloadAllAttachments(); toasts.show(`Downloaded ${n} receipt${n === 1 ? '' : 's'}`); refreshStats(); })}>
          <Icon name="download" size={16} /> Keep all receipts on this device
        </button>
      {/if}
      <button class="btn" disabled={!!busy} onclick={() => run('Clean up', async () => { const r = await cleanupUnusedAttachments(); toasts.show(`Removed ${r.local + r.server} unused file${r.local + r.server === 1 ? '' : 's'}`); refreshStats(); })}>
        <Icon name="trash" size={16} /> Clean up unused receipts
      </button>
    </div>
    <p class="faint small">Receipts of deleted transactions are kept (so Undo works) until you clean up. Server backups keep a copy of every receipt.</p>
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
