<script lang="ts">
  import { repo } from '$lib/db/repo.svelte';
  import { toasts } from '$lib/ui/toast.svelte';
  import Sheet from '$lib/ui/Sheet.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import CategoryPicker from '$lib/ui/CategoryPicker.svelte';
  import { describeSchedule, nextOccurrence } from '$lib/core/recurring';
  import { parseAmount, toDecimalString, formatMoney } from '$lib/core/money';
  import { today } from '$lib/core/dates';
  import { runRecurring, findOrCreateMerchant } from '$lib/actions';
  import { date as fmtDate, merchantName } from '$lib/ui/format';
  import type { Recurring, RecurringFreq, TxKind } from '$lib/core/types';

  type Draft = Omit<Recurring, 'id' | 'type' | 'rev' | 'createdAt'> & { id?: string; amountText: string; merchantText: string };
  let editing = $state<Draft | null>(null);
  const rules = $derived(repo.list('recurring').sort((a, b) => a.name.localeCompare(b.name)));

  function blank(): Draft {
    const base = repo.setting('baseCurrency');
    return {
      name: '', freq: 'month', interval: 1, startDate: today(), endDate: null, mode: 'confirm', active: true,
      template: { kind: 'expense', amount: 0, currency: base, merchantId: null, name: '', categoryId: null, paymentMethodId: null, channel: null, tagIds: [], description: '', purpose: '', time: '09:00' },
      amountText: '', merchantText: '',
    };
  }
  function open(r?: Recurring) {
    editing = r
      ? { ...structuredClone($state.snapshot(r)), amountText: toDecimalString(r.template.amount, r.template.currency), merchantText: merchantName(r.template.merchantId) }
      : blank();
  }
  async function save() {
    if (!editing) return;
    const amount = parseAmount(editing.amountText, editing.template.currency);
    if (!editing.name.trim() || !amount) {
      toasts.error('Give it a name and an amount');
      return;
    }
    const merchantId = editing.merchantText.trim() ? (await findOrCreateMerchant(editing.merchantText)).id : null;
    const { amountText: _a, merchantText: _m, id, ...rest } = editing;
    const doc = { ...rest, name: rest.name.trim(), template: { ...rest.template, amount, merchantId } };
    if (id) await repo.update<Recurring>(id, doc);
    else await repo.create('recurring', doc);
    editing = null;
    const n = await runRecurring();
    if (n) toasts.show(`Added ${n} past occurrence${n > 1 ? 's' : ''}`);
  }
</script>

<div class="stack">
  <p class="muted small">Rent, subscriptions, salary… <strong>Automatic</strong> rules add the transaction on its date. <strong>Ask first</strong> rules show up on Home for you to confirm or skip (good when the amount varies).</p>
  <div class="card list">
    {#each rules as r (r.id)}
      {@const next = nextOccurrence(r, today())}
      <button class="list-item" class:off={!r.active} onclick={() => open(r)}>
        <Icon name="repeat" size={18} />
        <span class="grow">
          <strong>{r.name}</strong>
          <span class="faint small">{describeSchedule(r)} · {r.mode === 'auto' ? 'automatic' : 'ask first'}{next && r.active ? ` · next ${fmtDate(next)}` : ''}{!r.active ? ' · paused' : ''}</span>
        </span>
        <span class="num">{r.template.kind === 'income' ? '+' : ''}{formatMoney(r.template.amount, r.template.currency)}</span>
      </button>
    {:else}
      <p class="empty small">No recurring transactions.</p>
    {/each}
  </div>
  <button class="btn" onclick={() => open()}><Icon name="plus" size={16} /> Add recurring</button>
</div>

{#if editing}
  <Sheet open={true} title={editing.id ? 'Edit recurring' : 'New recurring'} onclose={() => (editing = null)}>
    <div class="stack">
      <div class="segmented" role="group" aria-label="Type">
        {#each [['expense', 'Expense'], ['income', 'Income']] as [k, l] (k)}
          <button aria-pressed={editing.template.kind === k} onclick={() => editing && (editing.template.kind = k as TxKind)}>{l}</button>
        {/each}
      </div>
      <label class="field"><span class="label">Name</span><input class="input" bind:value={editing.name} placeholder="e.g. Rent, Spotify, Salary" /></label>
      <div class="two">
        <label class="field"><span class="label">Amount</span><input class="input" inputmode="decimal" bind:value={editing.amountText} /></label>
        <label class="field"><span class="label">Currency</span>
          <select class="select" bind:value={editing.template.currency}>
            {#each repo.setting('currencies') as c (c)}<option value={c}>{c}</option>{/each}
          </select>
        </label>
      </div>
      <label class="field"><span class="label">{editing.template.kind === 'income' ? 'From' : 'Merchant'}</span><input class="input" bind:value={editing.merchantText} /></label>
      <div class="field"><span class="label">Category</span><CategoryPicker bind:value={editing.template.categoryId} kind={editing.template.kind === 'income' ? 'income' : 'expense'} /></div>
      <label class="field">
        <span class="label">Payment method</span>
        <select class="select" bind:value={editing.template.paymentMethodId}>
          <option value={null}>—</option>
          {#each repo.paymentMethods() as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
        </select>
      </label>
      <div class="field">
        <span class="label">Repeats</span>
        <div class="row">
          <span>Every</span>
          <input class="input n" type="number" min="1" max="60" bind:value={editing.interval} aria-label="Interval" />
          <select class="select" bind:value={editing.freq} aria-label="Frequency">
            {#each ['day', 'week', 'month', 'year'] as f (f)}<option value={f as RecurringFreq}>{f}{editing.interval > 1 ? 's' : ''}</option>{/each}
          </select>
        </div>
      </div>
      <div class="two">
        <label class="field"><span class="label">Starting</span><input class="input" type="date" bind:value={editing.startDate} /></label>
        <label class="field"><span class="label">Until (optional)</span><input class="input" type="date" value={editing.endDate ?? ''} onchange={(e) => editing && (editing.endDate = (e.target as HTMLInputElement).value || null)} /></label>
      </div>
      <div class="segmented" role="group" aria-label="Mode">
        <button aria-pressed={editing.mode === 'confirm'} onclick={() => editing && (editing.mode = 'confirm')}>Ask first</button>
        <button aria-pressed={editing.mode === 'auto'} onclick={() => editing && (editing.mode = 'auto')}>Automatic</button>
      </div>
      <label class="row"><input type="checkbox" bind:checked={editing.active} /> Active</label>
    </div>
    {#snippet footer()}
      {#if editing?.id}<button class="icon-btn" aria-label="Delete" onclick={async () => { await repo.remove(editing!.id!); editing = null; }}><Icon name="trash" /></button>{/if}
      <span class="spacer"></span>
      <button class="btn" onclick={() => (editing = null)}>Cancel</button>
      <button class="btn primary" onclick={save}>Save</button>
    {/snippet}
  </Sheet>
{/if}

<style>
  .list {
    padding: var(--s1);
  }
  .grow {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .off {
    opacity: 0.55;
  }
  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--s2);
  }
  .n {
    width: 80px;
  }
</style>
