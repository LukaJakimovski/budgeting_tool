<script lang="ts">
  import Logo from '$lib/ui/Logo.svelte';
  import { repo } from '$lib/db/repo.svelte';
  import { sync } from '$lib/sync/sync.svelte';
  import { lock } from '$lib/lock.svelte';
  import { router } from '$lib/ui/router.svelte';
  import { ui } from '$lib/ui/ui.svelte';
  import { toasts } from '$lib/ui/toast.svelte';
  import { applyAppearance } from '$lib/theme/apply';
  import { syncModules } from '$lib/modules/registry';
  import { relativeTime } from '$lib/ui/format';
  import Icon, { type IconName } from '$lib/ui/Icon.svelte';
  import Home from './routes/Home.svelte';
  import History from './routes/History.svelte';
  import TxEditor from './routes/TxEditor.svelte';
  import LockScreen from './routes/LockScreen.svelte';
  import Onboarding from './routes/Onboarding.svelte';

  // Less-used screens load on first visit, keeping start-up small on slow phones.
  // (The service worker / native app bundle still has them offline.)
  const lazy = {
    stats: () => import('./routes/Stats.svelte'),
    budgets: () => import('./routes/Budgets.svelte'),
    settings: () => import('./routes/Settings.svelte'),
    import: () => import('./routes/Import.svelte'),
  };

  // Re-apply the theme and modules whenever their (synced) settings change.
  $effect(() => applyAppearance(repo.setting('appearance')));
  $effect(() => syncModules(repo.setting('modules')));

  const path = $derived(router.route.path);
  const section = $derived(router.route.segments[0] ?? '');

  // "New purchase" shortcut from the installed app's launcher menu.
  $effect(() => {
    if (router.route.query.get('new') === '1') {
      ui.openEntry();
      router.replaceQuery({ new: undefined });
    }
  });

  const NAV: { path: string; label: string; icon: IconName }[] = [
    { path: '/', label: 'Home', icon: 'home' },
    { path: '/history', label: 'History', icon: 'list' },
    { path: '/budgets', label: 'Budgets', icon: 'target' },
    { path: '/stats', label: 'Stats', icon: 'chart' },
  ];

  const syncInfo = $derived.by(() => {
    switch (sync.state) {
      case 'off':
        return { icon: 'cloudOff' as const, label: 'Local only — sync not set up', tone: 'muted' };
      case 'synced':
        return { icon: 'cloudCheck' as const, label: `Synced ${relativeTime(sync.lastSyncAt)}`, tone: 'good' };
      case 'syncing':
        return { icon: 'refresh' as const, label: 'Syncing…', tone: 'muted' };
      case 'pending':
        return { icon: 'cloud' as const, label: `${repo.pending} change${repo.pending === 1 ? '' : 's'} waiting to sync`, tone: 'warn' };
      case 'offline':
        return { icon: 'cloudOff' as const, label: `Offline — ${repo.pending} change${repo.pending === 1 ? '' : 's'} saved on this device`, tone: repo.pending ? 'warn' : 'muted' };
      case 'error':
        return { icon: 'alert' as const, label: `Sync problem: ${sync.lastError}`, tone: 'bad' };
    }
  });

  function key(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, [contenteditable], dialog')) return;
    if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey && !ui.entry) {
      e.preventDefault();
      ui.openEntry();
    }
  }

  function isActive(p: string) {
    return p === '/' ? path === '/' : path.startsWith(p);
  }
</script>

<svelte:window onkeydown={key} />

