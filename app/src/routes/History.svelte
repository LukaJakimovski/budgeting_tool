<!--
  History: every transaction, grouped by day (with daily totals) or as a
  sortable table. Range, search, filters and sort live in the URL.
-->
<script lang="ts">
  import { repo } from '$lib/db/repo.svelte';
  import { router } from '$lib/ui/router.svelte';
  import { ui } from '$lib/ui/ui.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import TxRow from '$lib/ui/TxRow.svelte';
  import RangePicker from '$lib/ui/RangePicker.svelte';
  import FilterChips from '$lib/ui/FilterChips.svelte';
  import SelectionBar from '$lib/ui/SelectionBar.svelte';
  import Sheet from '$lib/ui/Sheet.svelte';
  import CategoryPicker from '$lib/ui/CategoryPicker.svelte';
  import { toasts } from '$lib/ui/toast.svelte';
  import { addTag, deleteTransactions, removeTag, setCategory, setMerchant, suggestMerchantCleanup, type BulkResult } from '$lib/bulk';
  import { cleanDescriptor, looksLikeBankText, merchantGroupKey, merchantKey } from '$lib/core/banktext';
  import { SvelteSet } from 'svelte/reactivity';
  import { rangeFromQuery, rangeToQuery, type RangeValue } from '$lib/ui/range';
  import { filterFromQuery, filterToQuery } from '$lib/ui/filterQuery';
  import { compileFilter, totals, type Allocation } from '$lib/core/ledger';
  import { txDate, dayOfWeek, WEEKDAYS } from '$lib/core/dates';
  import { money, dayHeading, date as fmtDate, merchantName, categoryLabel, txTitle } from '$lib/ui/format';
  import type { Filter, ID, Merchant, Tag, Transaction } from '$lib/core/types';

  type SortKey = 'date' | 'amount' | 'merchant' | 'category' | 'payment';

  const q = router.route.query;
  let range = $state<RangeValue>(rangeFromQuery(q, 'thisMonth'));
  let filter = $state<Filter>(filterFromQuery(q.get('f')));
  let view = $state<'days' | 'table'>((q.get('view') as 'days' | 'table') ?? 'days');
  let sort = $state<SortKey>((q.get('sort') as SortKey) ?? 'date');
  let desc = $state(q.get('dir') !== 'asc');
  let search = $state(filterFromQuery(q.get('f')).text ?? '');
  let shownDays = $state(40);

  $effect(() => {
    router.replaceQuery({
      ...rangeToQuery(range),
      f: filterToQuery(filter),
      view: view === 'days' ? undefined : view,
      sort: sort === 'date' ? undefined : sort,
      dir: desc ? undefined : 'asc',
    });
  });

  let searchTimer: ReturnType<typeof setTimeout>;
  function onSearch() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => (filter = { ...filter, text: search }), 150);
  }

  /** Matching allocations in range, then the distinct transactions they belong to. */
  const matched = $derived.by(() => {
    const m = compileFilter(filter, repo.lookup());
    const allocs: Allocation[] = [];
    for (const a of repo.allocations()) if (a.date >= range.start && a.date < range.end && m(a)) allocs.push(a);
    return allocs;
  });

  const txs = $derived.by(() => {
    const seen = new Set<string>();
    const out: Transaction[] = [];
    for (const a of matched) if (!seen.has(a.tx.id)) (seen.add(a.tx.id), out.push(a.tx));
    const dir = desc ? -1 : 1;
    const key: Record<SortKey, (t: Transaction) => string | number> = {
      date: (t) => t.occurredAt,
      amount: (t) => t.baseAmount,
      merchant: (t) => (merchantName(t.merchantId) || txTitle(t)).toLowerCase(),
      category: (t) => categoryLabel(t.categoryId).toLowerCase(),
      payment: (t) => ((repo.get(t.paymentMethodId) as { name?: string })?.name ?? '').toLowerCase(),
    };
    const k = key[sort];
    return out.sort((a, b) => {
      const x = k(a);
      const y = k(b);
      return (x < y ? -1 : x > y ? 1 : 0) * dir || (a.occurredAt < b.occurredAt ? 1 : -1);
    });
  });

  const sum = $derived(totals(matched));

  const days = $derived.by(() => {
    if (sort !== 'date') return [];
    const groups: { date: string; txs: Transaction[]; spent: number; income: number }[] = [];
    let cur: (typeof groups)[number] | undefined;
    for (const t of txs) {
      const d = txDate(t.occurredAt);
      if (!cur || cur.date !== d) groups.push((cur = { date: d, txs: [], spent: 0, income: 0 }));
      cur.txs.push(t);
      if (t.kind === 'expense') cur.spent += t.baseAmount;
      else if (t.kind === 'refund') cur.spent -= t.baseAmount;
      else cur.income += t.baseAmount;
    }
    return groups;
  });

  // ------------------------------------------------------------ selection

  let selecting = $state(false);
  const selected = new SvelteSet<ID>();
  let anchor: ID | null = null;
  let bulk = $state<null | 'category' | 'merchant' | 'tag'>(null);
  let bulkCategory = $state<ID | null>(null);
  let bulkText = $state('');
  let confirmDelete = $state(false);
  let confirmTimer: ReturnType<typeof setTimeout>;

  /** Only what's in the current view counts, so a filter change never acts on hidden rows. */
  const chosen = $derived(txs.filter((t) => selected.has(t.id)));
  const chosenIds = $derived(chosen.map((t) => t.id));

  function stopSelecting() {
    selecting = false;
    selected.clear();
    anchor = null;
  }

  function pick(t: Transaction, e?: MouseEvent) {
    if (e?.shiftKey && anchor) {
      const a = txs.findIndex((x) => x.id === anchor);
      const b = txs.findIndex((x) => x.id === t.id);
      if (a >= 0 && b >= 0) {
        for (const x of txs.slice(Math.min(a, b), Math.max(a, b) + 1)) selected.add(x.id);
        anchor = t.id;
        return;
      }
    }
    if (selected.has(t.id)) selected.delete(t.id);
    else selected.add(t.id);
    anchor = t.id;
  }

  /** Same place, even when an import made a separate merchant per bank line. */
  function placeKey(t: Transaction): string | null {
    const m = repo.get<Merchant>(t.merchantId);
    if (m) return merchantGroupKey(m.name);
    if (t.bankDescription) return merchantKey(cleanDescriptor(t.bankDescription));
    return t.name ? `name:${t.name.toLowerCase()}` : null;
  }

  function selectSamePlace() {
    const keys = new Set(chosen.map(placeKey).filter(Boolean));
    for (const t of txs) if (keys.has(placeKey(t))) selected.add(t.id);
  }

  function openBulk(kind: 'category' | 'merchant' | 'tag') {
    bulkText = '';
    bulkCategory = null;
    if (kind === 'merchant') {
      // Suggest the most common (cleaned) merchant name among the selection.
      const n = new Map<string, number>();
      for (const t of chosen) {
        const m = repo.get<Merchant>(t.merchantId);
        const name = m ? (looksLikeBankText(m.name) ? cleanDescriptor(m.name) : m.name) : t.bankDescription ? cleanDescriptor(t.bankDescription) : '';
        if (name) n.set(name, (n.get(name) ?? 0) + 1);
      }
      bulkText = [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    }
    bulk = kind;
  }

  function done(r: BulkResult, what: string, opts: { skippedNote?: string; offerTidy?: boolean } = {}) {
    bulk = null;
    const tidy = opts.offerTidy && suggestMerchantCleanup().length;
    toasts.show(`${what}${r.skipped && opts.skippedNote ? ` · ${r.skipped} ${opts.skippedNote}` : ''}`, {
      tone: 'success',
      timeout: 8000,
      action: { label: 'Undo', run: r.undo },
    });
    if (tidy) toasts.show('Some merchants are now duplicates or unused.', { timeout: 9000, action: { label: 'Tidy merchants', run: () => router.go('/settings/merchants', { tidy: '1' }) } });
  }

  const plural = (n: number) => `${n} transaction${n === 1 ? '' : 's'}`;

  async function applyCategory() {
    const r = await setCategory(chosenIds, bulkCategory);
    done(r, `Changed the category of ${plural(r.count)}`, { skippedNote: 'split purchases kept their split categories' });
  }
  async function applyMerchant() {
    if (!bulkText.trim()) return;
    const r = await setMerchant(chosenIds, { name: bulkText });
    done(r, `Moved ${plural(r.count)} to ${bulkText.trim()}`, { offerTidy: true });
  }
  async function applyTag(add: boolean) {
    const name = bulkText.trim().replace(/^#/, '');
    if (!name) return;
    if (add) return done(await addTag(chosenIds, name), `Tagged ${plural(chosenIds.length)} #${name}`);
    const tag = repo.tags(true).find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (tag) done(await removeTag(chosenIds, tag.id), `Removed #${tag.name} from ${plural(chosenIds.length)}`);
  }
  async function bulkDelete() {
    if (!confirmDelete) {
      confirmDelete = true;
      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(() => (confirmDelete = false), 4000);
      return;
    }
    confirmDelete = false;
    const r = await deleteTransactions(chosenIds);
    selected.clear();
    done(r, `Deleted ${plural(r.count)}`);
  }
  const chosenTags = $derived.by(() => {
    const ids = new Set(chosen.flatMap((t) => [...t.tagIds, ...t.splits.flatMap((s) => s.tagIds)]));
    return [...ids].map((id) => repo.get<Tag>(id)).filter((t): t is Tag => !!t);
  });

  function setSort(k: SortKey) {
    if (sort === k) desc = !desc;
    else {
      sort = k;
      desc = k === 'date' || k === 'amount';
    }
  }
</script>

<div class="page">
  <div class="page-head">
    <h1>History</h1>
    <span class="spacer"></span>
    {#if selecting}
      <button class="btn small" onclick={stopSelecting}>Done</button>
    {:else if txs.length}
      <button class="btn small" onclick={() => (selecting = true)}><Icon name="check" size={16} /> Select</button>
    {/if}
    <div class="segmented" role="group" aria-label="View">
      <button type="button" aria-pressed={view === 'days'} onclick={() => { view = 'days'; sort = 'date'; desc = true; }}>Days</button>
      <button type="button" aria-pressed={view === 'table'} onclick={() => (view = 'table')}>Table</button>
    </div>
  </div>

  <div class="controls stack">
    <div class="row wrap">
      <RangePicker bind:value={range} />
      <span class="spacer"></span>
      <div class="search">
        <Icon name="search" size={16} />
        <input class="input" placeholder="Search name, merchant, notes…" bind:value={search} oninput={onSearch} aria-label="Search transactions" />
      </div>
    </div>
    <FilterChips bind:value={filter} />
  </div>

  <div class="summary card">
    <div><span class="label">Spent</span><strong class="num">{money(sum.spent)}</strong></div>
    {#if sum.income}<div><span class="label">Income</span><strong class="num">{money(sum.income)}</strong></div>{/if}
    {#if sum.refunds}<div><span class="label">Refunds</span><strong class="num">{money(sum.refunds)}</strong></div>{/if}
    <div><span class="label">Transactions</span><strong class="num">{sum.count}</strong></div>
  </div>

  {#if txs.length === 0}
    <div class="empty">
      <p>No transactions here.</p>
      <button class="btn primary" onclick={() => ui.openEntry()}><Icon name="plus" size={18} /> Add one</button>
    </div>
  {:else if view === 'days' && sort === 'date'}
    {#each days.slice(0, shownDays) as d (d.date)}
      <section class="day">
        <header class="day-head">
          <h2>{dayHeading(d.date)}</h2>
          <span class="spacer"></span>
          {#if d.income}<span class="small inc num">+{money(d.income)}</span>{/if}
          <span class="num day-total">{money(d.spent)}</span>
        </header>
        <div class="list card tight">
          {#each d.txs as tx (tx.id)}
            <TxRow {tx} {selecting} selected={selected.has(tx.id)} onselect={(e) => pick(tx, e)} />
          {/each}
        </div>
      </section>
    {/each}
    {#if days.length > shownDays}
      <button class="btn block" onclick={() => (shownDays += 60)}>Show more days</button>
    {/if}
  {:else}
    <div class="card table-wrap">
      <table class="data" class:selecting>
        <thead>
          <tr>
            {#if selecting}<th class="selcol"><span class="sr-only">Selected</span></th>{/if}
            {#each [['date', 'Date'], ['merchant', 'Merchant / name'], ['category', 'Category'], ['payment', 'Payment'], ['amount', 'Amount']] as [k, l] (k)}
              <th class:r={k === 'amount'} aria-sort={sort === k ? (desc ? 'descending' : 'ascending') : 'none'}>
                <button class="th" onclick={() => setSort(k as SortKey)}>
                  {l}
                  {#if sort === k}<Icon name={desc ? 'arrowDown' : 'arrowUp'} size={13} />{/if}
                </button>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each txs.slice(0, shownDays * 10) as t (t.id)}
            <tr
              class="click"
              class:picked={selected.has(t.id)}
              aria-selected={selecting ? selected.has(t.id) : undefined}
              onclick={(e) => (selecting ? pick(t, e) : ui.openEntry({ id: t.id }))}
            >
              {#if selecting}<td class="selcol"><span class="selbox" class:on={selected.has(t.id)} aria-hidden="true">{#if selected.has(t.id)}<Icon name="check" size={14} stroke={3} />{/if}</span></td>{/if}
              <td class="num nowrap">{WEEKDAYS[dayOfWeek(txDate(t.occurredAt))]} {fmtDate(txDate(t.occurredAt))}</td>
              <td>{txTitle(t)}{#if t.name && t.merchantId}<span class="faint"> · {merchantName(t.merchantId)}</span>{/if}</td>
              <td>{t.splits.length ? 'Split' : categoryLabel(t.categoryId)}</td>
              <td class="muted">{(repo.get(t.paymentMethodId) as { name?: string })?.name ?? ''}</td>
              <td class="r num" class:inc={t.kind !== 'expense'}>{t.kind === 'expense' ? '' : '+'}{money(t.baseAmount, t.baseCurrency)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      {#if txs.length > shownDays * 10}
        <button class="btn block" onclick={() => (shownDays += 60)}>Show more</button>
      {/if}
    </div>
  {/if}

  {#if selecting}
    <SelectionBar count={chosen.length} total={txs.length} onall={() => txs.forEach((t) => selected.add(t.id))} onnone={() => selected.clear()}>
      {#snippet extra()}
        {#if chosen.length}<button type="button" class="link" onclick={selectSamePlace} title="Everything in this view from the same place as the selection">+ Same merchant</button>{/if}
      {/snippet}
      <button class="btn small" disabled={!chosen.length} onclick={() => openBulk('category')}><Icon name="folder" size={16} /> Category</button>
      <button class="btn small" disabled={!chosen.length} onclick={() => openBulk('merchant')}><Icon name="store" size={16} /> Merchant</button>
      <button class="btn small" disabled={!chosen.length} onclick={() => openBulk('tag')}><Icon name="tag" size={16} /> Tag</button>
      <button class="btn small danger" disabled={!chosen.length} onclick={bulkDelete}><Icon name="trash" size={16} /> {confirmDelete ? `Delete ${chosen.length}?` : 'Delete'}</button>
    </SelectionBar>
    {#if !chosen.length}<p class="faint small hint-sel">Tap transactions to select them; shift-click selects a range.</p>{/if}
  {/if}
</div>

{#if bulk}
  <Sheet open={true} title={bulk === 'category' ? `Category for ${plural(chosen.length)}` : bulk === 'merchant' ? `Merchant for ${plural(chosen.length)}` : `Tag ${plural(chosen.length)}`} onclose={() => (bulk = null)}>
    <div class="stack">
      {#if bulk === 'category'}
        <CategoryPicker bind:value={bulkCategory} kind={chosen.every((t) => t.kind === 'income') ? 'income' : 'expense'} />
        {#if chosen.some((t) => t.splits.length)}<p class="faint small">Split purchases keep their per-split categories.</p>{/if}
      {:else if bulk === 'merchant'}
        <label class="field">
          <span class="label">Merchant</span>
          <input class="input" list="bulk-merchants" bind:value={bulkText} placeholder="e.g. Tim Hortons" aria-label="Merchant name" />
        </label>
        <datalist id="bulk-merchants">{#each repo.merchants() as m (m.id)}<option value={m.name}></option>{/each}</datalist>
        <p class="faint small">An existing merchant with this name is used; otherwise a new one is created. To also fold the old merchants together, use <em>Settings → Merchants → Tidy up</em> or <em>Select → Merge</em> there.</p>
      {:else}
        <label class="field">
          <span class="label">Tag</span>
          <input class="input" list="bulk-tags" bind:value={bulkText} placeholder="e.g. work" aria-label="Tag name" />
        </label>
        <datalist id="bulk-tags">{#each repo.tags() as t (t.id)}<option value={t.name}></option>{/each}</datalist>
        {#if chosenTags.length}
          <div class="chips" role="group" aria-label="Tags on the selection">
            {#each chosenTags as t (t.id)}<button type="button" class="chip" aria-pressed={bulkText === t.name} onclick={() => (bulkText = t.name)}>#{t.name}</button>{/each}
          </div>
        {/if}
      {/if}
    </div>
    {#snippet footer()}
      <span class="spacer"></span>
      <button class="btn" onclick={() => (bulk = null)}>Cancel</button>
      {#if bulk === 'category'}
        <button class="btn primary" disabled={!bulkCategory} onclick={applyCategory}>Apply</button>
      {:else if bulk === 'merchant'}
        <button class="btn primary" disabled={!bulkText.trim()} onclick={applyMerchant}>Apply</button>
      {:else}
        <button class="btn" disabled={!chosenTags.some((t) => t.name.toLowerCase() === bulkText.trim().replace(/^#/, '').toLowerCase())} onclick={() => applyTag(false)}>Remove</button>
        <button class="btn primary" disabled={!bulkText.trim()} onclick={() => applyTag(true)}>Add</button>
      {/if}
    {/snippet}
  </Sheet>
{/if}

<style>
  .controls {
    margin-bottom: var(--s3);
  }
  .search {
    position: relative;
    display: flex;
    align-items: center;
    flex: 1 1 220px;
    max-width: 360px;
  }
  .search :global(svg) {
    position: absolute;
    left: 12px;
    color: var(--text-faint);
  }
  .search .input {
    padding-left: 36px;
  }
  .summary {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s5);
    padding: var(--s3) var(--s4);
    margin-bottom: var(--s4);
  }
  .summary > div {
    display: flex;
    flex-direction: column;
  }
  .summary .label {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .day {
    margin-bottom: var(--s4);
  }
  .day-head {
    display: flex;
    align-items: baseline;
    gap: var(--s2);
    padding: 0 var(--s2) var(--s2);
  }
  .day-head h2 {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text-muted);
  }
  .day-total {
    font-weight: 650;
  }
  .inc {
    color: color-mix(in srgb, var(--good) 70%, var(--text));
  }
  .tight {
    padding: var(--s1);
  }
  .table-wrap {
    overflow-x: auto;
    padding: var(--s2);
  }
  .th {
    border: 0;
    background: transparent;
    font: inherit;
    color: inherit;
    text-transform: inherit;
    letter-spacing: inherit;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0;
  }
  tr.click {
    cursor: pointer;
  }
  .selecting tr {
    user-select: none;
  }
  tr.picked td {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }
  .selcol {
    width: 32px;
  }
  .hint-sel {
    text-align: center;
    margin-top: var(--s2);
  }
  .link {
    border: 0;
    background: transparent;
    padding: 4px 0;
    color: var(--accent-text);
    cursor: pointer;
    font: inherit;
    font-size: 0.9rem;
  }
  tr.click:hover td {
    background: var(--surface2);
  }
  .nowrap {
    white-space: nowrap;
  }
</style>
