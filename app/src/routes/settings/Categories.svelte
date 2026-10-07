<script lang="ts">
  import { repo } from '$lib/db/repo.svelte';
  import { toasts } from '$lib/ui/toast.svelte';
  import Sheet from '$lib/ui/Sheet.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import { CATEGORICAL, slotColor } from '$lib/theme/chart';
  import { resolvedMode } from '$lib/theme/apply';
  import type { Category, ID, Transaction } from '$lib/core/types';

  let editing = $state<Partial<Category> | null>(null);
  let moveTo = $state<ID | ''>('');
  const mode = $derived(resolvedMode(repo.setting('appearance')));
  const all = $derived(repo.categories(true));
  const usage = $derived.by(() => {
    const m = new Map<ID, number>();
    for (const t of repo.transactions()) {
      const ids = t.splits.length ? t.splits.map((s) => s.categoryId) : [t.categoryId];
      for (const id of ids) if (id) m.set(id, (m.get(id) ?? 0) + 1);
    }
    return m;
  });

  function tree(kind: 'expense' | 'income') {
    const out: { c: Category; depth: number }[] = [];
    for (const r of all.filter((c) => c.kind === kind && !c.parentId)) {
      out.push({ c: r, depth: 0 });
      for (const k of all.filter((c) => c.parentId === r.id)) out.push({ c: k, depth: 1 });
    }
    return out;
  }

  function open(c: Partial<Category>) {
    editing = { ...c };
    moveTo = '';
  }

  async function save() {
    if (!editing?.name?.trim()) return;
    const fields = {
      name: editing.name.trim(),
      icon: editing.icon ?? '',
      parentId: editing.parentId ?? null,
      kind: editing.kind ?? 'expense',
      color: editing.parentId ? '' : (editing.color ?? `slot:${all.filter((c) => !c.parentId).length % 8}`),
      archived: editing.archived ?? false,
    };
    if (editing.id) await repo.update<Category>(editing.id, fields);
    else await repo.create('category', { ...fields, order: all.length });
    editing = null;
  }

  async function move(c: Category, dir: -1 | 1) {
    const siblings = all.filter((x) => x.parentId === c.parentId && x.kind === c.kind);
    const i = siblings.findIndex((x) => x.id === c.id);
    const j = i + dir;
    if (j < 0 || j >= siblings.length) return;
    [siblings[i], siblings[j]] = [siblings[j], siblings[i]];
    const orders = siblings.map((s) => s.order).sort((a, b) => a - b);
    await repo.save(siblings.map((s, k) => ({ ...s, order: orders[k] })));
  }

  async function remove() {
    const c = editing as Category;
    const kids = all.filter((x) => x.parentId === c.id);
    const used = usage.get(c.id) ?? 0;
    if (used && !moveTo) {
      toasts.error('Choose where its transactions should go first.');
      return;
    }
    const changed: Transaction[] = [];
    if (used) {
      for (const t of repo.transactions()) {
        let touched = false;
        const next = { ...t, splits: t.splits.map((s) => (s.categoryId === c.id ? ((touched = true), { ...s, categoryId: moveTo as ID }) : s)) };
        if (next.categoryId === c.id) {
          next.categoryId = moveTo as ID;
          touched = true;
        }
        if (touched) changed.push(next);
      }
    }
    await repo.save([...changed, ...kids.map((k) => ({ ...k, parentId: c.parentId })), { ...c, deleted: true }]);
    toasts.show(`Deleted ${c.name}${used ? ` — ${used} transactions moved` : ''}`);
    editing = null;
  }
</script>

