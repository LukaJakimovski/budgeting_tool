<script lang="ts">
  import { repo } from '../db/repo.svelte';
  import { ui } from './ui.svelte';
  import { money, categoryIcon, categoryLabel, merchantName, txTitle } from './format';
  import { formatMoney } from '../core/money';
  import { txTime } from '../core/dates';
  import type { Tag, Transaction } from '../core/types';

  let { tx, showDate = '' }: { tx: Transaction; showDate?: string } = $props();

  const sub = $derived.by(() => {
    const bits: string[] = [];
    const m = merchantName(tx.merchantId);
    if (m && tx.name) bits.push(m);
    bits.push(tx.splits.length ? `Split · ${tx.splits.length} categories` : categoryLabel(tx.categoryId));
    for (const id of tx.tagIds) {
      const t = repo.get<Tag>(id);
      if (t) bits.push('#' + t.name);
    }
    return bits.join(' · ');
  });
  const base = $derived(repo.setting('baseCurrency'));
  const sign = $derived(tx.kind === 'expense' ? '' : '+');
</script>

<button type="button" class="list-item tx" onclick={() => ui.openEntry({ id: tx.id })}>
  <span class="ico" aria-hidden="true">{tx.splits.length ? '✂️' : categoryIcon(tx.categoryId)}</span>
  <span class="main">
    <span class="title">{txTitle(tx)}</span>
    <span class="sub faint small">{showDate ? showDate + ' · ' : ''}{txTime(tx.occurredAt)} · {sub}</span>
  </span>
  <span class="amt num" class:inc={tx.kind !== 'expense'}>
    {sign}{money(tx.baseAmount, tx.baseCurrency)}
    {#if tx.currency !== base}<span class="tiny faint orig">{formatMoney(tx.amount, tx.currency)}</span>{/if}
  </span>
</button>

<style>
  .tx {
    padding: 10px var(--s2);
  }
  .ico {
    width: 36px;
    height: 36px;
    border-radius: var(--radius);
    background: var(--surface2);
    display: grid;
    place-items: center;
    font-size: 1.1rem;
    flex-shrink: 0;
  }
  .main {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }
  .title {
    font-weight: 550;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sub {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .amt {
    font-weight: 600;
    text-align: right;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
  }
  .amt.inc {
    color: color-mix(in srgb, var(--good) 70%, var(--text));
  }
  .orig {
    font-weight: 400;
  }
</style>
