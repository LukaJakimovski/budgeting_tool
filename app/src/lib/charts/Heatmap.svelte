<!-- Calendar heatmap of daily spend: one hue, light → dark by quantile. -->
<script lang="ts">
  import { addDays, dayOfWeek, MONTHS, parts, WEEKDAYS, type DateRange } from '../core/dates';

  let {
    range,
    values,
    weekStart = 1,
    format,
    formatDate,
    onselect,
  }: {
    range: DateRange;
    values: Map<string, number>;
    weekStart?: number;
    format: (v: number) => string;
    formatDate: (d: string) => string;
    onselect?: (date: string) => void;
  } = $props();

  let width = $state(320);
  let active = $state<{ d: string; x: number; y: number } | null>(null);

  const weeks = $derived.by(() => {
    const first = addDays(range.start, -((dayOfWeek(range.start) - weekStart + 7) % 7));
    const cols: string[][] = [];
    for (let d = first; d < range.end; d = addDays(d, 7)) {
      cols.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
    }
    return cols;
  });
  const LEFT = 26;
  const TOP = 16;
  const gap = 2;
  const cell = $derived(Math.max(8, Math.min(18, Math.floor((width - LEFT) / Math.max(1, weeks.length)) - gap)));
  const thresholds = $derived.by(() => {
    const v = [...values.values()].filter((x) => x > 0).sort((a, b) => a - b);
    if (!v.length) return [1, 2, 3];
    const q = (p: number) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
    return [q(0.25), q(0.5), q(0.75)];
  });
  function level(v: number | undefined): number {
    if (!v || v <= 0) return 0;
    if (v <= thresholds[0]) return 1;
    if (v <= thresholds[1]) return 2;
    if (v <= thresholds[2]) return 3;
    return 4;
  }
  const FILL = ['var(--surface2)', 'color-mix(in srgb, var(--accent) 28%, var(--surface))', 'color-mix(in srgb, var(--accent) 50%, var(--surface))', 'color-mix(in srgb, var(--accent) 75%, var(--surface))', 'var(--accent)'];
  const monthMarks = $derived.by(() => {
    const out: { i: number; label: string }[] = [];
    let last = '';
    weeks.forEach((w, i) => {
      const m = w[0].slice(0, 7);
      if (m !== last) {
        // Skip a label that would collide with the previous one.
        if (!out.length || i - out[out.length - 1].i >= 3) out.push({ i, label: MONTHS[parts(w[0])[1] - 1] });
        last = m;
      }
    });
    return out;
  });
</script>

<div class="wrap" bind:clientWidth={width}>
  <svg width={LEFT + weeks.length * (cell + gap)} height={TOP + 7 * (cell + gap)} role="img" aria-label="Calendar of daily spending">
    {#each monthMarks as m (m.i)}
      <text x={LEFT + m.i * (cell + gap)} y={10} class="axis">{m.label}</text>
    {/each}
    {#each [1, 3, 5] as r (r)}
      <text x={0} y={TOP + r * (cell + gap) + cell * 0.75} class="axis">{WEEKDAYS[(weekStart + r) % 7].slice(0, 2)}</text>
    {/each}
    {#each weeks as w, i (w[0])}
      {#each w as d, j (d)}
        {#if d >= range.start && d < range.end}
          <rect
            x={LEFT + i * (cell + gap)}
            y={TOP + j * (cell + gap)}
            width={cell}
            height={cell}
            rx={Math.min(3, cell / 4)}
            fill={FILL[level(values.get(d))]}
            class="cell"
            role="presentation"
            onpointerenter={() => (active = { d, x: LEFT + i * (cell + gap), y: TOP + j * (cell + gap) })}
            onpointerleave={() => (active = null)}
            onclick={() => onselect?.(d)}
          />
        {/if}
      {/each}
    {/each}
  </svg>
  {#if active}
    <div class="tip" style:left={`${Math.min(width - 150, Math.max(0, active.x - 60))}px`} style:top={`${active.y + cell + 6}px`} role="status">
      <strong class="num">{format(values.get(active.d) ?? 0)}</strong>
      <span class="muted small">{WEEKDAYS[dayOfWeek(active.d)]} {formatDate(active.d)}</span>
    </div>
  {/if}
  <div class="legend faint tiny">
    Less {#each FILL as f, i (i)}<span class="sw" style:background={f}></span>{/each} More
  </div>
</div>

<style>
  .wrap {
    position: relative;
    overflow-x: auto;
  }
  svg {
    display: block;
  }
  .axis {
    fill: var(--text-faint);
    font-size: 10px;
  }
  .cell {
    cursor: pointer;
  }
  .cell:hover {
    stroke: var(--text);
    stroke-width: 1;
  }
  .legend {
    display: flex;
    align-items: center;
    gap: 3px;
    justify-content: flex-end;
    margin-top: var(--s2);
  }
  .sw {
    width: 11px;
    height: 11px;
    border-radius: 3px;
    display: inline-block;
  }
  .tip {
    position: absolute;
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