<div class="stack">
  {#each [['expense', 'Spending'], ['income', 'Income']] as [kind, label] (kind)}
    <h2 class="section-title">{label}</h2>
    <div class="card list">
      {#each tree(kind as 'expense' | 'income') as { c, depth } (c.id)}
        <div class="row item" class:archived={c.archived} style:padding-left={`${8 + depth * 28}px`}>
          {#if depth === 0}<span class="sw" style:background={slotColor(c.color, 0, mode)}></span>{/if}
          <button class="name" onclick={() => open(c)}>
            <span aria-hidden="true">{c.icon || '•'}</span> {c.name}
            {#if c.archived}<span class="badge">archived</span>{/if}
          </button>
          <span class="faint small num">{usage.get(c.id) ?? 0}</span>
          <button class="icon-btn" aria-label={`Move ${c.name} up`} onclick={() => move(c, -1)}><Icon name="chevronUp" size={16} /></button>
          <button class="icon-btn" aria-label={`Move ${c.name} down`} onclick={() => move(c, 1)}><Icon name="chevronDown" size={16} /></button>
        </div>
      {/each}
    </div>
    <button class="btn small" onclick={() => open({ kind: kind as 'expense' | 'income', parentId: null, icon: '' })}><Icon name="plus" size={16} /> Add {kind === 'income' ? 'income ' : ''}category</button>
  {/each}
</div>

{#if editing}
  <Sheet open={true} title={editing.id ? 'Edit category' : 'New category'} onclose={() => (editing = null)}>
    <div class="stack">
      <div class="name-row">
        <label class="field"><span class="label">Icon</span><input class="input icon" bind:value={editing.icon} maxlength="4" placeholder="🍩" /></label>
        <label class="field"><span class="label">Name</span><input class="input" bind:value={editing.name} /></label>
      </div>
      <label class="field">
        <span class="label">Inside</span>
        <select class="select" bind:value={editing.parentId}>
          <option value={null}>— Top level —</option>
          {#each all.filter((c) => !c.parentId && c.id !== editing?.id && c.kind === (editing?.kind ?? 'expense')) as r (r.id)}
            <option value={r.id}>{r.icon} {r.name}</option>
          {/each}
        </select>
      </label>
      {#if !editing.parentId}
        <div class="field">
          <span class="label">Chart colour</span>
          <div class="row wrap">
            {#each CATEGORICAL[mode] as col, i (i)}
              <button class="cs" style:background={col} aria-label={`Colour ${i + 1}`} aria-pressed={editing.color === `slot:${i}`} onclick={() => editing && (editing.color = `slot:${i}`)}></button>
            {/each}
          </div>
        </div>
      {/if}
      {#if editing.id}
        <label class="row"><input type="checkbox" bind:checked={editing.archived} /> Archived (hidden from pickers, kept in history)</label>
        <div class="danger stack">
          <span class="label">Delete</span>
          {#if usage.get(editing.id)}
            <select class="select" bind:value={moveTo}>
              <option value="">Move its {usage.get(editing.id)} transactions to…</option>
              {#each all.filter((c) => c.id !== editing?.id && c.kind === editing?.kind) as c (c.id)}<option value={c.id}>{c.icon} {c.name}</option>{/each}
            </select>
          {/if}
          <button class="btn danger small" onclick={remove}><Icon name="trash" size={16} /> Delete category</button>
        </div>
      {/if}
    </div>
    {#snippet footer()}
      <span class="spacer"></span>
      <button class="btn" onclick={() => (editing = null)}>Cancel</button>
      <button class="btn primary" onclick={save}>Save</button>
    {/snippet}
  </Sheet>
{/if}

<style>
  .list {
    padding: var(--s1);
  }
  .item {
    min-height: 44px;
    border-radius: var(--radius);
  }
  .item:hover {
    background: var(--surface2);
  }
  .archived {
    opacity: 0.55;
  }
  .sw {
    width: 10px;
    height: 10px;
    border-radius: 3px;
    flex-shrink: 0;
  }
  .name {
    flex: 1;
    border: 0;
    background: transparent;
    text-align: left;
    padding: 8px 4px;
    cursor: pointer;
    color: var(--text);
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .name-row {
    display: grid;
    grid-template-columns: 72px 1fr;
    gap: var(--s2);
  }
  .icon {
    text-align: center;
    font-size: 1.2rem;
  }
  .cs {
    width: 30px;
    height: 30px;
    border-radius: 8px;
    border: 3px solid var(--surface);
    box-shadow: 0 0 0 1px var(--border);
    cursor: pointer;
  }
  .cs[aria-pressed='true'] {
    box-shadow: 0 0 0 2px var(--text);
  }
  .danger {
    border-top: 1px solid var(--border);
    padding-top: var(--s3);
  }
</style>
