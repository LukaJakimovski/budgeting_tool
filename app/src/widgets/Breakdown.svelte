<script lang="ts">
  import { repo } from '$lib/db/repo.svelte';
  import { router } from '$lib/ui/router.svelte';
  import HBars from '$lib/charts/HBars.svelte';
  import { allocationsIn, breakdown, DIMENSION_LABELS, type Dimension } from '$lib/analysis';
  import { RANGE_PRESET_LABELS, type RangePreset } from '$lib/core/dates';
  import { fromPreset, rangeToQuery } from '$lib/ui/range';
  import { filterToQuery } from '$lib/ui/filterQuery';
  import { resolvedMode } from '$lib/theme/apply';
  import { money } from '$lib/ui/format';
  import type { WidgetProps } from './registry';
  import type { Filter } from '$lib/core/types';

  let { config }: WidgetProps = $props();
  const preset = $derived((config.range as RangePreset) ?? 'thisMonth');
  const dim = $derived((config.dimension as Dimension) ?? 'category');
  const range = $derived.by(() => {
    void repo.version;
    return fromPreset(preset, repo.calendar());
  });
  const rows = $derived(breakdown(allocationsIn(range, (config.filter as Filter) ?? {}), dim, resolvedMode(repo.setting('appearance'))));
</script>

<div class="card-title">{DIMENSION_LABELS[dim]} · {RANGE_PRESET_LABELS[preset]}</div>
<HBars data={rows} limit={Number(config.limit) || 6} format={(v) => money(v)} onselect={(r) => router.go('/history', { ...rangeToQuery(range), f: filterToQuery((r as (typeof rows)[number]).filter) })} />
