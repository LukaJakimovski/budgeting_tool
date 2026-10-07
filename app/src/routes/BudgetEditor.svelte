<script lang="ts">
  import { repo } from '$lib/db/repo.svelte';
  import { toasts } from '$lib/ui/toast.svelte';
  import Sheet from '$lib/ui/Sheet.svelte';
  import FilterEditor from '$lib/ui/FilterEditor.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import { parseAmount, toDecimalString } from '$lib/core/money';
  import { today } from '$lib/core/dates';
  import type { Budget, Filter, PeriodUnit } from '$lib/core/types';

  let { budget, onclose }: { budget: Budget | null; onclose: () => void } = $props();

  const base = repo.setting('baseCurrency');
  // svelte-ignore state_referenced_locally
  const b = budget;
  let name = $state(b?.name ?? '');
  let icon = $state(b?.icon ?? '');
  let amountText = $state(b ? toDecimalString(b.amount, base) : '');
  let unit = $state<PeriodUnit>(b?.period.unit ?? 'week');
  let count = $state(b?.period.count ?? 1);
  let anchor = $state(b?.period.anchor ?? today());
  let warnAt = $state(Math.round((b?.warnAt ?? 0.8) * 100));
  let filter = $state<Filter>(b?.filter ?? {});
  let attempted = $state(false);

  const amount = $derived(parseAmount(amountText, base));
  const valid = $derived(!!name.trim() && amount !== null && amount > 0);

  // Suggest a name from the first chosen category.
  $effect(() => {
    if (!name && filter.categoryIds?.length === 1) {
      const c = repo.get<{ name: string; icon: string } & Budget>(filter.categoryIds[0]);
      if (c) {
        name = c.name;
        if (!icon) icon = c.icon;
      }
    }
  });

  async function save() {
    attempted = true;
    if (!valid || amount === null) return;
    const fields = {
      name: name.trim(),
      icon: icon.trim(),
      amount,
      period: { unit, count: Math.max(1, Math.floor(count)), anchor },
      filter,
      warnAt: Math.min(1, Math.max(0.1, warnAt / 100)),
    };
    if (b) await repo.update<Budget>(b.id, fields);
    else await repo.create('budget', { ...fields, order: repo.list('budget').length, archived: false });
    toasts.show(b ? 'Budget updated' : 'Budget created', { tone: 'success' });
    onclose();
  }

  async function remove() {
    if (!b) return;
    await repo.remove(b.id);
    onclose();
    toasts.show('Budget deleted', { action: { label: 'Undo', run: () => repo.restore(b.id) } });
  }
</script>

<Sheet open={true} title={b ? 'Edit budget' : 'New budget'} {onclose}>
  <div class="stack">
    <div class="name-row">
      <label class="field icon-field"><span class="label">Icon</span><input class="input" bind:value={icon} maxlength="4" placeholder="🍩" /></label>
      <label class="field"><span class="label">Name</span><input class="input" bind:value={name} placeholder="e.g. Sweet treats" /></label>
    </div>
    {#if attempted && !name.trim()}<span class="error-text">Give it a name</span>{/if}

    <div class="field">
      <span class="label">Limit</span>
      <div class="row">
        <span class="muted">{base}</span>
        <input class="input" inputmode="decimal" bind:value={amountText} placeholder="0.00" aria-label="Limit amount" />
        <span class="muted nowrap">per</span>
        {#if count > 1}<input class="input count" type="number" min="1" max="52" bind:value={count} aria-label="Number of periods" />{/if}
        <select class="select" bind:value={unit} aria-label="Period">
          <option value="day">day{count > 1 ? 's' : ''}</option>
          <option value="week">week{count > 1 ? 's' : ''}</option>
          <option value="month">month{count > 1 ? 's' : ''}</option>
          <option value="year">year{count > 1 ? 's' : ''}</option>
        </select>
      </div>
      {#if attempted && (amount === null || amount <= 0)}<span class="error-text">Enter a limit</span>{/if}
      {#if count === 1}
        <button type="button" class="link small" onclick={() => (count = 2)}>Every few {unit}s instead (e.g. fortnightly)…</button>
      {:else}
        <label class="field"><span class="label">Periods start counting from</span><input class="input" type="date" bind:value={anchor} /></label>
      {/if}
      <span class="hint">Weeks start on {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][repo.setting('weekStart')]}; months on day {repo.setting('monthStartDay')} (Settings → General).</span>
    </div>

    <div class="field">
      <span class="label">What counts towards it</span>
      <span class="hint">Pick categories, tags, merchants… Leave empty to count all spending. Budgets can overlap (e.g. Food and Sweet treats).</span>
      <FilterEditor bind:value={filter} showKinds={false} showAmount={false} />
    </div>

    <label class="field">
      <span class="label">Warn me at {warnAt}%</span>
      <input type="range" min="10" max="100" step="5" bind:value={warnAt} />
    </label>
  </div>

  {#snippet footer()}
    {#if b}<button class="icon-btn" onclick={remove} aria-label="Delete budget"><Icon name="trash" /></button>{/if}
    <span class="spacer"></span>
    <button class="btn" onclick={onclose}>Cancel</button>
    <button class="btn primary" onclick={save}>Save</button>
  {/snippet}
</Sheet>

<style>
  .name-row {
    display: grid;
    grid-template-columns: 72px 1fr;
    gap: var(--s2);
  }
  .icon-field .input {
    text-align: center;
    font-size: 1.2rem;
  }
  .count {
    width: 70px;
  }
  .nowrap {
    white-space: nowrap;
  }
  .link {
    border: 0;
    background: transparent;
    color: var(--accent-text);
    padding: 4px 0;
    text-align: left;
    cursor: pointer;
  }
  input[type='range'] {
    accent-color: var(--accent);
  }
</style>
