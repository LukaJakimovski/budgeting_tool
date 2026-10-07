<script lang="ts">
  import { repo } from '$lib/db/repo.svelte';
  import { toasts } from '$lib/ui/toast.svelte';
  import { router } from '$lib/ui/router.svelte';
  import Sheet from '$lib/ui/Sheet.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import CategoryPicker from '$lib/ui/CategoryPicker.svelte';
  import { categoryLabel } from '$lib/ui/format';
  import { filterToQuery } from '$lib/ui/filterQuery';
  import SelectionBar from '$lib/ui/SelectionBar.svelte';
  import { deleteMerchants, mergeMerchantGroups, mergeMerchants, suggestMerchantCleanup, type MerchantGroup } from '$lib/bulk';
  import { cleanDescriptor, looksLikeBankText } from '$lib/core/banktext';
  import { SvelteSet } from 'svelte/reactivity';
  import type { Channel, ID, Merchant } from '$lib/core/types';

  let q = $state('');
  let showArchived = $state(false);
  let editing = $state<Merchant | null>(null);
  let aliasText = $state('');
  let mergeInto = $state<ID | ''>('');
  let selecting = $state(false);
  const selected = new SvelteSet<ID>();
  let mergeOpen = $state(false);
  let mergeName = $state('');
  let tidy = $state<{ group: MerchantGroup; on: boolean; name: string }[] | null>(null);

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

  const chosen = $derived(list.filter((m) => selected.has(m.id)));
  const suggestions = $derived(suggestMerchantCleanup());
  const chosenTx = $derived(chosen.reduce((n, m) => n + (counts.get(m.id) ?? 0), 0));
  /** Name choices when merging the selection: each name as a person would write it, busiest first. */
  const mergeChoices = $derived(Array.from(new Set(chosen.map((m) => (looksLikeBankText(m.name) ? cleanDescriptor(m.name) : m.name)))));

  if (router.route.query.get('tidy')) openTidy();

  function openTidy() {
    tidy = suggestMerchantCleanup().map((group) => ({ group, on: true, name: group.name }));
  }

  function toggle(m: Merchant) {
    if (selected.has(m.id)) selected.delete(m.id);
    else selected.add(m.id);
  }

  function stopSelecting() {
    selecting = false;
    selected.clear();
  }

  function undoToast(message: string, undo: () => Promise<void>) {
    toasts.show(message, { tone: 'success', timeout: 8000, action: { label: 'Undo', run: undo } });
  }

  async function mergeSelected() {
    if (!mergeName.trim() || chosen.length < 1) return;
    const n = chosen.length;
    const r = await mergeMerchants(chosen.map((m) => m.id), { name: mergeName });
    mergeOpen = false;
    stopSelecting();
    undoToast(`Merged ${n} merchants into ${mergeName.trim()} (${r.transactions} transactions moved)`, r.undo);
  }

  async function deleteSelected() {
    const r = await deleteMerchants(chosen.map((m) => m.id));
    stopSelecting();
    undoToast(r.archived ? `Deleted ${r.deleted}; archived ${r.archived} still used by transactions` : `Deleted ${r.deleted} merchants`, r.undo);
  }

  async function applyTidy() {
    if (!tidy) return;
    const groups = tidy.filter((g) => g.on && g.name.trim()).map((g) => ({ ids: g.group.merchants.map((m) => m.id), target: { name: g.name } }));
    const r = await mergeMerchantGroups(groups);
    tidy = null;
    undoToast(`Tidied ${groups.length} merchant${groups.length === 1 ? '' : 's'} (${r.merchants} duplicates merged)`, r.undo);
  }

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
    const r = await mergeMerchants([editing.id], { id: target.id });
    undoToast(`Merged into ${target.name} (${r.transactions} transactions)`, r.undo);
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
    {#if selecting}
      <button class="btn small" onclick={stopSelecting}>Done</button>
    {:else}
      <button class="btn small" onclick={() => (selecting = true)}><Icon name="check" size={16} /> Select</button>
    {/if}
  </div>
  {#if suggestions.length && !selecting}
    <div class="card tidy-hint row">
      <Icon name="sparkles" size={18} />
      <span class="grow small">
        <strong>{suggestions.length} merchant{suggestions.length === 1 ? '' : 's'} could be tidied</strong>
        <span class="faint">Duplicates of the same place, or names still full of bank text.</span>
      </span>
      <button class="btn small primary" onclick={openTidy}>Tidy up</button>
    </div>
  {/if}
  <p class="faint small">Merchants are created automatically when you type a new name. Each remembers the category, payment method and more from your last purchase there.{#if !selecting}{' '}Tap <em>Select</em> to merge or delete several at once.{/if}</p>
  <div class="card list">
    {#each list as m (m.id)}
      <button
        class="list-item"
        onclick={() => (selecting ? toggle(m) : open(m))}
        class:archived={m.archived}
        role={selecting ? 'checkbox' : undefined}
        aria-checked={selecting ? selected.has(m.id) : undefined}
      >
        {#if selecting}
          <span class="selbox" class:on={selected.has(m.id)} aria-hidden="true">{#if selected.has(m.id)}<Icon name="check" size={14} stroke={3} />{/if}</span>
        {:else}
          <Icon name="store" size={18} />
        {/if}
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
  {#if selecting}
    <SelectionBar count={chosen.length} total={list.length} onall={() => list.forEach((m) => selected.add(m.id))} onnone={() => selected.clear()}>
      <button
        class="btn"
        disabled={chosen.length < 2}
        onclick={() => {
          mergeName = mergeChoices[0] ?? '';
          mergeOpen = true;
        }}><Icon name="copy" size={16} /> Merge…</button
      >
      <button class="btn danger" disabled={!chosen.length} onclick={deleteSelected}><Icon name="trash" size={16} /> Delete</button>
    </SelectionBar>
  {/if}
</div>

{#if mergeOpen}
  <Sheet open={true} title={`Merge ${chosen.length} merchants`} onclose={() => (mergeOpen = false)}>
    <div class="stack">
      <label class="field">
        <span class="label">Merge into</span>
        <input class="input" bind:value={mergeName} aria-label="Merged merchant name" />
      </label>
      <div class="chips" role="group" aria-label="Name suggestions">
        {#each mergeChoices.slice(0, 8) as n (n)}
          <button type="button" class="chip" aria-pressed={mergeName === n} onclick={() => (mergeName = n)}>{n}</button>
        {/each}
      </div>
      <p class="faint small">{chosenTx} transaction{chosenTx === 1 ? '' : 's'} end up at one merchant. The other names are kept as bank names, so future imports land there too.</p>
    </div>
    {#snippet footer()}
      <span class="spacer"></span>
      <button class="btn" onclick={() => (mergeOpen = false)}>Cancel</button>
      <button class="btn primary" disabled={!mergeName.trim()} onclick={mergeSelected}>Merge</button>
    {/snippet}
  </Sheet>
{/if}

{#if tidy}
  <Sheet open={true} title="Tidy up merchants" onclose={() => (tidy = null)}>
    <div class="stack">
      <p class="small muted">Each group becomes one merchant with the name on the left (edit it if you like). Bank names are kept so future imports land in the right place.</p>
      <div class="row small">
        <button class="link" onclick={() => tidy?.forEach((g) => (g.on = true))}>Select all</button>
        <button class="link" onclick={() => tidy?.forEach((g) => (g.on = false))}>Select none</button>
      </div>
      <div class="tidy-list">
        {#each tidy as g (g.group.merchants[0].id)}
          <div class="tidy-row" class:off={!g.on}>
            <div class="row">
              <input type="checkbox" bind:checked={g.on} aria-label={`Tidy ${g.name}`} />
              <input class="input mini" bind:value={g.name} aria-label="Name after tidying" />
              <span class="faint small nowrap num">{g.group.transactions} tx</span>
            </div>
            <span class="faint tiny from">
              {g.group.merchants.length > 1 ? `${g.group.merchants.length} merchants: ` : 'Rename: '}{g.group.merchants
                .slice(0, 3)
                .map((m) => m.name)
                .join(' · ')}{g.group.merchants.length > 3 ? ` · and ${g.group.merchants.length - 3} more` : ''}
            </span>
          </div>
        {:else}
          <p class="faint small">Nothing to tidy.</p>
        {/each}
      </div>
    </div>
    {#snippet footer()}
      <span class="spacer"></span>
      <button class="btn" onclick={() => (tidy = null)}>Cancel</button>
      <button class="btn primary" disabled={!tidy?.some((g) => g.on)} onclick={applyTidy}>Tidy {tidy?.filter((g) => g.on).length ?? 0}</button>
    {/snippet}
  </Sheet>
{/if}

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
  .tidy-hint {
    padding: var(--s3);
    gap: var(--s3);
  }
  .tidy-list {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  .tidy-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: var(--s2) var(--s3);
    border-bottom: 1px solid var(--border);
  }
  .tidy-row:last-child {
    border-bottom: 0;
  }
  .tidy-row.off {
    opacity: 0.55;
  }
  .tidy-row input[type='checkbox'] {
    width: 18px;
    height: 18px;
    accent-color: var(--accent);
    flex-shrink: 0;
  }
  .mini {
    min-height: 34px;
    padding: 2px 8px;
    min-width: 0;
  }
  .from {
    padding-left: 26px;
    word-break: break-word;
  }
  .link {
    border: 0;
    background: transparent;
    padding: 2px 0;
    color: var(--accent-text);
    cursor: pointer;
    font: inherit;
  }
</style>
