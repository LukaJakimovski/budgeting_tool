<script lang="ts">
  import { repo } from '$lib/db/repo.svelte';
  import { sync, SyncEngine, normaliseServerUrl, type ServerBackup } from '$lib/sync/sync.svelte';
  import { toasts } from '$lib/ui/toast.svelte';
  import { relativeTime } from '$lib/ui/format';
  import { platform } from '$lib/platform';
  import { restore, type ParsedBackup } from '$lib/backup';
  import Icon from '$lib/ui/Icon.svelte';

  const sameOrigin = platform() === 'web' && typeof location !== 'undefined' && location.protocol.startsWith('http');
  let serverUrl = $state(sameOrigin ? location.origin + location.pathname.replace(/\/[^/]*$/, '') : '');
  let vault = $state('');
  let passphrase = $state('');
  let passphrase2 = $state('');
  let create = $state(false);
  let encrypted = $state(true);
  let signupSecret = $state('');
  let probe = $state<{ ok: boolean; version: string; signup: string } | null>(null);
  let probeError = $state('');
  let busy = $state(false);
  let backups = $state<ServerBackup[] | null>(null);

  async function check() {
    probe = null;
    probeError = '';
    if (!serverUrl.trim()) return;
    try {
      probe = await SyncEngine.probe(serverUrl);
    } catch (err) {
      probeError = (err as Error).message;
    }
  }
  $effect(() => {
    if (sameOrigin && !sync.config) check();
  });

  async function connect() {
    if (create && passphrase !== passphrase2) {
      toasts.error("The passphrases don't match");
      return;
    }
    if (passphrase.length < 8) {
      toasts.error('Use a passphrase of at least 8 characters (longer is better).');
      return;
    }
    busy = true;
    try {
      await sync.connect({ serverUrl, vault, passphrase, create, encrypted, signupSecret: signupSecret || undefined });
      passphrase = passphrase2 = '';
      toasts.show(create ? 'Vault created and synced' : 'Connected and synced', { tone: 'success' });
    } catch (err) {
      toasts.error((err as Error).message);
    } finally {
      busy = false;
    }
  }

  async function loadBackups() {
    try {
      backups = await sync.listBackups();
    } catch (err) {
      toasts.error((err as Error).message);
    }
  }
  async function snapshotNow() {
    try {
      await sync.createBackup();
      toasts.show('Server snapshot saved', { tone: 'success' });
      loadBackups();
    } catch (err) {
      toasts.error((err as Error).message);
    }
  }
  async function restoreFrom(b: ServerBackup) {
    if (!confirm(`Restore everything to the snapshot from ${b.date}? Changes made since then will be removed on all devices (a new snapshot of the current state is taken first).`)) return;
    try {
      await sync.createBackup();
      const documents = await sync.fetchBackup(b.name);
      const parsed: ParsedBackup = { documents, exportedAt: b.createdAt, counts: {} };
      await restore(parsed, 'replace');
      toasts.show('Restored', { tone: 'success' });
    } catch (err) {
      toasts.error((err as Error).message);
    }
  }
</script>

