<script lang="ts">
  import { repo } from '$lib/db/repo.svelte';
  import LineChart from '$lib/charts/LineChart.svelte';
  import { allocationsIn, cumulative } from '$lib/analysis';
  import { addDays, daysBetween, previousRange, today, RANGE_PRESET_LABELS, type RangePreset } from '$lib/core/dates';
  import { fromPreset } from '$lib/ui/range';
  import { money, shortDate } from '$lib/ui/format';
  import type { WidgetProps } from './registry';

  let { config }: WidgetProps = $props();
  const preset = $derived((config.range as RangePreset) ?? 'thisMonth');
  const range = $derived.by(() => {
    void repo.version;
    return fromPreset(preset, repo.calendar());
  });
  const data = $derived.by(() => {
    const len = daysBetween(range.start, range.end);
    const prev = previousRange(range);
    return {
      labels: Array.from({ length: len }, (_, i) => shortDate(addDays(range.start, i))),
      series: [
        { name: 'This period', color: 'var(--accent)', values: cumulative(allocationsIn(range), range, today()) },
        { name: 'Last period', color: 'var(--text-faint)', values: cumulative(allocationsIn(prev), { start: prev.start, end: addDays(prev.start, len) }, null) },
      ],
    };
  });
</script>

<div class="card-title">Pace · {RANGE_PRESET_LABELS[preset]} vs last</div>
<LineChart labels={data.labels} series={data.series} height={160} format={(v) => money(v)} formatAxis={(v) => money(v, undefined, { compact: true })} />
