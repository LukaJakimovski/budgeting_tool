<script lang="ts">
  import { router } from '$lib/ui/router.svelte';
  import { sync } from '$lib/sync/sync.svelte';
  import { lock } from '$lib/lock.svelte';
  import Icon, { type IconName } from '$lib/ui/Icon.svelte';
  import General from './settings/General.svelte';
  import Appearance from './settings/Appearance.svelte';
  import Categories from './settings/Categories.svelte';
  import Merchants from './settings/Merchants.svelte';
  import Tags from './settings/Tags.svelte';
  import PaymentMethods from './settings/PaymentMethods.svelte';
  import Recurring from './settings/Recurring.svelte';
  import SyncSettings from './settings/Sync.svelte';
  import Data from './settings/Data.svelte';
  import Security from './settings/Security.svelte';
  import Modules from './settings/Modules.svelte';
  import About from './settings/About.svelte';

  const SECTIONS: { id: string; label: string; icon: IconName; hint: () => string }[] = [
    { id: 'general', label: 'General', icon: 'sliders', hint: () => 'Currency, exchange rates, week start, date format' },
    { id: 'appearance', label: 'Appearance', icon: 'palette', hint: () => 'Style, colours, font, dark mode' },
    { id: 'categories', label: 'Categories', icon: 'folder', hint: () => 'Groups and subcategories' },
    { id: 'merchants', label: 'Merchants', icon: 'store', hint: () => 'Defaults, bank aliases, merge' },
    { id: 'tags', label: 'Tags', icon: 'tag', hint: () => 'Events, people, projects…' },
    { id: 'payment', label: 'Payment methods', icon: 'card', hint: () => 'Cards, cash, accounts' },
    { id: 'recurring', label: 'Recurring', icon: 'repeat', hint: () => 'Rent, subscriptions, salary' },
    { id: 'sync', label: 'Sync & devices', icon: 'cloud', hint: () => (sync.config ? `Connected to ${sync.config.vault}` : 'Not set up — data is only on this device') },
    { id: 'data', label: 'Backup, import & export', icon: 'database', hint: () => 'JSON, CSV, SQLite, bank statements' },
    { id: 'security', label: 'Security', icon: 'lock', hint: () => (lock.enabled ? 'PIN lock on' : 'PIN lock off') },
    { id: 'modules', label: 'Modules', icon: 'sparkles', hint: () => 'Optional extras' },
    { id: 'about', label: 'About & help', icon: 'info', hint: () => 'Version, docs, keyboard shortcuts' },
  ];

  const current = $derived(router.route.segments[1] ?? '');
  const meta = $derived(SECTIONS.find((s) => s.id === current));
</script>

<div class="page">
  {#if !meta}
    <div class="page-head"><h1>Settings</h1></div>
    <div class="card list">
      {#each SECTIONS as s (s.id)}
        <a class="list-item" href={`#/settings/${s.id}`}>
          <span class="ico"><Icon name={s.icon} /></span>
          <span class="txt"><strong>{s.label}</strong><span class="faint small">{s.hint()}</span></span>
          <Icon name="chevronRight" size={18} />
        </a>
      {/each}
    </div>
  {:else}
    <div class="page-head">
      <a class="icon-btn" href="#/settings" aria-label="Back to settings"><Icon name="chevronLeft" /></a>
      <h1>{meta.label}</h1>
    </div>
    {#if current === 'general'}<General />
    {:else if current === 'appearance'}<Appearance />
    {:else if current === 'categories'}<Categories />
    {:else if current === 'merchants'}<Merchants />
    {:else if current === 'tags'}<Tags />
    {:else if current === 'payment'}<PaymentMethods />
    {:else if current === 'recurring'}<Recurring />
    {:else if current === 'sync'}<SyncSettings />
    {:else if current === 'data'}<Data />
    {:else if current === 'security'}<Security />
    {:else if current === 'modules'}<Modules />
    {:else if current === 'about'}<About />
    {/if}
  {/if}
</div>

<style>
  .list {
    padding: var(--s1);
  }
  .list-item {
    text-decoration: none;
  }
  .ico {
    width: 38px;
    height: 38px;
    border-radius: var(--radius);
    background: var(--accent-soft);
    color: var(--accent-text);
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }
  .txt {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
</style>
