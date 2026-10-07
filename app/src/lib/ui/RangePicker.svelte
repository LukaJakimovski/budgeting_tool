<!-- Period selector: ‹ label › with presets and a custom range. -->
<script lang="ts">
  import { repo } from '../db/repo.svelte';
  import Icon from './Icon.svelte';
  import {
    RANGE_PRESET_LABELS,
    addDays,
    daysBetween,
    periodContaining,
    periodLabel,
    shiftPeriod,
    simplePeriod,
    today,
    type RangePreset,
  } from '../core/dates';
  import { fromPreset, type RangeValue } from './range';
  import { range as fmtRange } from './format';

  let {
    value = $bindable(),
    presets = ['thisWeek', 'thisMonth', 'lastMonth', 'last30', 'last90', 'thisYear', 'all'],
  }: { value: RangeValue; presets?: RangePreset[] } = $props();
  let open = $state(false);
  let customStart = $state('');
  let customEnd = $state('');

  const label = $derived.by(() => {
    if (value.unit === 'all') return 'All time';
    if (value.unit === 'days') return fmtRange(value);
    return periodLabel(value, value.unit, repo.setting('dateFormat'));
  });

  function stepped(n: number): RangeValue {
    if (value.unit === 'all') return value;
    if (value.unit === 'days') {
      const len = daysBetween(value.start, value.end);
      return { start: addDays(value.start, n * len), end: addDays(value.end, n * len), unit: 'days' };
    }
    const spec = simplePeriod(value.unit);
    const prefs = repo.calendar();
    return { ...shiftPeriod(periodContaining(value.start, spec, prefs), spec, n, prefs), unit: value.unit };
  }

  /** Periods that haven't started yet have nothing to show. */
  const canNext = $derived(value.unit !== 'all' && stepped(1).start <= today());

  function step(n: number) {
    if (n > 0 && !canNext) return;
    value = stepped(n);
  }

  function choose(p: RangePreset) {
    value = fromPreset(p);
    open = false;
  }

  function applyCustom() {
    const end = customEnd > today() ? today() : customEnd;
    if (!customStart || !end || end < customStart) return;
    value = { start: customStart, end: addDays(end, 1), unit: 'days' };
    open = false;
  }
</script>

<div class="rp">
  <button type="button" class="icon-btn" onclick={() => step(-1)} aria-label="Previous period" disabled={value.unit === 'all'}><Icon name="chevronLeft" /></button>
  <button
    type="button"
    class="label"
    aria-expanded={open}
    onclick={() => {
      open = !open;
      customStart = value.unit === 'all' ? '' : value.start;
      customEnd = value.unit === 'all' ? '' : addDays(value.end, -1);
    }}
  >
    <Icon name="calendar" size={16} />
    {label}
  </button>
  <button type="button" class="icon-btn" onclick={() => step(1)} aria-label="Next period" disabled={!canNext}><Icon name="chevronRight" /></button>

  {#if open}
    <div class="menu card" role="dialog" aria-label="Choose period">
      <div class="chips">
        {#each presets as p (p)}
          <button type="button" class="chip" onclick={() => choose(p)}>{RANGE_PRESET_LABELS[p]}</button>
        {/each}
      </div>
      <div class="custom">
        <label class="field"><span class="label">From</span><input type="date" class="input" max={today()} bind:value={customStart} /></label>
        <label class="field"><span class="label">To</span><input type="date" class="input" max={today()} bind:value={customEnd} /></label>
        <button type="button" class="btn small primary" onclick={applyCustom}>Apply</button>
      </div>
    </div>
  {/if}
</div>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (open = false)} />

<style>
  .rp {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }
  .label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 0;
    background: transparent;
    font-weight: 600;
    padding: 6px 10px;
    border-radius: var(--radius);
    cursor: pointer;
    color: var(--text);
  }
  .label:hover {
    background: var(--surface2);
  }
  .menu {
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 20;
    width: min(360px, 90vw);
    display: flex;
    flex-direction: column;
    gap: var(--s3);
    box-shadow: 0 10px 30px var(--shadow);
  }
  .custom {
    display: grid;
    grid-template-columns: 1fr 1fr auto;
    gap: var(--s2);
    align-items: end;
  }
  .icon-btn:disabled {
    opacity: 0.3;
  }
</style>