<div class="stack">
  {#if sync.config}
    <section class="card stack">
      <div class="row">
        <Icon name={sync.state === 'error' ? 'alert' : 'cloudCheck'} />
        <div class="grow">
          <strong>Connected to “{sync.config.vault}”</strong>
          <span class="faint small">{sync.config.serverUrl} · {sync.config.encrypted ? 'end-to-end encrypted' : 'not encrypted (readable on the server)'}</span>
        </div>
      </div>
      <dl class="facts">
        <dt>Last sync</dt><dd>{relativeTime(sync.lastSyncAt)}</dd>
        <dt>Waiting to upload</dt><dd>{repo.pending} change{repo.pending === 1 ? '' : 's'}</dd>
        <dt>Status</dt><dd class:status-bad={sync.state === 'error'}>{sync.lastError ?? (sync.online ? 'OK' : 'Offline')}</dd>
        <dt>This device</dt><dd class="num">{repo.deviceId}</dd>
      </dl>
      <div class="row wrap">
        <button class="btn primary" disabled={sync.busy} onclick={() => sync.syncNow().then(() => toasts.show('Synced', { tone: 'success' })).catch((e) => toasts.error(e.message))}>
          <Icon name="refresh" size={16} /> Sync now
        </button>
        <button class="btn danger" onclick={() => confirm('Stop syncing this device? Data stays on this device and on the server.') && sync.disconnect()}>Disconnect</button>
      </div>
      <p class="faint small">Every change is saved on this device first. If the server can't be reached the app keeps working and syncs later — the cloud icon shows when something hasn't been uploaded yet.</p>
    </section>

    <section class="card stack">
      <h2>Server backups</h2>
      <p class="muted small">The server keeps a snapshot each day something changed (by default 14 daily, 8 weekly and 24 monthly).</p>
      <div class="row wrap">
        <button class="btn small" onclick={loadBackups}><Icon name="database" size={16} /> Show snapshots</button>
        <button class="btn small" onclick={snapshotNow}><Icon name="plus" size={16} /> Snapshot now</button>
      </div>
      {#if backups}
        <div class="list">
          {#each backups as b (b.name)}
            <div class="row bk">
              <span class="grow"><strong>{b.date}</strong> <span class="faint small">{b.name.includes('manual') ? 'manual' : 'daily'} · {(b.size / 1024).toFixed(0)} KB</span></span>
              <button class="btn small" onclick={() => restoreFrom(b)}>Restore</button>
            </div>
          {:else}
            <p class="faint small">No snapshots yet.</p>
          {/each}
        </div>
      {/if}
    </section>
  {:else}
    <section class="card stack">
      <p class="muted">Sync keeps your phone, laptop and the web app in step through a small server you run yourself (e.g. on a Raspberry Pi reached over Tailscale). See <a href="https://github.com/LukaJakimovski/budgeting_tool/blob/main/docs/self-hosting.md" target="_blank" rel="noreferrer">self-hosting</a>.</p>
      <label class="field">
        <span class="label">Server address</span>
        <div class="row">
          <input class="input" bind:value={serverUrl} placeholder="https://pi.your-tailnet.ts.net" onchange={check} autocapitalize="off" autocorrect="off" spellcheck="false" />
          <button class="btn small" onclick={check}>Check</button>
        </div>
        {#if probe}<span class="hint status-good">✓ Tally server {probe.version} — new vaults: {probe.signup}</span>{/if}
        {#if probeError}<span class="error-text">{probeError}</span>{/if}
        {#if normaliseServerUrl(serverUrl).startsWith('http://') && !normaliseServerUrl(serverUrl).includes('localhost')}
          <span class="hint">Tip: use HTTPS (e.g. <code>tailscale serve</code>) so the web app can work offline and install as an app.</span>
        {/if}
      </label>
      <div class="segmented" role="group" aria-label="New or existing vault">
        <button aria-pressed={!create} onclick={() => (create = false)}>Join existing vault</button>
        <button aria-pressed={create} onclick={() => (create = true)}>Create new vault</button>
      </div>
      <label class="field">
        <span class="label">Vault name</span>
        <input class="input" bind:value={vault} placeholder="e.g. luka" autocapitalize="off" autocorrect="off" spellcheck="false" />
        <span class="hint">One vault per person or household. Lowercase letters, numbers, - and _.</span>
      </label>
      <label class="field">
        <span class="label">Passphrase</span>
        <input class="input" type="password" bind:value={passphrase} autocomplete={create ? 'new-password' : 'current-password'} />
        <span class="hint">Used on every device you connect. It can't be recovered — store it in your password manager.</span>
      </label>
      {#if create}
        <label class="field"><span class="label">Repeat passphrase</span><input class="input" type="password" bind:value={passphrase2} autocomplete="new-password" /></label>
        <label class="row"><input type="checkbox" bind:checked={encrypted} /> End-to-end encrypt (the server only stores scrambled data)</label>
        <span class="hint">{encrypted ? 'Most private. The server can still keep backups, but it can\'t read or export them for scripts.' : 'The server can read the data and keeps a plain JSON export (data/exports/) you can process with scripts. Fine on your own Tailscale network.'}</span>
        {#if probe?.signup === 'secret'}
          <label class="field"><span class="label">Server signup secret</span><input class="input" type="password" bind:value={signupSecret} /></label>
        {/if}
      {/if}
      <button class="btn primary" disabled={busy || !serverUrl || !vault || !passphrase} onclick={connect}>
        {busy ? 'Connecting…' : create ? 'Create vault & sync' : 'Connect & sync'}
      </button>
      {#if repo.list('transaction').length}
        <p class="faint small">The data already on this device will be merged into the vault.</p>
      {/if}
    </section>
  {/if}
</div>

<style>
  .grow {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .facts {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px var(--s4);
    margin: 0;
    font-size: 0.9rem;
  }
  .facts dt {
    color: var(--text-muted);
  }
  .facts dd {
    margin: 0;
  }
  .bk {
    padding: 6px 0;
    border-bottom: 1px solid var(--border);
  }
  code {
    font-size: 0.85em;
  }
</style>
