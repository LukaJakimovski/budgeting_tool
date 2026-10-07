<!-- One budget: name, period, meter with pace marker, and plain-language status. -->
<script lang="ts">
  import Meter from '../charts/Meter.svelte';
  import { money, pct } from './format';
  import { periodLabel } from '../core/dates';
  import { repo } from '../db/repo.svelte';
  import type { BudgetState } from '../core/budgets';

  let { state, compact = false, onclick }: { state: BudgetState; compact?: boolean; onclick?: () => void } = $props();

  const s = $derived(state);
  const per = $derived(s.budget.period.unit === 'day' && s.budget.period.count === 1 ? 'Today' : periodLabel(s.range, s.budget.period.unit, repo.setting('dateFormat')));
  const statusText = $derived(s.status === 'over' ? 'Over budget' : s.status === 'warn' ? 'Close to limit' : s.aheadOfPace ? 'Ahead of pace' : 'On track');
  const icon = $derived(s.status === 'over' ? '⛔' : s.status === 'warn' ? '⚠️' : s.aheadOfPace ? '↗' : '✓');
</script>

<button type="button" class="bc" class:compact {onclick} disabled={!onclick}>
  <div class="top">
    <span class="name">{s.budget.icon ? s.budget.icon + ' ' : ''}{s.budget.name}</span>
    <span class="spacer"></span>
    <span class="num amt"><strong>{money(s.spent)}</strong> <span class="faint">/ {money(s.limit)}</span></span>
  </div>
  <Meter ratio={s.ratio} pace={s.elapsed < 1 ? s.elapsed : null} status={s.status} label={`${s.budget.name}: ${pct(s.ratio)} used`} />
  <div class="bottom small">
    <span class="status" class:status-bad={s.status === 'over'} class:status-warn={s.status === 'warn'}>{icon} {statusText}</span>
    <span class="faint">· {per}</span>
    <span class="spacer"></span>
    {#if s.remaining >= 0}
      <span class="muted num">{money(s.remaining)} left{#if s.daysLeft > 1 && !compact}{` · ${money(s.perDayLeft)}/day`}{/if}</span>
    {:else}
      <span class="status-bad num">{money(-s.remaining)} over</span>
    {/if}
  </div>
</button>

<style>
  .bc {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    padding: var(--s3) var(--s2);
    border: 0;
    background: transparent;
    text-align: left;
    color: var(--text);
    border-radius: var(--radius);
    cursor: pointer;
  }
  .bc:disabled {
    cursor: default;
  }
  .bc:not(:disabled):hover {
    background: var(--surface2);
  }
  .top,
  .bottom {
    display: flex;
    align-items: baseline;
    gap: 6px;
    flex-wrap: wrap;
  }
  .name {
    font-weight: 600;
  }
  .amt {
    font-size: 0.9rem;
  }
  .compact {
    padding: var(--s2) var(--s1);
  }
</style>
