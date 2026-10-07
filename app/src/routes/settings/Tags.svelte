<script lang="ts">
  import { repo } from '$lib/db/repo.svelte';
  import { toasts } from '$lib/ui/toast.svelte';
  import { router } from '$lib/ui/router.svelte';
  import { findOrCreateTag } from '$lib/actions';
  import { filterToQuery } from '$lib/ui/filterQuery';
  import Sheet from '$lib/ui/Sheet.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import type { ID, Tag, Transaction } from '$lib/core/types';

  let editing = $state<Tag | null>(null);
  let newName = $state('');
  let mergeInto = $state<ID | ''>('');
  const counts = $derived.by(() => {
    const m = new Map<ID, number>();
    for (const t of repo.transactions()) for (const id of new Set([...t.tagIds, ...t.splits.flatMap((s) => s.tagIds)])) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  });

  async function add() {
    if (!newName.trim()) return;
    await findOrCreateTag(newName);
    newName = '';
  }

  function withoutTag(t: Transaction, id: ID, replacement: ID | null): Transaction {
    const swap = (ids: ID[]) => Array.from(new Set(ids.map((x) => (x === id ? replacement : x)).filter((x): x is ID => !!x)));
    return { ...t, tagIds: swap(t.tagIds), splits: t.splits.map((s) => ({ ...s, tagIds: swap(s.tagIds) })) };
  }

  async function removeOrMerge(target: ID | null) {
    if (!editing) return;
    const id = editing.id;
    const affected = repo.transactions().filter((t) => t.tagIds.includes(id) || t.splits.some((s) => s.tagIds.includes(id)));
    await repo.save([...affected.map((t) => withoutTag(t, id, target)), { ...editing, deleted: true }]);
    toasts.show(target ? `Merged (${affected.length} transactions)` : `Deleted #${editing.name}`);
    editing = null;
  }
</script>

<div class="stack">
  <div class="row">
    <input class="input" placeholder="New tag, e.g. work, sam, japan-trip" bind:value={newName} onkeydown={(e) => e.key === 'Enter' && add()} />
    <button class="btn" onclick={add}><Icon name="plus" size={16} /> Add</button>
  </div>
  <p class="faint small">Tags cut across categories: who it was for, which event or trip, work vs personal. Filter and budget by them anywhere.</p>
  <div class="chips">
    {#each repo.tags(true) as t (t.id)}
      <button class="chip" class:archived={t.archived} onclick={() => { editing = { ...t }; mergeInto = ''; }}>#{t.name} <span class="faint small">{counts.get(t.id) ?? 0}</span></button>
    {:else}
      <p class="muted small">No tags yet. You can also create them right in the purchase form.</p>
    {/each}
  </div>
</div>

{#if editing}
  <Sheet open={true} title={`#${editing.name}`} onclose={() => (editing = null)}>
    <div class="stack">
      <label class="field"><span class="label">Name</span><input class="input" bind:value={editing.name} /></label>
      <label class="row"><input type="checkbox" bind:checked={editing.archived} /> Archived (hidden from suggestions)</label>
      <button class="btn small" onclick={() => router.go('/history', { from: '1970-01-01', to: '9999-12-31', unit: 'all', f: filterToQuery({ tagIds: [editing!.id] }) })}><Icon name="list" size={16} /> {counts.get(editing.id) ?? 0} transactions</button>
      <div class="row">
        <select class="select" bind:value={mergeInto} aria-label="Merge into another tag">
          <option value="">Merge into…</option>
          {#each repo.tags().filter((t) => t.id !== editing?.id) as t (t.id)}<option value={t.id}>#{t.name}</option>{/each}
        </select>
        <button class="btn small" disabled={!mergeInto} onclick={() => removeOrMerge(mergeInto as ID)}>Merge</button>
      </div>
    </div>
    {#snippet footer()}
      <button class="icon-btn" aria-label="Delete tag" onclick={() => removeOrMerge(null)}><Icon name="trash" /></button>
      <span class="spacer"></span>
      <button class="btn" onclick={() => (editing = null)}>Cancel</button>
      <button class="btn primary" onclick={async () => { await repo.update<Tag>(editing!.id, { name: editing!.name.trim().replace(/^#/, ''), archived: editing!.archived }); editing = null; }}>Save</button>
    {/snippet}
  </Sheet>
{/if}

<style>
  .archived {
    opacity: 0.5;
  }
</style>
