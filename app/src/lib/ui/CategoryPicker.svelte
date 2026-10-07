<!-- Category chooser: frequent chips first, full searchable tree on demand. -->
<script lang="ts">
  import { repo } from '../db/repo.svelte';
  import { frequentCategories } from '../actions';
  import Icon from './Icon.svelte';
  import type { Category, ID } from '../core/types';

  let {
    value = $bindable(),
    kind = 'expense',
    quick = 8,
    allowNone = false,
    onpick,
  }: { value: ID | null; kind?: 'expense' | 'income'; quick?: number; allowNone?: boolean; onpick?: (id: ID | null) => void } = $props();

  let expanded = $state(false);
  let search = $state('');

  const cats = $derived(repo.categories().filter((c) => c.kind === kind));
  const quickIds = $derived.by(() => {
    const freq = frequentCategories(30).filter((id) => cats.some((c) => c.id === id));
    // Fill with leaf-ish defaults when there's little history yet.
    for (const c of cats) if (freq.length < quick && !freq.includes(c.id) && (c.parentId || !cats.some((x) => x.parentId === c.id))) freq.push(c.id);
    const ids = freq.slice(0, quick);
    if (value && !ids.includes(value)) ids.unshift(value);
    return ids;
  });

  const tree = $derived.by(() => {
    const q = search.trim().toLowerCase();
    const roots = cats.filter((c) => !c.parentId);
    const out: { cat: Category; depth: number }[] = [];
    for (const r of roots) {
      const kids = cats.filter((c) => c.parentId === r.id);
      const rootMatch = !q || r.name.toLowerCase().includes(q);
      const kidMatches = kids.filter((k) => !q || k.name.toLowerCase().includes(q) || rootMatch);
      if (rootMatch || kidMatches.length) {
        out.push({ cat: r, depth: 0 });
        for (const k of kidMatches) out.push({ cat: k, depth: 1 });
      }
    }
    return out;
  });

  function pick(id: ID | null) {
    value = id;
    onpick?.(id);
    expanded = false;
    search = '';
  }
</script>

<div class="chips" role="group" aria-label="Category">
  {#if allowNone}
    <button type="button" class="chip" aria-pressed={value === null} onclick={() => pick(null)}>None</button>
  {/if}
  {#each quickIds as id (id)}
    {@const c = repo.get<Category>(id)}
    {#if c}
      <button type="button" class="chip" aria-pressed={value === id} onclick={() => pick(id)}>
        <span aria-hidden="true">{c.icon || '•'}</span>{c.name}
      </button>
    {/if}
  {/each}
  <button type="button" class="chip" aria-expanded={expanded} onclick={() => (expanded = !expanded)}>
    <Icon name={expanded ? 'chevronUp' : 'chevronDown'} size={16} /> All
  </button>
</div>

{#if expanded}
  <div class="tree">
    <input class="input" placeholder="Search categories" bind:value={search} aria-label="Search categories" />
    <div class="list" role="listbox" aria-label="All categories">
      {#each tree as { cat, depth } (cat.id)}
        <button
          type="button"
          role="option"
          aria-selected={value === cat.id}
          class="list-item"
          class:sel={value === cat.id}
          style:padding-left={`calc(var(--s2) + ${depth * 24}px)`}
          onclick={() => pick(cat.id)}
        >
          <span aria-hidden="true">{cat.icon || '•'}</span>
          <span class:muted={depth === 0 && !!search}>{cat.name}</span>
          {#if value === cat.id}<span class="spacer"></span><Icon name="check" size={16} />{/if}
        </button>
      {/each}
      {#if tree.length === 0}<p class="muted small">No match. Add categories in Settings → Categories.</p>{/if}
    </div>
  </div>
{/if}

<style>
  .tree {
    margin-top: var(--s2);
    display: flex;
    flex-direction: column;
    gap: var(--s2);
    max-height: 320px;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: var(--s2);
  }
  .sel {
    color: var(--accent-text);
    font-weight: 600;
  }
  .list-item {
    padding-top: 8px;
    padding-bottom: 8px;
  }
</style>