{#if lock.locked}
  <LockScreen />
{:else}
  <div class="shell">
    <aside class="rail" aria-label="Main">
      <a class="brand" href="#/"><Logo size={28} /> Tally</a>
      <button class="btn primary new" onclick={() => ui.openEntry()}><Icon name="plus" size={18} /> New <kbd>N</kbd></button>
      <nav>
        {#each NAV as n (n.path)}
          <a href={'#' + n.path} class="nav-link" aria-current={isActive(n.path) ? 'page' : undefined}><Icon name={n.icon} /> {n.label}</a>
        {/each}
        <a href="#/settings" class="nav-link" aria-current={isActive('/settings') ? 'page' : undefined}><Icon name="settings" /> Settings</a>
      </nav>
      <span class="spacer"></span>
      <a href="#/settings/sync" class="sync-pill {syncInfo.tone}" title={syncInfo.label}><Icon name={syncInfo.icon} size={16} /> <span>{syncInfo.label}</span></a>
    </aside>

    <header class="topbar">
      <a class="brand" href="#/"><Logo size={24} /> Tally</a>
      <span class="spacer"></span>
      <a href="#/settings/sync" class="icon-btn sync-icon {syncInfo.tone}" aria-label={syncInfo.label} title={syncInfo.label}>
        <Icon name={syncInfo.icon} />
        {#if repo.pending > 0 && sync.state !== 'off'}<span class="dot" aria-hidden="true"></span>{/if}
      </a>
      <a href="#/settings" class="icon-btn" aria-label="Settings"><Icon name="settings" /></a>
    </header>

    {#if ui.updateReady}
      <div class="update" role="status">
        A new version of Tally is ready.
        <button
          class="btn small primary"
          onclick={async () => {
            ui.updateRequested = true;
            const reg = await navigator.serviceWorker.getRegistration();
            reg?.waiting?.postMessage('skip-waiting');
          }}>Reload</button
        >
      </div>
    {/if}
    {#if repo.storageError}
      <div class="update bad" role="alert"><Icon name="alert" /> {repo.storageError}</div>
    {/if}

    <main id="main">
      {#key section}
        {#if path === '/'}
          {#if !repo.setting('onboarded') && repo.list('transaction').length === 0}
            <Onboarding />
          {:else}
            <Home />
          {/if}
        {:else if section === 'history'}
          <History />
        {:else if section in lazy}
          {#await lazy[section as keyof typeof lazy]() then m}
            <m.default />
          {:catch err}
            <div class="page empty"><p>Couldn't load this screen: {err.message}</p><button class="btn" onclick={() => location.reload()}>Reload</button></div>
          {/await}
        {:else}
          <div class="page empty"><h1>Not found</h1><a href="#/">Go home</a></div>
        {/if}
      {/key}
    </main>

    <nav class="tabbar" aria-label="Main">
      {#each NAV.slice(0, 2) as n (n.path)}
        <a href={'#' + n.path} aria-current={isActive(n.path) ? 'page' : undefined}><Icon name={n.icon} /><span>{n.label}</span></a>
      {/each}
      <button class="fab" onclick={() => ui.openEntry()} aria-label="New purchase"><Icon name="plus" size={28} stroke={2.5} /></button>
      {#each NAV.slice(2) as n (n.path)}
        <a href={'#' + n.path} aria-current={isActive(n.path) ? 'page' : undefined}><Icon name={n.icon} /><span>{n.label}</span></a>
      {/each}
    </nav>
  </div>

  {#if ui.entry}
    {#key ui.entry}
      <TxEditor request={ui.entry} />
    {/key}
  {/if}
{/if}

<div class="toasts" aria-live="polite">
  {#each toasts.items as t (t.id)}
    <div class="toast {t.tone}" role={t.tone === 'error' ? 'alert' : 'status'}>
      <div class="toast-body">
        <strong>{t.message}</strong>
        {#each t.detail ?? [] as d, i (i)}
          <span class="small detail {d.tone}">{d.text}</span>
        {/each}
      </div>
      {#if t.action}
        <button
          class="btn small"
          onclick={() => {
            t.action?.run();
            toasts.dismiss(t.id);
          }}>{t.action.label}</button
        >
      {/if}
      <button class="icon-btn close" aria-label="Dismiss" onclick={() => toasts.dismiss(t.id)}><Icon name="x" size={16} /></button>
    </div>
  {/each}
</div>

<style>
  .shell {
    min-height: 100dvh;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 700;
    font-family: var(--font-heading);
    font-size: 1.1rem;
    color: var(--text);
    text-decoration: none;
  }
  .topbar {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 4px;
    height: calc(var(--header-h) + env(safe-area-inset-top));
    padding: env(safe-area-inset-top) var(--s3) 0 var(--s4);
    background: color-mix(in srgb, var(--bg) 88%, transparent);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
  }
  .sync-icon {
    position: relative;
  }
  .sync-icon.good {
    color: var(--good);
  }
  .sync-icon.warn {
    color: color-mix(in srgb, var(--warn) 75%, var(--text));
  }
  .sync-icon.bad {
    color: var(--bad);
  }
  .dot {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--warn);
    box-shadow: 0 0 0 2px var(--bg);
  }
  .rail {
    display: none;
  }
  .tabbar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 15;
    display: grid;
    grid-template-columns: 1fr 1fr 76px 1fr 1fr;
    align-items: center;
    height: calc(var(--nav-h) + env(safe-area-inset-bottom));
    padding-bottom: env(safe-area-inset-bottom);
    background: var(--surface);
    border-top: 1px solid var(--border);
  }
  .tabbar a {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--text-faint);
    text-decoration: none;
    padding: 6px 0;
  }
  .tabbar a[aria-current='page'] {
    color: var(--accent-text);
  }
  .fab {
    justify-self: center;
    width: 58px;
    height: 58px;
    margin-top: -26px;
    border-radius: 50%;
    border: 4px solid var(--bg);
    background: var(--accent);
    color: var(--on-accent);
    display: grid;
    place-items: center;
    cursor: pointer;
    box-shadow: 0 6px 18px color-mix(in srgb, var(--accent) 35%, transparent);
    transition: transform 0.12s var(--ease);
  }
  .fab:active {
    transform: scale(0.94);
  }
  .update {
    display: flex;
    align-items: center;
    gap: var(--s3);
    justify-content: center;
    padding: var(--s2) var(--s4);
    background: var(--accent-soft);
    font-size: 0.9rem;
  }
  .update.bad {
    background: color-mix(in srgb, var(--bad) 15%, var(--surface));
  }
  .toasts {
    position: fixed;
    left: 50%;
    transform: translateX(-50%);
    bottom: calc(var(--nav-h) + env(safe-area-inset-bottom) + 12px);
    z-index: 50;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: min(480px, calc(100vw - 24px));
    pointer-events: none;
  }
  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: var(--s2);
    padding: var(--s3) var(--s2) var(--s3) var(--s4);
    background: var(--text);
    color: var(--bg);
    border-radius: var(--radius-lg);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
    animation: toast-in 0.2s var(--ease);
  }
  .toast.error {
    background: var(--bad);
    color: #fff;
  }
  .toast-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .toast .btn {
    background: transparent;
    color: inherit;
    border-color: color-mix(in srgb, currentColor 40%, transparent);
  }
  .toast .close {
    color: inherit;
    opacity: 0.7;
    width: 32px;
    height: 32px;
  }
  .detail {
    opacity: 0.92;
  }
  @keyframes toast-in {
    from {
      transform: translateY(12px);
      opacity: 0;
    }
  }

  @media (min-width: 960px) {
    .shell {
      display: grid;
      grid-template-columns: 232px 1fr;
    }
    .topbar,
    .tabbar {
      display: none;
    }
    .rail {
      display: flex;
      flex-direction: column;
      gap: var(--s3);
      position: sticky;
      top: 0;
      height: 100dvh;
      padding: var(--s4) var(--s3);
      border-right: 1px solid var(--border);
      background: var(--surface);
    }
    .rail .brand {
      padding: var(--s1) var(--s2) var(--s2);
    }
    .new {
      justify-content: flex-start;
    }
    kbd {
      margin-left: auto;
      font-size: 0.7rem;
      opacity: 0.75;
      border: 1px solid currentColor;
      border-radius: 4px;
      padding: 0 5px;
      font-family: inherit;
    }
    nav {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .nav-link {
      display: flex;
      align-items: center;
      gap: var(--s3);
      padding: 9px var(--s3);
      border-radius: var(--radius);
      color: var(--text-muted);
      text-decoration: none;
      font-weight: 550;
    }
    .nav-link:hover {
      background: var(--surface2);
      color: var(--text);
    }
    .nav-link[aria-current='page'] {
      background: var(--accent-soft);
      color: var(--accent-text);
    }
    .sync-pill {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.78rem;
      color: var(--text-muted);
      text-decoration: none;
      padding: var(--s2) var(--s3);
      border-radius: var(--radius);
      background: var(--surface2);
    }
    .sync-pill span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .sync-pill.good :global(svg) {
      color: var(--good);
    }
    .sync-pill.warn :global(svg) {
      color: color-mix(in srgb, var(--warn) 75%, var(--text));
    }
    .sync-pill.bad {
      color: var(--bad);
    }
    .toasts {
      bottom: 24px;
    }
  }
</style>
