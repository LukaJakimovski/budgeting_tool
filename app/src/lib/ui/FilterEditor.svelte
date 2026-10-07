<!-- Edits a Filter: used by history, stats, budgets and widgets. -->
<script lang="ts">
  import MultiPick from './MultiPick.svelte';
  import { categoryItems, merchantItems, paymentItems, tagItems } from './pickers';
  import { parseAmount, toDecimalString } from '../core/money';
  import { repo } from '../db/repo.svelte';
  import type { Channel, Filter, TxKind } from '../core/types';

  let { value = $bindable(), showKinds = true, showAmount = true }: { value: Filter; showKinds?: boolean; showAmount?: boolean } = $props();

  const base = repo.setting('baseCurrency');
  let section = $state<'categories' | 'tags' | 'merchants' | 'payment' | 'other'>('categories');
  let tagMode = $state<'include' | 'exclude'>(value.excludeTagIds?.length && !value.tagIds?.length ? 'exclude' : 'include');
  let minText = $state(value.minAmount != null ? toDecimalString(value.minAmount, base) : '');
  let maxText = $state(value.maxAmount != null ? toDecimalString(value.maxAmount, base) : '');

  function arr<K extends keyof Filter>(k: K): string[] {
    return (value[k] as string[] | undefined) ?? [];
  }
  function set<K extends keyof Filter>(k: K, v: Filter[K]) {
    value = { ...value, [k]: v };
  }
  /** A tag is either required or excluded, never both. */
  function setTags(k: 'tagIds' | 'excludeTagIds', v: string[]) {
    const other = k === 'tagIds' ? 'excludeTagIds' : 'tagIds';
    const rest = arr(other).filter((id) => !v.includes(id));
    value = { ...value, [k]: v, ...(rest.length !== arr(other).length ? { [other]: rest } : {}) };
  }
  function toggleKind(k: TxKind) {
    const cur = value.kinds ?? [];
    set('kinds', cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]);
  }
  function toggleChannel(c: Channel) {
    const cur = value.channels ?? [];
    set('channels', cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]);
  }
  function amounts() {
    value = { ...value, minAmount: minText.trim() ? parseAmount(minText, base) : null, maxAmount: maxText.trim() ? parseAmount(maxText, base) : null };
  }

  const SECTIONS = [
    ['categories', 'Categories'],
    ['tags', 'Tags'],
    ['merchants', 'Merchants'],
    ['payment', 'Payment'],
    ['other', 'More'],
  ] as const;
</script>

<div class="stack">
  <div class="chips" role="group" aria-label="Filter sections">
    {#each SECTIONS as [id, label] (id)}
      {@const n = id === 'categories' ? arr('categoryIds').length : id === 'tags' ? arr('tagIds').length + arr('excludeTagIds').length : id === 'merchants' ? arr('merchantIds').length : id === 'payment' ? arr('paymentMethodIds').length : (value.kinds?.length ?? 0) + (value.channels?.length ?? 0) + (value.minAmount != null ? 1 : 0) + (value.maxAmount != null ? 1 : 0) + (value.hasAttachment != null ? 1 : 0)}
      <button type="button" class="chip" aria-pressed={section === id} onclick={() => (section = id)}>
        {label}{#if n}<span class="badge">{n}</span>{/if}
      </button>
    {/each}
  </div>

  {#if section === 'categories'}
    <MultiPick items={categoryItems()} bind:value={() => arr('categoryIds'), (v) => set('categoryIds', v)} placeholder="Search categories" />
  {:else if section === 'tags'}
    <div class="segmented mode" role="group" aria-label="Tag rule">
      <button type="button" aria-pressed={tagMode === 'include'} onclick={() => (tagMode = 'include')}>Include{#if arr('tagIds').length}&nbsp;({arr('tagIds').length}){/if}</button>
      <button type="button" aria-pressed={tagMode === 'exclude'} onclick={() => (tagMode = 'exclude')}>Exclude{#if arr('excludeTagIds').length}&nbsp;({arr('excludeTagIds').length}){/if}</button>
    </div>
    {#if tagMode === 'include'}
      <span class="hint">Only what has at least one of these tags.</span>
      <MultiPick items={tagItems()} bind:value={() => arr('tagIds'), (v) => setTags('tagIds', v)} placeholder="Search tags" />
    {:else}
      <span class="hint">Leave out anything with one of these tags, even if it matches everything else (e.g. Food, but not #work).</span>
      <MultiPick items={tagItems()} bind:value={() => arr('excludeTagIds'), (v) => setTags('excludeTagIds', v)} placeholder="Search tags" />
    {/if}
  {:else if section === 'merchants'}
    <MultiPick items={merchantItems()} bind:value={() => arr('merchantIds'), (v) => set('merchantIds', v)} placeholder="Search merchants" />
  {:else if section === 'payment'}
    <MultiPick items={paymentItems()} bind:value={() => arr('paymentMethodIds'), (v) => set('paymentMethodIds', v)} />
  {:else}
    {#if showKinds}
      <div class="field">
        <span class="label">Type</span>
        <div class="chips">
          {#each [['expense', 'Expenses'], ['refund', 'Refunds'], ['income', 'Income']] as [k, l] (k)}
            <button type="button" class="chip" aria-pressed={value.kinds?.includes(k as TxKind) ?? false} onclick={() => toggleKind(k as TxKind)}>{l}</button>
          {/each}
        </div>
      </div>
    {/if}
    <div class="field">
      <span class="label">Where</span>
      <div class="chips">
        <button type="button" class="chip" aria-pressed={value.channels?.includes('in_person') ?? false} onclick={() => toggleChannel('in_person')}>In person</button>
        <button type="button" class="chip" aria-pressed={value.channels?.includes('online') ?? false} onclick={() => toggleChannel('online')}>Online</button>
      </div>
    </div>
    <div class="field">
      <span class="label">Receipt</span>
      <div class="chips">
        <button type="button" class="chip" aria-pressed={value.hasAttachment === true} onclick={() => set('hasAttachment', value.hasAttachment === true ? null : true)}>With receipt</button>
        <button type="button" class="chip" aria-pressed={value.hasAttachment === false} onclick={() => set('hasAttachment', value.hasAttachment === false ? null : false)}>Without receipt</button>
      </div>
    </div>
    {#if showAmount}
      <div class="two">
        <label class="field"><span class="label">Min amount</span><input class="input" inputmode="decimal" bind:value={minText} onchange={amounts} /></label>
        <label class="field"><span class="label">Max amount</span><input class="input" inputmode="decimal" bind:value={maxText} onchange={amounts} /></label>
      </div>
    {/if}
  {/if}
</div>

<style>
  .mode {
    align-self: flex-start;
  }
  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--s2);
  }
</style>
