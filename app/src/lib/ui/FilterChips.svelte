<!-- Active filters as removable chips, plus a button that opens the editor. -->
<script lang="ts">
  import { repo } from '../db/repo.svelte';
  import Icon from './Icon.svelte';
  import Sheet from './Sheet.svelte';
  import FilterEditor from './FilterEditor.svelte';
  import { money } from './format';
  import type { Filter } from '../core/types';

  let { value = $bindable(), showKinds = true }: { value: Filter; showKinds?: boolean } = $props();
  let open = $state(false);
  let draft = $state<Filter>({});

  interface Chip {
    label: string;
    remove: () => void;
  }

  const chips = $derived.by(() => {
    const out: Chip[] = [];
    const drop = <K extends keyof Filter>(k: K, id: string) => () => (value = { ...value, [k]: ((value[k] as string[]) ?? []).filter((x) => x !== id) });
    for (const id of value.categoryIds ?? []) out.push({ label: `${(repo.get(id) as { icon?: string })?.icon ?? ''} ${(repo.get(id) as { name?: string })?.name ?? '?'}`, remove: drop('categoryIds', id) });
    for (const id of value.tagIds ?? []) out.push({ label: `#${(repo.get(id) as { name?: string })?.name ?? '?'}`, remove: drop('tagIds', id) });
    for (const id of value.merchantIds ?? []) out.push({ label: (repo.get(id) as { name?: string })?.name ?? '?', remove: drop('merchantIds', id) });
    for (const id of value.paymentMethodIds ?? []) out.push({ label: (repo.get(id) as { name?: string })?.name ?? '?', remove: drop('paymentMethodIds', id) });
    for (const c of value.channels ?? []) out.push({ label: c === 'online' ? 'Online' : 'In person', remove: drop('channels', c) });
    for (const k of value.kinds ?? []) out.push({ label: k[0].toUpperCase() + k.slice(1), remove: drop('kinds', k) });
    if (value.minAmount != null) out.push({ label: `≥ ${money(value.minAmount)}`, remove: () => (value = { ...value, minAmount: null }) });
    if (value.maxAmount != null) out.push({ label: `≤ ${money(value.maxAmount)}`, remove: () => (value = { ...value, maxAmount: null }) });
    return out;
  });
</script>

<div class="chips">
  <button
    type="button"
    class="chip"
    onclick={() => {
      draft = { ...value };
      open = true;
    }}
  >
    <Icon name="filter" size={15} /> Filter
  </button>
  {#each chips as c, i (i)}
    <button type="button" class="chip selected" onclick={c.remove} aria-label={`Remove filter ${c.label}`}>{c.label} <span class="x"><Icon name="x" size={13} /></span></button>
  {/each}
  {#if chips.length > 1}
    <button type="button" class="chip" onclick={() => (value = { text: value.text })}>Clear all</button>
  {/if}
</div>

<Sheet {open} title="Filter" onclose={() => (open = false)}>
  <FilterEditor bind:value={draft} {showKinds} />
  {#snippet footer()}
    <button type="button" class="btn ghost" onclick={() => (draft = { text: value.text })}>Reset</button>
    <span class="spacer"></span>
    <button
      type="button"
      class="btn primary"
      onclick={() => {
        value = { ...draft, text: value.text };
        open = false;
      }}>Apply</button
    >
  {/snippet}
</Sheet>
