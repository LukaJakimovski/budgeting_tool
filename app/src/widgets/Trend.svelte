<script lang="ts">
  import { repo } from '$lib/db/repo.svelte';
  import { router } from '$lib/ui/router.svelte';
  import ColumnChart from '$lib/charts/ColumnChart.svelte';
  import { allocationsIn, spendColumns, autoGranularity } from '$lib/analysis';
  import { RANGE_PRESET_LABELS, addDays, type RangePreset } from '$lib/core/dates';
  import { fromPreset } from '$lib/ui/range';
  import { money } from '$lib/ui/format';
  import type { WidgetProps } from './registry';

  let { config }: WidgetProps = $props();
  const preset = $derived((config.range as RangePreset) ?? 'last30');
  const range = $derived.by(() => {
    void repo.version;
    return fromPreset(preset, repo.calendar());
  });
  const g = $derived(autoGranularity(range));
  const cols = $derived(spendColumns(allocationsIn(range), range, g));
</script>

<div class="card-title"><span>Spending · {RANGE_PRESET_LABELS[preset]}</span><span class="spacer"></span><a href="#/stats" class="small">Stats</a></div>
<ColumnChart data={cols} height={150} format={(v) => money(v)} formatAxis={(v) => money(v, undefined, { compact: true })} onselect={(c) => router.go('/history', { from: c.key, to: g === 'day' ? addDays(c.key, 1) : addDays(c.key, 7), unit: g === 'day' ? 'day' : 'days' })} />
