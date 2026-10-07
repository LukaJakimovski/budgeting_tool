<script lang="ts">
  import { repo } from '$lib/db/repo.svelte';
  import { toasts } from '$lib/ui/toast.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import type { Channel, PaymentMethod } from '$lib/core/types';

  let newName = $state('');
  const counts = $derived.by(() => {
    const m = new Map<string, number>();
    for (const t of repo.transactions()) if (t.paymentMethodId) m.set(t.paymentMethodId, (m.get(t.paymentMethodId) ?? 0) + 1);
    return m;
  });

  async function add() {
    if (!newName.trim()) return;
    await repo.create('paymentMethod', { name: newName.trim(), defaultChannel: null, order: repo.paymentMethods(true).length, archived: false });
    newName = '';
  }
  async function remove(p: PaymentMethod) {
    if (counts.get(p.id)) {
      await repo.update<PaymentMethod>(p.id, { archived: true });
      toasts.show(`${p.name} is used by past transactions, so it was archived.`);
    } else await repo.remove(p.id);
  }
  async function move(p: PaymentMethod, dir: -1 | 1) {
    const list = [...repo.paymentMethods(true)];
    const i = list.findIndex((x) => x.id === p.id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    await repo.save(list.map((x, k) => ({ ...x, order: k })));
  }
</script>

<div class="stack">
  <div class="row">
    <input class="input" placeholder="e.g. CIBC Visa, Wise card" bind:value={newName} onkeydown={(e) => e.key === 'Enter' && add()} />
    <button class="btn" onclick={add}><Icon name="plus" size={16} /> Add</button>
  </div>
  <div class="card list">
    {#each repo.paymentMethods(true) as p (p.id)}
      <div class="row item" class:archived={p.archived}>
        <Icon name="card" size={18} />
        <input class="input name" value={p.name} onchange={(e) => repo.update<PaymentMethod>(p.id, { name: (e.target as HTMLInputElement).value })} aria-label="Name" />
        <select class="select ch" value={p.defaultChannel ?? ''} onchange={(e) => repo.update<PaymentMethod>(p.id, { defaultChannel: ((e.target as HTMLSelectElement).value || null) as Channel | null })} aria-label="Usually">
          <option value="">Usually: any</option>
          <option value="in_person">Usually in person</option>
          <option value="online">Usually online</option>
        </select>
        <span class="faint small num">{counts.get(p.id) ?? 0}</span>
        {#if p.archived}
          <button class="btn small" onclick={() => repo.update<PaymentMethod>(p.id, { archived: false })}>Restore</button>
        {:else}
          <button class="icon-btn" aria-label="Move up" onclick={() => move(p, -1)}><Icon name="chevronUp" size={16} /></button>
          <button class="icon-btn" aria-label="Move down" onclick={() => move(p, 1)}><Icon name="chevronDown" size={16} /></button>
          <button class="icon-btn" aria-label={`Remove ${p.name}`} onclick={() => remove(p)}><Icon name="trash" size={16} /></button>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .list {
    padding: var(--s2);
    display: flex;
    flex-direction: column;
    gap: var(--s2);
  }
  .name {
    flex: 1;
    min-width: 120px;
  }
  .ch {
    width: auto;
    max-width: 170px;
  }
  .archived {
    opacity: 0.55;
  }
  @media (max-width: 560px) {
    .item {
      flex-wrap: wrap;
    }
  }
</style>
