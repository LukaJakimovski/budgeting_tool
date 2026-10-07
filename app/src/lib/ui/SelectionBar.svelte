<!-- Bottom bar for selection mode: count, select all / clear, and the actions. -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    count,
    total,
    onall,
    onnone,
    extra,
    children,
  }: { count: number; total: number; onall: () => void; onnone: () => void; extra?: Snippet; children: Snippet } = $props();
</script>

<div class="selbar" role="toolbar" aria-label="Selection">
  <div class="line">
    <strong class="num" aria-live="polite">{count} selected</strong>
    {#if count < total}<button type="button" class="link" onclick={onall}>Select all {total}</button>{/if}
    {#if count}<button type="button" class="link" onclick={onnone}>Clear</button>{/if}
    {@render extra?.()}
  </div>
  <div class="line actions">
    {@render children()}
  </div>
</div>

<style>
  .selbar {
    position: sticky;
    bottom: calc(var(--nav-h) + env(safe-area-inset-bottom) + var(--s2));
    z-index: 5;
    display: flex;
    flex-direction: column;
    gap: var(--s2);
    margin-top: var(--s3);
    padding: var(--s3);
    background: var(--surface);
    border: var(--border-w) solid var(--border);
    border-radius: calc(var(--radius) + 4px);
    box-shadow: 0 6px 24px var(--shadow);
  }
  .line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s2) var(--s3);
  }
  .actions {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(72px, 1fr));
  }
  /* Toolbar buttons: icon over a short label, so four fit on a phone. */
  .actions :global(.btn) {
    flex-direction: column;
    gap: 2px;
    min-height: 52px;
    padding: 6px 4px;
    font-size: 0.78rem;
  }
  .link {
    border: 0;
    background: transparent;
    padding: 4px 0;
    color: var(--accent-text);
    cursor: pointer;
    font: inherit;
    font-size: 0.9rem;
  }
</style>
