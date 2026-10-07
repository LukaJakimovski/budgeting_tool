<!--
  Multi-series line chart on one axis (e.g. cumulative spend this period vs
  last period vs budget). 2px lines, crosshair that snaps to the nearest x,
  one tooltip listing every series, legend always shown for ≥2 series.
-->
<script lang="ts" module>
  export interface LineSeries {
    name: string;
    color: string;
    values: (number | null)[];
    /** Thin reference style (e.g. budget). */
    reference?: boolean;
  }
</script>

<script lang="ts">
  import { niceTicks, sparseIndices } from './scale';

  let {
    labels,
    series,
    height = 200,
    format,
    formatAxis = format,
  }: { labels: string[]; series: LineSeries[]; height?: number; format: (v: number) => string; formatAxis?: (v: number) => string } = $props();

  let width = $state(320);
  let hover = $state<number | null>(null);
  let svgEl: SVGSVGElement | undefined = $state();

  const PAD_L = 48;
  const PAD_R = 8;
  const PAD_T = 10;
  const PAD_B = 22;
  const n = $derived(labels.length);
  const max = $derived(Math.max(1, ...series.flatMap((s) => s.values.filter((v): v is number => v !== null))));
  const ticks = $derived(niceTicks(max, 4));
  const top = $derived(ticks[ticks.length - 1] || 1);
  const plotW = $derived(Math.max(10, width - PAD_L - PAD_R));
  const plotH = $derived(height - PAD_T - PAD_B);
  const x = (i: number) => PAD_L + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => PAD_T + plotH - (Math.max(0, v) / top) * plotH;
  const xLabels = $derived(sparseIndices(n, Math.max(2, Math.floor(plotW / 60))));

  function path(values: (number | null)[]): string {
    let d = '';
    let pen = false;
    values.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  }

  function lastIndex(values: (number | null)[]): number {
    for (let i = values.length - 1; i >= 0; i--) if (values[i] !== null) return i;
    return -1;
  }

  function move(e: PointerEvent) {
    if (!svgEl || n === 0) return;
    const r = svgEl.getBoundingClientRect();
    const px = e.clientX - r.left - PAD_L;
    hover = Math.max(0, Math.min(n - 1, Math.round((px / plotW) * (n - 1))));
  }

  function key(e: KeyboardEvent) {
    if (e.key === 'ArrowRight') hover = Math.min(n - 1, (hover ?? -1) + 1);
    else if (e.key === 'ArrowLeft') hover = Math.max(0, (hover ?? n) - 1);
    else return;
    e.preventDefault();
  }
</script>

<div class="wrap" bind:clientWidth={width}>
  {#if series.length > 1}
    <div class="legend">
      {#each series as s (s.name)}
        <span class="key"><span class="line" style:background={s.color} class:refl={s.reference}></span>{s.name}</span>
      {/each}
    </div>
  {/if}
  <!-- Keyboard: arrow keys move through values (the tooltip is announced via role=status). -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <svg
    bind:this={svgEl}
    {width}
    {height}
    role="application"
    aria-roledescription="chart"
    aria-label={`Line chart: ${series.map((s) => s.name).join(', ')}. Use arrow keys to read values.`}
    tabindex="0"
    onpointermove={move}
    onpointerleave={() => (hover = null)}
    onkeydown={key}
    onblur={() => (hover = null)}
  >
    {#each ticks as t (t)}
      <line x1={PAD_L} x2={width - PAD_R} y1={y(t)} y2={y(t)} class="grid" />
      <text x={PAD_L - 6} y={y(t)} class="axis" text-anchor="end" dominant-baseline="middle">{formatAxis(t)}</text>
    {/each}
    {#each labels as l, i (i)}
      {#if xLabels.has(i)}<text x={x(i)} y={height - 6} class="axis" text-anchor="middle">{l}</text>{/if}
    {/each}
    {#if hover !== null}
      <line x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={PAD_T + plotH} class="cross" />
    {/if}
    {#each series as s (s.name)}
      {@const li = lastIndex(s.values)}
      <path d={path(s.values)} fill="none" stroke={s.color} stroke-width={s.reference ? 1.5 : 2} stroke-linejoin="round" stroke-linecap="round" opacity={s.reference ? 0.8 : 1} />
      {#if li >= 0 && !s.reference}
        <circle cx={x(li)} cy={y(s.values[li] ?? 0)} r="4" fill={s.color} stroke="var(--surface)" stroke-width="2" />
      {/if}
      {#if hover !== null && s.values[hover] !== null}
        <circle cx={x(hover)} cy={y(s.values[hover] ?? 0)} r="4" fill={s.color} stroke="var(--surface)" stroke-width="2" />
      {/if}
    {/each}
  </svg>
  {#if hover !== null}
    <div class="tip" style:left={`${Math.min(width - 170, Math.max(0, x(hover) - 80))}px`} role="status">
      <span class="muted small">{labels[hover]}</span>
      {#each series as s (s.name)}
        {#if s.values[hover] !== null}
          <span class="trow"><span class="line" style:background={s.color}></span><strong class="num">{format(s.values[hover] ?? 0)}</strong><span class="faint small">{s.name}</span></span>
        {/if}
      {/each}
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
    touch-action: pan-y;
  }
  svg:focus-visible {
    outline: 2px solid var(--focus);
    border-radius: 4px;
  }
  .grid {
    stroke: var(--grid);
  }
  .cross {
    stroke: var(--text-faint);
    stroke-width: 1;
  }
  .axis {
    fill: var(--text-faint);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s3);
    font-size: 0.8rem;
    color: var(--text-muted);
    margin-bottom: var(--s2);
  }
  .key,
  .trow {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .line {
    width: 14px;
    height: 2px;
    border-radius: 1px;
    display: inline-block;
  }
  .line.refl {
    height: 1.5px;
  }
  .tip {
    position: absolute;
    top: 20px;
    min-width: 160px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 10px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    box-shadow: 0 6px 18px var(--shadow);
    pointer-events: none;
    z-index: 2;
  }
</style>
