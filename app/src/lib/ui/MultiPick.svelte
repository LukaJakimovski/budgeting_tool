<!-- Searchable multi-select list (categories, tags, merchants…). -->
<script lang="ts" module>
export interface PickItem {
  id: string;
  label: string;
  icon?: string;
  depth?: number;
  hint?: string;
}
</script>

<script lang="ts">
  import Icon from './Icon.svelte';


  let { items, value = $bindable(), placeholder = 'Search', max = 200 }: { items: PickItem[]; value: string[]; placeholder?: string; max?: number } = $props();
  let q = $state('');
  const shown = $derived(items.filter((i) => !q || i.label.toLowerCase().includes(q.toLowerCase())).slice(0, max));

  function toggle(id: string) {
    value = value.includes(id) ? value.filter((v) => v !== id) : [...value, id];
  }
</script>

<div class="mp">
  {#if items.length > 8}
    <input class="input" bind:value={q} {placeholder} aria-label={placeholder} />
  {/if}
  <div class="opts" role="listbox" aria-multiselectable="true">
    {#each shown as it (it.id)}
      <button
        type="button"
        role="option"
        aria-selected={value.includes(it.id)}
        class="opt"
        class:on={value.includes(it.id)}
        style:padding-left={`calc(10px + ${(it.depth ?? 0) * 20}px)`}
        onclick={() => toggle(it.id)}
      >
        <span class="box" aria-hidden="true">{#if value.includes(it.id)}<Icon name="check" size={14} stroke={3} />{/if}</span>
        {#if it.icon}<span aria-hidden="true">{it.icon}</span>{/if}
        <span class="lbl">{it.label}</span>
        {#if it.hint}<span class="spacer"></span><span class="faint tiny">{it.hint}</span>{/if}
      </button>
    {/each}
    {#if !shown.length}<p class="faint small" style="padding: 8px">Nothing here yet.</p>{/if}
  </div>
</div>

<style>
  .mp {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
  }
  .opts {
    max-height: 260px;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 4px;
  }
  .opt {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    border: 0;
    background: transparent;
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    text-align: left;
    color: var(--text);
  }
  .opt:hover {
    background: var(--surface2);
  }
  .box {
    width: 18px;
    height: 18px;
    border-radius: 5px;
    border: 2px solid var(--border);
    display: grid;
    place-items: center;
    flex-shrink: 0;
    color: var(--on-accent);
  }
  .on .box {
    background: var(--accent);
    border-color: var(--accent);
  }
  .lbl {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
