<!-- Card wrapper for a chart with a chart/table toggle (every chart has a table view). -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  let { title, subtitle = '', chart, table, actions }: { title: string; subtitle?: string; chart: Snippet; table?: Snippet; actions?: Snippet } = $props();
  let showTable = $state(false);
</script>

<section class="card chart-card">
  <div class="card-title">
    <span>{title}</span>
    <span class="spacer"></span>
    {#if actions}{@render actions()}{/if}
    {#if table}
      <button type="button" class="toggle" aria-pressed={showTable} onclick={() => (showTable = !showTable)}>{showTable ? 'Chart' : 'Table'}</button>
    {/if}
  </div>
  {#if subtitle}<p class="faint small sub">{subtitle}</p>{/if}
  {#if showTable && table}
    <div class="tbl">{@render table()}</div>
  {:else}
    {@render chart()}
  {/if}
</section>

<style>
  .chart-card {
    min-width: 0;
  }
  .sub {
    margin-top: calc(-1 * var(--s2));
  }
  .toggle {
    border: 0;
    background: var(--surface2);
    color: var(--text-muted);
    font-size: 0.75rem;
    font-weight: 600;
    border-radius: 999px;
    padding: 3px 10px;
    cursor: pointer;
    text-transform: none;
    letter-spacing: 0;
  }
  .tbl {
    max-height: 360px;
    overflow: auto;
  }
</style>
