<!-- One-tap favourites: opens the entry sheet with the merchant (and its defaults) filled in. -->
<script lang="ts">
  import { repo } from '$lib/db/repo.svelte';
  import { ui } from '$lib/ui/ui.svelte';
  import { frequentMerchants } from '$lib/actions';
  import Icon from '$lib/ui/Icon.svelte';
  import type { Merchant } from '$lib/core/types';
  import type { WidgetProps } from './registry';

  let { config }: WidgetProps = $props();
  const merchants = $derived.by(() => {
    const ids = (config.merchantIds as string[]) ?? [];
    if (ids.length) return ids.map((id) => repo.get<Merchant>(id)).filter((m): m is Merchant => !!m);
    const freq = frequentMerchants();
    return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, Number(config.count) || 6).map(([id]) => repo.get<Merchant>(id)).filter((m): m is Merchant => !!m);
  });
</script>

<div class="card-title">Quick add</div>
<div class="chips">
  {#each merchants as m (m.id)}
    <button type="button" class="chip" onclick={() => ui.openEntry({ prefill: { merchantId: m.id, categoryId: m.defaults.categoryId ?? undefined } })}>
      <Icon name="plus" size={14} />{m.name}
    </button>
  {/each}
  {#if !merchants.length}<p class="muted small">Your most-used merchants will appear here for one-tap entry.</p>{/if}
</div>
