<script lang="ts">
  import { repo } from '$lib/db/repo.svelte';
  import { router } from '$lib/ui/router.svelte';
  import Heatmap from '$lib/charts/Heatmap.svelte';
  import { allocationsIn } from '$lib/analysis';
  import { spendByDay } from '$lib/core/ledger';
  import { addDays, today } from '$lib/core/dates';
  import { money, date as fmtDate } from '$lib/ui/format';
  import type { WidgetProps } from './registry';

  let { config }: WidgetProps = $props();
  const weeks = $derived(Number(config.weeks) || 26);
  const range = $derived({ start: addDays(today(), -(weeks * 7 - 1)), end: addDays(today(), 1) });
  const values = $derived(spendByDay(allocationsIn(range)));
</script>

<div class="card-title">Daily spending · {weeks} weeks</div>
<Heatmap {range} {values} weekStart={repo.setting('weekStart')} format={(v) => money(v)} formatDate={fmtDate} onselect={(d) => router.go('/history', { from: d, to: addDays(d, 1), unit: 'day' })} />
