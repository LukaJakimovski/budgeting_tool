<!--
  Stats: one period + filter scopes everything on the page (tiles, charts,
  breakdowns), so the numbers always agree. Click any bar to drill into the
  matching transactions.
-->
<script lang="ts">
  import { repo } from '$lib/db/repo.svelte';
  import { router } from '$lib/ui/router.svelte';
  import RangePicker from '$lib/ui/RangePicker.svelte';
  import FilterChips from '$lib/ui/FilterChips.svelte';
  import ChartCard from '$lib/charts/ChartCard.svelte';
  import ColumnChart from '$lib/charts/ColumnChart.svelte';
  import HBars from '$lib/charts/HBars.svelte';
  import LineChart from '$lib/charts/LineChart.svelte';
  import Heatmap from '$lib/charts/Heatmap.svelte';
  import { rangeFromQuery, rangeToQuery, type RangeValue } from '$lib/ui/range';
  import { filterFromQuery, filterToQuery } from '$lib/ui/filterQuery';
  import { allocationsIn, autoGranularity, breakdown, cumulative, spendColumns, DIMENSION_LABELS, type Dimension, type Granularity } from '$lib/analysis';
  import { totals, spendByDay } from '$lib/core/ledger';
  import { addDays, daysBetween, previousRange, today, minDate } from '$lib/core/dates';
  import { money, pct, date as fmtDate, range as fmtRange } from '$lib/ui/format';
  import { resolvedMode } from '$lib/theme/apply';
  import type { Filter } from '$lib/core/types';

  const q = router.route.query;
  let range = $state<RangeValue>(rangeFromQuery(q, 'thisMonth'));
  let filter = $state<Filter>(filterFromQuery(q.get('f')));
  let dim = $state<Dimension>((q.get('by') as Dimension) ?? 'category');
  let gran = $state<Granularity | 'auto'>('auto');

  $effect(() => {
    router.replaceQuery({ ...rangeToQuery(range), f: filterToQuery(filter), by: dim === 'category' ? undefined : dim });
  });

  const compact = (v: number) => money(v, undefined, { compact: true });
  const mode = $derived(resolvedMode(repo.setting('appearance')));

  /** Clamp "all time" to the data so averages make sense. */
  const effective = $derived.by(() => {
    if (range.unit !== 'all') return range;
    const txs = repo.transactions();
    const first = txs.length ? txs[txs.length - 1].occurredAt.slice(0, 10) : today();
    return { start: first, end: addDays(today(), 1) };
  });
  const allocs = $derived(allocationsIn(effective, filter));
  const t = $derived(totals(allocs));
  const prevRange = $derived(range.unit === 'all' ? null : previousRange(effective));
  const prevTotals = $derived(prevRange ? totals(allocationsIn(prevRange, filter)) : null);
  const elapsedDays = $derived(Math.max(1, daysBetween(effective.start, minDate(addDays(today(), 1), effective.end))));
  const perDay = $derived(t.spent / elapsedDays);
  const delta = $derived(prevTotals && prevTotals.spent > 0 ? (t.spent - prevTotals.spent) / prevTotals.spent : null);

  const g = $derived(gran === 'auto' ? autoGranularity(effective) : gran);
  const columns = $derived(spendColumns(allocs, effective, g));
  const rows = $derived(breakdown(allocs, dim, mode));
  const isCurrent = $derived(effective.start <= today() && today() < effective.end);

  const lineData = $derived.by(() => {
    const len = daysBetween(effective.start, effective.end);
    if (len > 400 || !prevRange) return null;
    const labels: string[] = [];
    for (let i = 0; i < len; i++) labels.push(`Day ${i + 1}`);
    const cur = cumulative(allocs, effective, isCurrent ? today() : null);
    const prevAllocs = allocationsIn(prevRange, filter);
    const prev = cumulative(prevAllocs, { start: prevRange.start, end: addDays(prevRange.start, len) }, null);
    return {
      labels: labels.map((_, i) => fmtDate(addDays(effective.start, i)).slice(0, 5)),
      series: [
        { name: 'This period', color: 'var(--accent)', values: cur },
        { name: `Previous (${fmtRange(prevRange)})`, color: 'var(--text-faint)', values: prev },
      ],
    };
  });

  // Short periods get a 26-week calendar ending with the period, long ones at most a year.
  const heatRange = $derived.by(() => {
    const len = daysBetween(effective.start, effective.end);
    if (len >= 56 && len <= 370) return effective;
    const end = len < 56 ? effective.end : addDays(today(), 1);
    return { start: addDays(end, len < 56 ? -182 : -365), end };
  });
  const heatValues = $derived(spendByDay(heatRange === effective ? allocs : allocationsIn(heatRange, filter)));

  function drill(f: Filter) {
    router.go('/history', { ...rangeToQuery(range), f: filterToQuery({ ...filter, ...f }) });
  }
  function drillDay(d: string) {
    router.go('/history', { from: d, to: addDays(d, 1), unit: 'day', f: filterToQuery(filter) });
  }
  function drillColumn(key: string) {
    const end = g === 'day' ? addDays(key, 1) : g === 'week' ? addDays(key, 7) : columns[columns.findIndex((c) => c.key === key) + 1]?.key ?? effective.end;
    router.go('/history', { from: key, to: end, unit: g === 'day' ? 'day' : 'days', f: filterToQuery(filter) });
  }
</script>

