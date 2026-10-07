<script lang="ts">
  import { repo } from '$lib/db/repo.svelte';
  import TxRow from '$lib/ui/TxRow.svelte';
  import { shortDate } from '$lib/ui/format';
  import { txDate, today } from '$lib/core/dates';
  import type { WidgetProps } from './registry';

  let { config }: WidgetProps = $props();
  const txs = $derived(repo.transactions().slice(0, Number(config.count) || 5));
</script>

<div class="card-title"><span>Recent</span><span class="spacer"></span><a href="#/history" class="small">All</a></div>
{#if txs.length}
  <div class="list">
    {#each txs as tx (tx.id)}
      <TxRow {tx} showDate={txDate(tx.occurredAt) === today() ? 'Today' : shortDate(txDate(tx.occurredAt))} />
    {/each}
  </div>
{:else}
  <p class="muted small">Nothing yet — tap <strong>+</strong> to add your first purchase.</p>
{/if}
