<script lang="ts">
  import { repo } from '$lib/db/repo.svelte';
  import { router } from '$lib/ui/router.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import Sheet from '$lib/ui/Sheet.svelte';
  import BudgetCard from '$lib/ui/BudgetCard.svelte';
  import ColumnChart from '$lib/charts/ColumnChart.svelte';
  import BudgetEditor from './BudgetEditor.svelte';
  import { evaluateBudget, budgetHistory, type BudgetState } from '$lib/core/budgets';
  import { periodLabel } from '$lib/core/dates';
  import { filterToQuery } from '$lib/ui/filterQuery';
  import { money, pct, shortDate } from '$lib/ui/format';
  import type { Budget } from '$lib/core/types';

  let editing = $state<Budget | null | 'new'>(null);
  let detail = $state<Budget | null>(null);

  const states = $derived.by(() => {
    const lookup = repo.lookup();
    const allocs = repo.allocations();
    const prefs = repo.calendar();
    return repo
      .list('budget')
      .filter((b) => !b.archived)
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
      .map((b) => evaluateBudget(b, allocs, lookup, prefs));
  });

  const UNIT_LABEL = { day: 'Daily', week: 'Weekly', month: 'Monthly', year: 'Yearly' } as const;
  const groups = $derived.by(() => {
    const out: { label: string; items: BudgetState[] }[] = [];
    for (const unit of ['day', 'week', 'month', 'year'] as const) {
      const items = states.filter((s) => s.budget.period.unit === unit);
      if (items.length) out.push({ label: UNIT_LABEL[unit], items });
    }
    return out;
  });

  const history = $derived(detail ? budgetHistory(detail, repo.allocations(), repo.lookup(), repo.calendar(), 8) : []);
  const detailState = $derived(history[history.length - 1]);

  async function move(b: Budget, dir: -1 | 1) {
    const list = states.map((s) => s.budget);
    const i = list.findIndex((x) => x.id === b.id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    await repo.save(list.map((x, k) => ({ ...x, order: k })));
  }

  function showTransactions(s: BudgetState) {
    router.go('/history', { from: s.range.start, to: s.range.end, unit: s.budget.period.count === 1 ? s.budget.period.unit : 'days', f: filterToQuery(s.budget.filter) });
  }
</script>

<div class="page">
  <div class="page-head">
    <h1>Budgets</h1>
    <span class="spacer"></span>
    <button class="btn primary" onclick={() => (editing = 'new')}><Icon name="plus" size={18} /> New budget</button>
  </div>

  {#if !states.length}
    <div class="card empty">
      <h2>No budgets yet</h2>
      <p class="muted">A budget is a spending limit for a period — a day, week, month or year — on whatever you choose: a category (Food), a subcategory (Sweet treats), a tag (#work), a merchant, or everything. They can overlap.</p>
      <button class="btn primary" onclick={() => (editing = 'new')}><Icon name="plus" size={18} /> Create your first budget</button>
    </div>
  {/if}

  {#each groups as g (g.label)}
    <h2 class="section-title">{g.label}</h2>
    <div class="card list">
      {#each g.items as s (s.budget.id)}
        <BudgetCard state={s} onclick={() => (detail = s.budget)} />
      {/each}
    </div>
  {/each}
  {#if states.length}
    <p class="faint small legend">The dark tick on each bar marks an even pace: spending to the left of it means you're under pace for this point in the period.</p>
  {/if}
</div>

{#if editing}
  <BudgetEditor budget={editing === 'new' ? null : editing} onclose={() => (editing = null)} />
{/if}

{#if detail && detailState}
  <Sheet open={true} title={detail.name} onclose={() => (detail = null)}>
    <div class="stack">
      <BudgetCard state={detailState} />
      <div class="facts">
        <div><span class="label">Used</span><strong class="num">{pct(detailState.ratio)}</strong></div>
        <div><span class="label">Even pace by today</span><strong class="num">{money(detailState.expectedByNow)}</strong></div>
        <div><span class="label">Days left</span><strong class="num">{detailState.daysLeft}</strong></div>
        <div><span class="label">Per day left</span><strong class="num">{money(detailState.perDayLeft)}</strong></div>
      </div>
      <h3 class="section-title">Last {history.length} periods</h3>
      <ColumnChart
        data={history.map((h, i) => ({
          key: h.range.start,
          label: detail!.period.unit === 'month' || detail!.period.unit === 'year' ? periodLabel(h.range, detail!.period.unit) : shortDate(h.range.start),
          title: `${periodLabel(h.range, detail!.period.unit, repo.setting('dateFormat'))}: ${pct(h.ratio)} of limit`,
          value: h.spent,
          highlight: i === history.length - 1,
        }))}
        format={(v) => money(v)}
        formatAxis={(v) => money(v, undefined, { compact: true })}
        reference={detail.amount}
        referenceLabel="limit"
      />
      <table class="data">
        <thead><tr><th>Period</th><th class="r">Spent</th><th class="r">Limit</th><th>Status</th></tr></thead>
        <tbody>
          {#each [...history].reverse() as h (h.range.start)}
            <tr>
              <td>{periodLabel(h.range, detail.period.unit, repo.setting('dateFormat'))}</td>
              <td class="r num">{money(h.spent)}</td>
              <td class="r num">{money(h.limit)}</td>
              <td class:status-bad={h.status === 'over'} class:status-warn={h.status === 'warn'}>{h.status === 'over' ? '⛔ Over' : h.status === 'warn' ? '⚠️ Close' : '✓ OK'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#snippet footer()}
      <button class="icon-btn" aria-label="Move up" onclick={() => move(detail!, -1)}><Icon name="arrowUp" /></button>
      <button class="icon-btn" aria-label="Move down" onclick={() => move(detail!, 1)}><Icon name="arrowDown" /></button>
      <span class="spacer"></span>
      <button class="btn" onclick={() => showTransactions(detailState)}><Icon name="list" size={18} /> Transactions</button>
      <button
        class="btn primary"
        onclick={() => {
          editing = detail;
          detail = null;
        }}><Icon name="edit" size={18} /> Edit</button
      >
    {/snippet}
  </Sheet>
{/if}

<style>
  .list {
    padding: var(--s1) var(--s2);
  }
  .legend {
    margin-top: var(--s3);
  }
  .facts {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--s3);
  }
  .facts > div {
    display: flex;
    flex-direction: column;
  }
  .facts .label {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }
  @media (min-width: 600px) {
    .facts {
      grid-template-columns: repeat(4, 1fr);
    }
  }
</style>
