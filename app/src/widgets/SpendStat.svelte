<script lang="ts">
  import { repo } from '$lib/db/repo.svelte';
  import { router } from '$lib/ui/router.svelte';
  import { allocationsIn } from '$lib/analysis';
  import { totals } from '$lib/core/ledger';
  import { RANGE_PRESET_LABELS, previousRange, daysBetween, addDays, today, minDate, type RangePreset } from '$lib/core/dates';
  import { fromPreset, rangeToQuery } from '$lib/ui/range';
  import { filterToQuery } from '$lib/ui/filterQuery';
  import { money, pct } from '$lib/ui/format';
  import type { WidgetProps } from './registry';
  import type { Filter } from '$lib/core/types';

  let { config }: WidgetProps = $props();
  const preset = $derived((config.range as RangePreset) ?? 'thisWeek');
  const measure = $derived((config.measure as 'spent' | 'income' | 'net') ?? 'spent');
  const filter = $derived((config.filter as Filter) ?? {});
  const range = $derived.by(() => {
    void repo.version;
    return fromPreset(preset, repo.calendar());
  });
  const t = $derived(totals(allocationsIn(range, filter)));
  // Compare with the same number of elapsed days in the previous period.
  const prev = $derived.by(() => {
    if (preset === 'all') return null;
    const p = previousRange(range);
    const elapsed = daysBetween(range.start, minDate(addDays(today(), 1), range.end));
    return totals(allocationsIn({ start: p.start, end: addDays(p.start, Math.max(1, elapsed)) }, filter));
  });
  const value = $derived(measure === 'income' ? t.income : measure === 'net' ? t.income - t.spent : t.spent);
  const prevValue = $derived(prev ? (measure === 'income' ? prev.income : measure === 'net' ? prev.income - prev.spent : prev.spent) : null);
  const delta = $derived(prevValue && prevValue > 0 ? (value - prevValue) / prevValue : null);
  const label = $derived((config.label as string) || `${measure === 'income' ? 'Income' : measure === 'net' ? 'Net' : 'Spent'} · ${RANGE_PRESET_LABELS[preset]}`);
</script>

<button type="button" class="stat" onclick={() => router.go('/history', { ...rangeToQuery(range), f: filterToQuery(filter) })}>
  <span class="card-title">{label}</span>
  <span class="big-number">{money(value, undefined, { sign: measure === 'net' })}</span>
  <span class="small faint">
    {t.count} transaction{t.count === 1 ? '' : 's'}
    {#if delta !== null && measure === 'spent'}
      · <span class:status-bad={delta > 0.05} class:status-good={delta < -0.05}>{delta > 0 ? '▲' : '▼'} {pct(Math.abs(delta))}</span> vs same point last time
    {/if}
  </span>
</button>

<style>
  .stat {
    display: flex;
    flex-direction: column;
    gap: 2px;
    border: 0;
    background: transparent;
    text-align: left;
    color: var(--text);
    padding: 0;
    width: 100%;
    cursor: pointer;
  }
  .card-title {
    margin-bottom: var(--s1);
  }
</style>
