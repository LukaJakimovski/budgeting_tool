<!-- First run: three quick choices, everything else has good defaults. -->
<script lang="ts">
  import Logo from '$lib/ui/Logo.svelte';
  import { repo } from '$lib/db/repo.svelte';
  import { ui } from '$lib/ui/ui.svelte';
  import { router } from '$lib/ui/router.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import { allStyles } from '$lib/theme/registry';
  import { resolveTokens } from '$lib/theme/generate';
  import { COMMON_CURRENCIES } from '$lib/core/money';

  let currency = $state(repo.setting('baseCurrency'));
  const appearance = $derived(repo.setting('appearance'));

  async function finish(next: 'add' | 'sync' | 'import' | 'home') {
    if (currency !== repo.setting('baseCurrency')) await repo.setSetting('baseCurrency', currency);
    await repo.setSetting('onboarded', true);
    if (next === 'add') ui.openEntry();
    if (next === 'sync') router.go('/settings/sync');
    if (next === 'import') router.go('/import');
  }
</script>

<div class="page onb">
  <div class="hero">
    <Logo size={64} />
    <h1>Welcome to Tally</h1>
    <p class="muted">Log a purchase in a few seconds, set budgets that keep you honest, and see where your money goes. Everything is stored on this device first.</p>
  </div>

  <section class="card stack">
    <label class="field">
      <span class="label">Your main currency</span>
      <select class="select" bind:value={currency}>
        {#each COMMON_CURRENCIES as c (c)}<option value={c}>{c}</option>{/each}
      </select>
      <span class="hint">You can still log purchases in other currencies (e.g. EUR when travelling).</span>
    </label>

    <div class="field">
      <span class="label">Pick a look</span>
      <div class="styles">
        {#each allStyles() as s (s.id)}
          {@const t = resolveTokens(s, 'light', null)}
          <button
            class="style"
            aria-pressed={appearance.styleId === s.id}
            onclick={() => repo.setSetting('appearance', { ...appearance, styleId: s.id, seed: null, mode: s.preferMode ?? 'auto' })}
            style:--sw-bg={t.bg}
            style:--sw-accent={t.accent}
            style:--sw-surface={t.surface}
            style:border-radius={`${Math.min(14, s.radius)}px`}
          >
            <span class="sw"><span></span></span>
            {s.name}
          </button>
        {/each}
      </div>
      <span class="hint">More colours, fonts and fine-tuning in Settings → Appearance.</span>
    </div>
  </section>

  <div class="choices">
    <button class="btn primary big" onclick={() => finish('add')}><Icon name="plus" /> Add my first purchase</button>
    <button class="btn" onclick={() => finish('sync')}><Icon name="cloud" /> Connect to my sync server</button>
    <button class="btn" onclick={() => finish('import')}><Icon name="upload" /> Import a bank CSV</button>
    <button class="btn ghost" onclick={() => finish('home')}>Skip for now</button>
  </div>
</div>

<style>
  .onb {
    max-width: 560px;
  }
  .hero {
    text-align: center;
    margin: var(--s5) 0;
  }
  .hero :global(.logo) {
    margin: 0 auto var(--s3);
  }
  .hero h1 {
    margin-bottom: var(--s2);
  }
  .styles {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--s2);
  }
  .style {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: var(--s2);
    border: 2px solid var(--border);
    background: var(--surface);
    cursor: pointer;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text);
  }
  .style[aria-pressed='true'] {
    border-color: var(--accent);
  }
  .sw {
    width: 100%;
    height: 34px;
    border-radius: 6px;
    background: var(--sw-bg);
    display: flex;
    align-items: flex-end;
    padding: 5px;
    border: 1px solid rgba(0, 0, 0, 0.08);
  }
  .sw span {
    width: 60%;
    height: 8px;
    border-radius: 4px;
    background: var(--sw-accent);
  }
  .choices {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
    margin-top: var(--s4);
  }
  .big {
    min-height: 52px;
    font-size: 1.05rem;
  }
</style>
