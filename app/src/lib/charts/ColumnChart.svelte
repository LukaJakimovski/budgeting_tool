<!--
  Single-series column chart (spend per day/week/month). Bars ≤24px, 4px
  rounded tops, hairline grid, per-bar tooltip on hover and keyboard focus.
-->
<script lang="ts" module>
export interface Column {
  key: string;
  label: string;
  /** Long label for the tooltip. */
  title: string;
  value: number;
  highlight?: boolean;
}
</script>

<script lang="ts">
  import { niceTicks, sparseIndices } from './scale';


  let {
    data,
    height = 180,
    format,
    formatAxis = format,
    reference,
    referenceLabel = '',
    onselect,
  }: {
    data: Column[];
    height?: number;
    format: (v: number) => string;
    formatAxis?: (v: number) => string;
    /** Optional horizontal reference (e.g. daily budget). */
    reference?: number | null;
    referenceLabel?: string;
    onselect?: (c: Column) => void;
  } = $props();

  let width = $state(320);
  let active = $state<number | null>(null);

  const PAD_L = 48;
  const PAD_B = 22;
  const PAD_T = 8;
  const max = $derived(Math.max(1, ...data.map((d) => d.value), reference ?? 0));
  const ticks = $derived(niceTicks(max, 4));
  const top = $derived(ticks[ticks.length - 1] || 1);
  const plotW = $derived(Math.max(10, width - PAD_L - 4));
  const plotH = $derived(height - PAD_B - PAD_T);
  const band = $derived(plotW / Math.max(1, data.length));
  const barW = $derived(Math.max(2, Math.min(24, band - 2)));
  const labels = $derived(sparseIndices(data.length, Math.max(2, Math.floor(plotW / 56))));
  const y = (v: number) => PAD_T + plotH - (Math.max(0, v) / top) * plotH;

  function bar(i: number, v: number): string {
    const x = PAD_L + i * band + (band - barW) / 2;
    const yTop = y(v);
    const h = PAD_T + plotH - yTop;
    if (h <= 0.5) return '';
    const r = Math.min(4, barW / 2, h);
    return `M${x},${PAD_T + plotH} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + barW - r} Q${x + barW},${yTop} ${x + barW},${yTop + r} V${PAD_T + plotH} Z`;
  }

  function key(e: KeyboardEvent) {
    if (!data.length) return;
    if (e.key === 'ArrowRight') active = Math.min(data.length - 1, (active ?? -1) + 1);
    else if (e.key === 'ArrowLeft') active = Math.max(0, (active ?? data.length) - 1);
    else if (e.key === 'Enter' && active !== null) onselect?.(data[active]);
    else return;
    e.preventDefault();
  }
</script>

<div class="wrap" bind:clientWidth={width}>
  <!-- Keyboard: arrow keys move through values (the tooltip is announced via role=status). -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <svg
    {width}
    {height}
    role="application"
    aria-roledescription="chart"
    aria-label={`Column chart, ${data.length} periods. Use arrow keys to read values.`}
    tabindex="0"
    onkeydown={key}
    onblur={() => (active = null)}
  >
    {#each ticks as t (t)}
      <line x1={PAD_L} x2={width - 4} y1={y(t)} y2={y(t)} class="grid" />
      <text x={PAD_L - 6} y={y(t)} class="axis" text-anchor="end" dominant-baseline="middle">{formatAxis(t)}</text>
    {/each}
    {#each data as d, i (d.key)}
      <g
        class="col"
        class:dim={active !== null && active !== i}
        onpointerenter={() => (active = i)}
        onpointerleave={() => (active = null)}
        onclick={() => onselect?.(d)}
        role="presentation"
      >
        <rect x={PAD_L + i * band} y={PAD_T} width={band} height={plotH} fill="transparent" />
        <path d={bar(i, d.value)} class:hl={d.highlight} class="bar" />
      </g>
      {#if labels.has(i)}
        <text x={PAD_L + i * band + band / 2} y={height - 6} class="axis" text-anchor="middle">{d.label}</text>
      {/if}
    {/each}
    {#if reference}
      <line x1={PAD_L} x2={width - 4} y1={y(reference)} y2={y(reference)} class="ref" />
      <text x={width - 6} y={y(reference) - 5} class="axis ref-label" text-anchor="end">{referenceLabel}</text>
    {/if}
  </svg>
  {#if active !== null && data[active]}
    {@const d = data[active]}
    <div class="tip" style:left={`${Math.min(width - 150, Math.max(0, PAD_L + active * band + band / 2 - 70))}px`} role="status">
      <strong class="num">{format(d.value)}</strong>
      <span class="muted small">{d.title}</span>
    </div>
  {/if}
</div>

<style>
  .wrap {
    position: relative;
    width: 100%;
    min-width: 0;
  }
  .wrap > svg {
    max-width: 100%;
  }
  svg {
    display: block;
    overflow: visible;
    outline: none;
  }
  svg:focus-visible {
    outline: 2px solid var(--focus);
    border-radius: 4px;
  }
  .grid {
    stroke: var(--grid);
    stroke-width: 1;
  }
  .axis {
    fill: var(--text-faint);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  .bar {
    fill: color-mix(in srgb, var(--accent) 72%, var(--surface));
    transition: fill 0.12s;
  }
  .bar.hl {
    fill: var(--accent);
  }
  .col {
    cursor: pointer;
  }
  .col:hover .bar,
  .col:not(.dim) .bar.hl {
    fill: var(--accent);
  }
  .ref {
    stroke: var(--text-muted);
    stroke-width: 1.5;
  }
  .tip {
    position: absolute;
    top: -6px;
    width: 140px;
    display: flex;
    flex-direction: column;
    padding: 6px 10px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    box-shadow: 0 6px 18px var(--shadow);
    pointer-events: none;
    z-index: 2;
  }
</style>
