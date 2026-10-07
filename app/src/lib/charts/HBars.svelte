<!--
  Ranked horizontal bars (spend by category / merchant / tag…). One series,
  so one colour; labels and values in text colours; value at the bar tip.
-->
<script lang="ts" module>
  export interface HBar {
    key: string;
    label: string;
    icon?: string;
    value: number;
    /** Optional identity swatch (category colour). */
    swatch?: string;
    sub?: string;
  }
</script>

<script lang="ts">
  let {
    data,
    format,
    total,
    onselect,
    limit = 10,
  }: { data: HBar[]; format: (v: number) => string; total?: number; onselect?: (b: HBar) => void; limit?: number } = $props();

  let expanded = $state(false);
  const rows = $derived(expanded ? data : data.slice(0, limit));
  const max = $derived(Math.max(1, ...data.map((d) => Math.abs(d.value))));
  const sum = $derived(total ?? data.reduce((a, b) => a + Math.max(0, b.value), 0));
</script>

<div class="hbars">
  {#each rows as d (d.key)}
    <button type="button" class="row" onclick={() => onselect?.(d)} disabled={!onselect}>
      <span class="name">
        {#if d.swatch}<span class="sw" style:background={d.swatch} aria-hidden="true"></span>{/if}
        {#if d.icon}<span aria-hidden="true">{d.icon}</span>{/if}
        <span class="txt">{d.label}</span>
        {#if d.sub}<span class="faint tiny">{d.sub}</span>{/if}
      </span>
      <span class="track">
        <span class="fill" style:width={`${Math.max(0.5, (Math.max(0, d.value) / max) * 100)}%`}></span>
      </span>
      <span class="val num">{format(d.value)}</span>
      <span class="share num faint">{sum > 0 && d.value > 0 ? Math.round((d.value / sum) * 100) + '%' : ''}</span>
    </button>
  {/each}
  {#if data.length > limit}
    <button type="button" class="more" onclick={() => (expanded = !expanded)}>{expanded ? 'Show less' : `Show all ${data.length}`}</button>
  {/if}
  {#if !data.length}<p class="faint small">Nothing to show for this period.</p>{/if}
</div>

<style>
  .hbars {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .row {
    display: grid;
    grid-template-columns: minmax(90px, 34%) 1fr auto 40px;
    align-items: center;
    gap: var(--s2);
    padding: 6px 4px;
    border: 0;
    background: transparent;
    border-radius: var(--radius-sm);
    text-align: left;
    color: var(--text);
    cursor: pointer;
  }
  .row:disabled {
    cursor: default;
  }
  .row:not(:disabled):hover {
    background: var(--surface2);
  }
  .row:hover .fill {
    background: var(--accent);
  }
  .name {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-size: 0.9rem;
  }
  .txt {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sw {
    width: 10px;
    height: 10px;
    border-radius: 3px;
    flex-shrink: 0;
  }
  .track {
    height: 14px;
    position: relative;
  }
  .fill {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    background: color-mix(in srgb, var(--accent) 70%, var(--surface));
    border-radius: 0 4px 4px 0;
    transition: width 0.3s var(--ease), background 0.12s;
  }
  .val {
    font-weight: 600;
    font-size: 0.9rem;
  }
  .share {
    font-size: 0.75rem;
    text-align: right;
  }
  .more {
    border: 0;
    background: transparent;
    color: var(--accent-text);
    font-weight: 600;
    padding: 8px;
    cursor: pointer;
  }
</style>