<div class="page wide">
  <div class="page-head"><h1>Stats</h1></div>

  <div class="stack controls">
    <RangePicker bind:value={range} presets={['thisWeek', 'lastWeek', 'thisMonth', 'lastMonth', 'last30', 'last90', 'thisYear', 'lastYear', 'all']} />
    <FilterChips bind:value={filter} />
  </div>

  <div class="tiles">
    <div class="card tile hero">
      <span class="label">Spent</span>
      <span class="big-number">{money(t.spent)}</span>
      {#if delta !== null}
        <span class="small" class:status-bad={delta > 0.05} class:status-good={delta < -0.05}>
          {delta > 0 ? '▲' : '▼'} {pct(Math.abs(delta))} vs previous ({money(prevTotals?.spent ?? 0)})
        </span>
      {/if}
    </div>
    <div class="card tile">
      <span class="label">Per day</span>
      <span class="value num">{money(Math.round(perDay))}</span>
      <span class="faint small">over {elapsedDays} day{elapsedDays === 1 ? '' : 's'}</span>
    </div>
    <div class="card tile">
      <span class="label">Income</span>
      <span class="value num">{money(t.income)}</span>
      <span class="faint small">Net {money(t.income - t.spent, undefined, { sign: true })}</span>
    </div>
    <div class="card tile">
      <span class="label">Transactions</span>
      <span class="value num">{t.count}</span>
      <span class="faint small">{t.refunds ? `${money(t.refunds)} refunded` : t.count ? `avg ${money(Math.round(t.expenses / Math.max(1, t.count)))}` : ''}</span>
    </div>
  </div>

  <div class="grid">
    <div class="span2">
      <ChartCard title="Spending over time">
        {#snippet actions()}
          <div class="segmented mini" role="group" aria-label="Granularity">
            {#each [['auto', 'Auto'], ['day', 'Day'], ['week', 'Week'], ['month', 'Month']] as [k, l] (k)}
              <button type="button" aria-pressed={gran === k} onclick={() => (gran = k as Granularity | 'auto')}>{l}</button>
            {/each}
          </div>
        {/snippet}
        {#snippet chart()}
          <ColumnChart data={columns} format={(v) => money(v)} formatAxis={compact} onselect={(c) => drillColumn(c.key)} reference={g === 'day' && t.spent > 0 ? perDay : null} referenceLabel="daily avg" />
        {/snippet}
        {#snippet table()}
          <table class="data">
            <thead><tr><th>Period</th><th class="r">Spent</th></tr></thead>
            <tbody>
              {#each columns as c (c.key)}<tr><td>{c.title}</td><td class="r num">{money(c.value)}</td></tr>{/each}
            </tbody>
          </table>
        {/snippet}
      </ChartCard>
    </div>

    <div class="span2">
      <ChartCard title="Breakdown" subtitle="Expenses minus refunds. Click a row to see its transactions.">
        {#snippet actions()}
          <select class="select mini-select" bind:value={dim} aria-label="Break down by">
            {#each Object.entries(DIMENSION_LABELS) as [k, l] (k)}<option value={k}>{l}</option>{/each}
          </select>
        {/snippet}
        {#snippet chart()}
          <HBars data={rows} format={(v) => money(v)} onselect={(r) => drill((r as (typeof rows)[number]).filter)} />
        {/snippet}
        {#snippet table()}
          <table class="data">
            <thead><tr><th>{DIMENSION_LABELS[dim]}</th><th class="r">Spent</th><th class="r">Share</th><th class="r">Count</th><th class="r">Average</th></tr></thead>
            <tbody>
              {#each rows as r (r.key)}
                <tr>
                  <td>{r.icon ?? ''} {r.label}</td>
                  <td class="r num">{money(r.value)}</td>
                  <td class="r num">{t.spent > 0 ? pct(r.value / t.spent) : '—'}</td>
                  <td class="r num">{r.count}</td>
                  <td class="r num">{money(Math.round(r.value / Math.max(1, r.count)))}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/snippet}
      </ChartCard>
    </div>

    {#if lineData}
      <div class="span2">
        <ChartCard title="This period vs the previous one" subtitle="Cumulative spending, day by day">
          {#snippet chart()}
            <LineChart labels={lineData.labels} series={lineData.series} format={(v) => money(v)} formatAxis={compact} />
          {/snippet}
        </ChartCard>
      </div>
    {/if}

    <div class="span2">
      <ChartCard title="Calendar" subtitle={heatRange === effective ? '' : `${fmtRange(heatRange)} · darker = more spent`}>
        {#snippet chart()}
          <Heatmap range={heatRange} values={heatValues} weekStart={repo.setting('weekStart')} format={(v) => money(v)} formatDate={fmtDate} onselect={drillDay} />
        {/snippet}
      </ChartCard>
    </div>
  </div>
</div>

<style>
  .wide {
    --content-w: 1100px;
  }
  .controls {
    margin-bottom: var(--s4);
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--s3);
    margin-bottom: var(--s3);
  }
  .tile {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .tile .label {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    font-weight: 600;
  }
  .tile .value {
    font-size: 1.35rem;
    font-weight: 650;
  }
  .hero {
    grid-column: span 2;
  }
  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--s3);
  }
  .mini button {
    padding: 3px 8px;
    font-size: 0.75rem;
  }
  .mini-select {
    width: auto;
    min-height: 30px;
    padding: 2px 8px;
    font-size: 0.85rem;
    text-transform: none;
    letter-spacing: 0;
  }
  @media (min-width: 760px) {
    .tiles {
      grid-template-columns: minmax(0, 2fr) repeat(3, minmax(0, 1fr));
    }
    .hero {
      grid-column: auto;
    }
  }
</style>
