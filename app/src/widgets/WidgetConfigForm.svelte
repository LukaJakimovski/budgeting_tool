<!-- Renders the settings form for any widget from its declared fields. -->
<script lang="ts">
  import { repo } from '$lib/db/repo.svelte';
  import MultiPick from '$lib/ui/MultiPick.svelte';
  import FilterEditor from '$lib/ui/FilterEditor.svelte';
  import { merchantItems } from '$lib/ui/pickers';
  import { RANGE_PRESET_LABELS, type RangePreset } from '$lib/core/dates';
  import type { ConfigField, WidgetConfig } from './registry';
  import type { Filter } from '$lib/core/types';

  let { fields, value = $bindable() }: { fields: ConfigField[]; value: WidgetConfig } = $props();

  function set(key: string, v: unknown) {
    value = { ...value, [key]: v };
  }
  const budgetItems = $derived(repo.list('budget').filter((b) => !b.archived).map((b) => ({ id: b.id, label: b.name, icon: b.icon })));
</script>

<div class="stack">
  {#each fields as f (f.key)}
    <div class="field">
      <span class="label">{f.label}</span>
      {#if f.kind === 'range'}
        <div class="chips">
          {#each (f.presets ?? Object.keys(RANGE_PRESET_LABELS)) as p (p)}
            <button type="button" class="chip" aria-pressed={value[f.key] === p} onclick={() => set(f.key, p)}>{RANGE_PRESET_LABELS[p as RangePreset]}</button>
          {/each}
        </div>
      {:else if f.kind === 'number'}
        <input class="input" type="number" min={f.min} max={f.max} value={value[f.key] as number} oninput={(e) => set(f.key, Math.min(f.max, Math.max(f.min, Number((e.target as HTMLInputElement).value) || f.min)))} />
      {:else if f.kind === 'select'}
        <select class="select" value={value[f.key] as string} onchange={(e) => set(f.key, (e.target as HTMLSelectElement).value)}>
          {#each f.options as [v, l] (v)}<option value={v}>{l}</option>{/each}
        </select>
      {:else if f.kind === 'text'}
        <input class="input" value={(value[f.key] as string) ?? ''} placeholder={f.placeholder} oninput={(e) => set(f.key, (e.target as HTMLInputElement).value)} />
      {:else if f.kind === 'budgets'}
        <MultiPick items={budgetItems} bind:value={() => (value[f.key] as string[]) ?? [], (v) => set(f.key, v)} />
      {:else if f.kind === 'merchants'}
        <MultiPick items={merchantItems()} bind:value={() => (value[f.key] as string[]) ?? [], (v) => set(f.key, v)} placeholder="Search merchants" />
      {:else if f.kind === 'filter'}
        <FilterEditor bind:value={() => (value[f.key] as Filter) ?? {}, (v) => set(f.key, v)} showAmount={false} />
      {/if}
    </div>
  {/each}
</div>
