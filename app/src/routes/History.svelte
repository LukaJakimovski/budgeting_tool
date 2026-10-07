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
  import { rangeFromQuery, rangeToQuery, type RangeValue } from '$lib/ui/range';
  import { filterFromQuery, filterToQuery } from '$lib/ui/filterQuery';
  import { compileFilter, totals, type Allocation } from '$lib/core/ledger';
  import { txDate, dayOfWeek, WEEKDAYS } from '$lib/core/dates';
  import { money, dayHeading, date as fmtDate, merchantName, categoryLabel, txTitle } from '$lib/ui/format';
  import type { Filter, Transaction } from '$lib/core/types';

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
            <TxRow {tx} />
          {/each}
        </div>
      </section>
    {/each}
    {#if days.length > shownDays}
      <button class="btn block" onclick={() => (shownDays += 60)}>Show more days</button>
    {/if}
  {:else}
    <div class="card table-wrap">
      <table class="data">
        <thead>
          <tr>
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
            <tr class="click" onclick={() => ui.openEntry({ id: t.id })}>
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
</div>

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
  tr.click:hover td {
    background: var(--surface2);
  }
  .nowrap {
    white-space: nowrap;
  }
</style>
