<script lang="ts">
  import { repo } from '$lib/db/repo.svelte';
  import { toasts } from '$lib/ui/toast.svelte';
  import { router } from '$lib/ui/router.svelte';
  import Sheet from '$lib/ui/Sheet.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import CategoryPicker from '$lib/ui/CategoryPicker.svelte';
  import { categoryLabel } from '$lib/ui/format';
  import { filterToQuery } from '$lib/ui/filterQuery';
  import type { Channel, ID, Merchant, Transaction } from '$lib/core/types';

  let q = $state('');
  let showArchived = $state(false);
  let editing = $state<Merchant | null>(null);
  let aliasText = $state('');
  let mergeInto = $state<ID | ''>('');

  const counts = $derived.by(() => {
    const m = new Map<ID, number>();
    for (const t of repo.transactions()) if (t.merchantId) m.set(t.merchantId, (m.get(t.merchantId) ?? 0) + 1);
    return m;
  });
  const list = $derived(
    repo
      .merchants(showArchived)
      .filter((m) => !q || m.name.toLowerCase().includes(q.toLowerCase()) || m.aliases.some((a) => a.includes(q.toLowerCase())))
      .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.name.localeCompare(b.name)),
  );

  function open(m: Merchant) {
    editing = structuredClone($state.snapshot(m)) as Merchant;
    aliasText = '';
    mergeInto = '';
  }

  async function save() {
    if (!editing || !editing.name.trim()) return;
    await repo.update<Merchant>(editing.id, { ...editing, name: editing.name.trim() });
    editing = null;
  }

  function addAlias() {
    const a = aliasText.trim().toLowerCase();
    if (editing && a.length >= 3 && !editing.aliases.includes(a)) editing.aliases = [...editing.aliases, a];
    aliasText = '';
  }

  async function merge() {
    if (!editing || !mergeInto) return;
    const target = repo.get<Merchant>(mergeInto);
    if (!target) return;
    const moved: Transaction[] = repo.transactions().filter((t) => t.merchantId === editing!.id).map((t) => ({ ...t, merchantId: target.id }));
    const aliases = Array.from(new Set([...target.aliases, ...editing.aliases, editing.name.toLowerCase()]));
    await repo.save([...moved, { ...target, aliases }, { ...editing, deleted: true }]);
    toasts.show(`Merged into ${target.name} (${moved.length} transactions)`, { tone: 'success' });
    editing = null;
  }

  async function remove() {
    if (!editing) return;
    const n = counts.get(editing.id) ?? 0;
    if (n) {
      await repo.update<Merchant>(editing.id, { archived: true });
      toasts.show(`${editing.name} is used by ${n} transactions, so it was archived instead.`);
    } else {
      const id = editing.id;
      await repo.remove(id);
      toasts.show('Merchant deleted', { action: { label: 'Undo', run: () => repo.restore(id) } });
    }
    editing = null;
  }
</script>

<div class="stack">
  <div class="row">
    <input class="input" placeholder="Search merchants" bind:value={q} aria-label="Search merchants" />
    <label class="row small nowrap"><input type="checkbox" bind:checked={showArchived} /> Archived</label>
  </div>
  <p class="faint small">Merchants are created automatically when you type a new name. Each remembers the category, payment method and more from your last purchase there.</p>
  <div class="card list">
    {#each list as m (m.id)}
      <button class="list-item" onclick={() => open(m)} class:archived={m.archived}>
        <Icon name="store" size={18} />
        <span class="grow">
          <strong>{m.name}</strong>
          <span class="faint small">{m.defaults.categoryId ? categoryLabel(m.defaults.categoryId) : 'No default category'}{m.aliases.length ? ` · ${m.aliases.length} bank alias${m.aliases.length > 1 ? 'es' : ''}` : ''}</span>
        </span>
        <span class="faint small num">{counts.get(m.id) ?? 0}</span>
      </button>
    {:else}
      <p class="empty small">No merchants yet.</p>
    {/each}
  </div>
</div>

{#if editing}
  <Sheet open={true} title={editing.name || 'Merchant'} onclose={() => (editing = null)}>
    <div class="stack">
      <label class="field"><span class="label">Name</span><input class="input" bind:value={editing.name} /></label>

      <h3 class="section-title">Defaults for new purchases</h3>
      <div class="field"><span class="label">Category</span><CategoryPicker bind:value={editing.defaults.categoryId} allowNone /></div>
      <label class="field">
        <span class="label">Payment method</span>
        <select class="select" bind:value={editing.defaults.paymentMethodId}>
          <option value={null}>—</option>
          {#each repo.paymentMethods() as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
        </select>
      </label>
      <label class="field">
        <span class="label">Where</span>
        <select class="select" bind:value={editing.defaults.channel}>
          <option value={null}>—</option>
          <option value={'in_person' as Channel}>In person</option>
          <option value={'online' as Channel}>Online</option>
        </select>
      </label>
      <label class="field"><span class="label">Item name</span><input class="input" bind:value={editing.defaults.name} placeholder="e.g. Coffee" /></label>
      <label class="row"><input type="checkbox" bind:checked={editing.learnDefaults} /> Update these from my latest purchase automatically</label>

      <h3 class="section-title">Bank statement names</h3>
      <p class="faint small">When importing a bank CSV, rows containing any of these are matched to {editing.name}.</p>
      <div class="chips">
        {#each editing.aliases as a (a)}
          <button class="chip selected" onclick={() => editing && (editing.aliases = editing.aliases.filter((x) => x !== a))}>{a} <Icon name="x" size={13} /></button>
        {/each}
        <input class="input alias" placeholder="e.g. tim hortons #" bind:value={aliasText} onkeydown={(e) => e.key === 'Enter' && addAlias()} />
      </div>

      <h3 class="section-title">More</h3>
      <div class="row wrap">
        <button class="btn small" onclick={() => router.go('/history', { range: 'all', unit: 'all', from: '1970-01-01', to: '9999-12-31', f: filterToQuery({ merchantIds: [editing!.id] }) })}><Icon name="list" size={16} /> Transactions</button>
        <label class="row"><input type="checkbox" bind:checked={editing.archived} /> Archived</label>
      </div>
      <div class="row">
        <select class="select" bind:value={mergeInto} aria-label="Merge into another merchant">
          <option value="">Merge into…</option>
          {#each repo.merchants().filter((m) => m.id !== editing?.id) as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
        </select>
        <button class="btn small" disabled={!mergeInto} onclick={merge}>Merge</button>
      </div>
    </div>
    {#snippet footer()}
      <button class="icon-btn" aria-label="Delete merchant" onclick={remove}><Icon name="trash" /></button>
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
  .grow {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .archived {
    opacity: 0.55;
  }
  .alias {
    width: 200px;
    min-height: 34px;
  }
  .nowrap {
    white-space: nowrap;
  }
</style>
