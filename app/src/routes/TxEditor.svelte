<!--
  The purchase entry sheet — the screen used most, so it is built for speed:
  amount → merchant (autocomplete fills category, payment method, channel…)
  → Save. Everything else lives under "Details".
-->
<script lang="ts">
  import { repo } from '$lib/db/repo.svelte';
  import { ui } from '$lib/ui/ui.svelte';
  import { toasts } from '$lib/ui/toast.svelte';
  import Sheet from '$lib/ui/Sheet.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import CategoryPicker from '$lib/ui/CategoryPicker.svelte';
  import TagInput from '$lib/ui/TagInput.svelte';
  import { parseAmount, toDecimalString, formatMoney, convert } from '$lib/core/money';
  import { makeOccurredAt, today, txDate, txTime, periodLabel } from '$lib/core/dates';
  import {
    saveTransaction,
    findOrCreateMerchant,
    deleteTransaction,
    frequentMerchants,
    type TxInput,
  } from '$lib/actions';
  import { money, merchantName, dayHeading } from '$lib/ui/format';
  import type { Channel, ID, Merchant, Split, Transaction, TxKind } from '$lib/core/types';
  import type { EntryRequest } from '$lib/ui/ui.svelte';
  import type { BudgetState } from '$lib/core/budgets';

  let { request }: { request: EntryRequest } = $props();

  // svelte-ignore state_referenced_locally
  const existing = request.id ? repo.get<Transaction>(request.id) : undefined;
  // svelte-ignore state_referenced_locally
  const copyOf = request.prefill?.copyOf ? repo.get<Transaction>(request.prefill.copyOf) : undefined;
  const src = existing ?? copyOf;
  // svelte-ignore state_referenced_locally
  const prefill = request.prefill ?? {};
  const base = repo.setting('baseCurrency');
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');

  interface SplitDraft {
    amountText: string;
    categoryId: ID | null;
    tagIds: ID[];
    note: string;
  }

  let kind = $state<TxKind>(src?.kind ?? prefill.kind ?? 'expense');
  let currency = $state(src?.currency ?? base);
  let amountText = $state(src ? toDecimalString(src.amount, src.currency) : '');
  let baseText = $state(existing && existing.currency !== existing.baseCurrency ? toDecimalString(existing.baseAmount, existing.baseCurrency) : '');
  let merchantId = $state<ID | null>(src?.merchantId ?? prefill.merchantId ?? null);
  let merchantText = $state(merchantName(src?.merchantId ?? prefill.merchantId));
  let categoryId = $state<ID | null>(src?.categoryId ?? prefill.categoryId ?? null);
  let name = $state(src?.name ?? '');
  let paymentMethodId = $state<ID | null>(src?.paymentMethodId ?? null);
  let channel = $state<Channel | null>(src?.channel ?? null);
  let tagIds = $state<ID[]>(src ? [...src.tagIds] : []);
  let description = $state(src?.description ?? '');
  let purpose = $state(src?.purpose ?? '');
  let date = $state(existing ? txDate(existing.occurredAt) : prefill.date ?? today());
  let time = $state(existing ? txTime(existing.occurredAt) : `${pad(now.getHours())}:${pad(now.getMinutes())}`);
  let splits = $state<SplitDraft[]>(
    src?.splits.map((s) => ({ amountText: toDecimalString(s.amount, src.currency), categoryId: s.categoryId, tagIds: [...s.tagIds], note: s.note })) ?? [],
  );
  let showDetails = $state(Boolean(existing && (existing.description || existing.purpose || existing.tagIds.length || existing.splits.length || existing.name)));
  let merchantFocus = $state(false);
  let highlighted = $state(0);
  let saving = $state(false);
  let attempted = $state(false);
  /** Fields the user set by hand — merchant defaults never overwrite these. */
  const touched = new Set<string>(src ? ['categoryId', 'paymentMethodId', 'channel', 'name', 'currency'] : []);

  let amountEl: HTMLInputElement | undefined = $state();
  let merchantEl: HTMLInputElement | undefined = $state();
  let saveEl: HTMLButtonElement | undefined = $state();

  const currencies = $derived(Array.from(new Set([base, ...repo.setting('currencies'), currency])));
  const amount = $derived(parseAmount(amountText, currency));
  const baseOverride = $derived(baseText.trim() ? parseAmount(baseText, base) : null);
  const estimatedBase = $derived(amount !== null && currency !== base ? convert(amount, currency, base, repo.setting('rates')[currency] ?? 1) : null);
  const splitAmounts = $derived(splits.map((s) => parseAmount(s.amountText, currency) ?? 0));
  const splitRemaining = $derived((amount ?? 0) - splitAmounts.reduce((a, b) => a + b, 0));
  const methods = $derived(repo.paymentMethods());

  const suggestions = $derived.by(() => {
    const q = merchantText.trim().toLowerCase();
    const freq = frequentMerchants();
    const all = repo.merchants();
    const scored = all
      .map((m) => {
        const n = m.name.toLowerCase();
        let s = freq.get(m.id) ?? 0;
        if (q) {
          if (n.startsWith(q)) s += 1000;
          else if (n.split(/\s+/).some((w) => w.startsWith(q))) s += 500;
          else if (n.includes(q)) s += 100;
          else return null;
        }
        return { m, s };
      })
      .filter((x): x is { m: Merchant; s: number } => x !== null)
      .sort((a, b) => b.s - a.s);
    return scored.slice(0, 6).map((x) => x.m);
  });
  const exactMerchant = $derived(repo.merchants(true).find((m) => m.name.toLowerCase() === merchantText.trim().toLowerCase()));

  const errors = $derived.by(() => {
    const e: Record<string, string> = {};
    if (amount === null || amount <= 0) e.amount = 'Enter an amount';
    if (kind !== 'income' && !merchantText.trim() && !name.trim()) e.merchant = 'Who did you pay?';
    if (!splits.length && !categoryId && kind !== 'income') e.category = 'Pick a category';
    if (splits.length && splitRemaining !== 0) e.splits = `Splits must add up to the total (${splitRemaining > 0 ? 'unassigned' : 'over by'} ${formatMoney(Math.abs(splitRemaining), currency)})`;
    if (splits.length && splits.some((s) => !s.categoryId)) e.splits = 'Every split needs a category';
    if (currency !== base && baseText.trim() && (baseOverride === null || baseOverride <= 0)) e.base = 'Not a valid amount';
    return e;
  });
  const valid = $derived(Object.keys(errors).length === 0);

  $effect(() => {
    // Focus the amount on open (keyboard pops up on phones).
    // Runs after the dialog's own focus handling; never steals focus from a field the user already chose.
    if (amountEl && !existing)
      setTimeout(() => {
        if (!document.activeElement?.matches('input, textarea, select')) amountEl?.focus();
      }, 30);
  });

  function selectMerchant(m: Merchant) {
    merchantId = m.id;
    merchantText = m.name;
    merchantFocus = false;
    const d = m.defaults;
    if (!touched.has('categoryId') && d.categoryId && !splits.length) categoryId = d.categoryId;
    if (!touched.has('paymentMethodId') && d.paymentMethodId) paymentMethodId = d.paymentMethodId;
    if (!touched.has('channel') && d.channel) channel = d.channel;
    if (!touched.has('name') && d.name && !name) name = d.name;
    if (!touched.has('currency') && d.currency && !amountText) currency = d.currency;
    // With a category known, Enter now saves.
    setTimeout(() => (categoryId ? saveEl?.focus() : undefined), 0);
  }

  function onMerchantInput() {
    merchantId = exactMerchant && !exactMerchant.archived ? exactMerchant.id : null;
    highlighted = 0;
    merchantFocus = true;
  }

  function merchantKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlighted = Math.min(highlighted + 1, suggestions.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlighted = Math.max(highlighted - 1, 0);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pickable = merchantText.trim() && suggestions[highlighted];
      if (pickable && merchantFocus) selectMerchant(suggestions[highlighted]);
      else if (valid) save();
      else merchantFocus = false;
    } else if (e.key === 'Escape' && merchantFocus) {
      e.stopPropagation();
      merchantFocus = false;
    }
  }

  function pickMethod(id: ID | null) {
    touched.add('paymentMethodId');
    paymentMethodId = paymentMethodId === id ? null : id;
    const pm = methods.find((p) => p.id === id);
    if (pm?.defaultChannel && !touched.has('channel')) channel = pm.defaultChannel;
  }

  function cycleCurrency() {
    touched.add('currency');
    const i = currencies.indexOf(currency);
    currency = currencies[(i + 1) % currencies.length];
  }

  function startSplit() {
    showDetails = true;
    splits = [
      { amountText: amountText, categoryId, tagIds: [], note: '' },
      { amountText: '', categoryId: null, tagIds: [], note: '' },
    ];
  }

  function close() {
    ui.closeEntry();
  }

  function budgetLine(s: BudgetState) {
    const per = periodLabel(s.range, s.budget.period.unit, repo.setting('dateFormat'));
    const tone: 'good' | 'warn' | 'bad' = s.status === 'over' ? 'bad' : s.status === 'warn' ? 'warn' : 'good';
    const icon = s.status === 'over' ? '⛔' : s.status === 'warn' ? '⚠️' : '✓';
    const what = s.remaining >= 0 ? `${money(s.remaining)} left` : `${money(-s.remaining)} over`;
    return { text: `${icon} ${s.budget.name}: ${what} · ${s.budget.period.unit === 'day' ? 'today' : per}`, tone };
  }

  async function save() {
    attempted = true;
    if (!valid || saving || amount === null) return;
    saving = true;
    try {
      let mid = merchantId;
      if (!mid && merchantText.trim()) mid = (await findOrCreateMerchant(merchantText)).id;
      const splitDocs: Split[] = splits.map((s, i) => ({ amount: splitAmounts[i], categoryId: s.categoryId, tagIds: s.tagIds, note: s.note.trim() }));
      const input: TxInput = {
        kind,
        occurredAt: makeOccurredAt(date, time),
        amount,
        currency,
        baseAmount: currency !== base ? baseOverride : null,
        merchantId: mid,
        name: name.trim(),
        categoryId: splits.length ? splits[0].categoryId : categoryId,
        paymentMethodId,
        channel,
        tagIds,
        description: description.trim(),
        purpose: purpose.trim(),
        splits: splitDocs,
        recurringId: existing?.recurringId ?? null,
        importRef: existing?.importRef ?? null,
        bankDescription: existing?.bankDescription ?? null,
      };
      const res = await saveTransaction(input, existing?.id);
      close();
      const where = mid ? ` at ${merchantName(mid)}` : '';
      const states = [...res.budgets].sort((a, b) => b.ratio - a.ratio).slice(0, 3);
      toasts.show(existing ? 'Saved changes' : `Saved ${formatMoney(amount, currency)}${where}`, {
        tone: 'success',
        detail: states.map(budgetLine),
        timeout: states.length ? 6500 : 3500,
        action: existing
          ? undefined
          : { label: 'Undo', run: () => deleteTransaction(res.tx.id) },
      });
    } catch (err) {
      toasts.error(`Could not save: ${(err as Error).message}`);
    } finally {
      saving = false;
    }
  }

  async function remove() {
    if (!existing) return;
    await deleteTransaction(existing.id);
    close();
    toasts.show('Deleted', { action: { label: 'Undo', run: () => repo.restore(existing.id) } });
  }

  function duplicate() {
    if (!existing) return;
    ui.openEntry({ prefill: { copyOf: existing.id } });
  }

  function globalKey(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      save();
    }
  }

  const KINDS: [TxKind, string][] = [
    ['expense', 'Expense'],
    ['refund', 'Refund'],
    ['income', 'Income'],
  ];
  const detailSummary = $derived(
    [
      date === today() ? `Today ${time}` : `${dayHeading(date).replace(/^.*· /, '')} ${time}`,
      methods.find((m) => m.id === paymentMethodId)?.name,
      channel === 'online' ? 'Online' : channel === 'in_person' ? 'In person' : null,
      tagIds.length ? `${tagIds.length} tag${tagIds.length > 1 ? 's' : ''}` : null,
      splits.length ? `${splits.length} splits` : null,
    ]
      .filter(Boolean)
      .join(' · '),
  );
</script>

<svelte:window onkeydown={globalKey} />

<Sheet open={true} title={existing ? 'Edit transaction' : 'New transaction'} onclose={close}>
  {#snippet header()}
    <div class="segmented" role="group" aria-label="Type">
      {#each KINDS as [k, label] (k)}
        <button type="button" aria-pressed={kind === k} onclick={() => (kind = k)}>{label}</button>
      {/each}
    </div>
  {/snippet}

  <form class="stack" onsubmit={(e) => { e.preventDefault(); save(); }} novalidate>
    <!-- Amount -->
    <div class="amount-row">
      <button type="button" class="currency" onclick={cycleCurrency} aria-label={`Currency ${currency}, tap to change`} title="Change currency">{currency}</button>
      <input
        bind:this={amountEl}
        class="amount"
        inputmode="decimal"
        autocomplete="off"
        placeholder="0.00"
        bind:value={amountText}
        aria-label="Amount"
        aria-invalid={attempted && !!errors.amount}
        enterkeyhint="next"
        onkeydown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            merchantEl?.focus();
          }
        }}
      />
    </div>
    {#if attempted && errors.amount}<span class="error-text">{errors.amount}</span>{/if}
    {#if currency !== base}
      <div class="field">
        <label for="base-amt">Amount in {base} <span class="faint">(from your statement — optional)</span></label>
        <input id="base-amt" class="input" inputmode="decimal" bind:value={baseText} placeholder={estimatedBase !== null ? `≈ ${toDecimalString(estimatedBase, base)} at saved rate` : ''} />
        {#if errors.base}<span class="error-text">{errors.base}</span>{/if}
      </div>
    {/if}

    <!-- Merchant -->
    <div class="field combo">
      <label for="merchant">{kind === 'income' ? 'From' : 'Merchant'}</label>
      <input
        bind:this={merchantEl}
        id="merchant"
        class="input"
        autocomplete="off"
        placeholder={kind === 'income' ? 'Employer, person…' : 'Where did you buy it?'}
        bind:value={merchantText}
        oninput={onMerchantInput}
        onfocus={() => (merchantFocus = true)}
        onblur={() => setTimeout(() => (merchantFocus = false), 150)}
        onkeydown={merchantKey}
        role="combobox"
        aria-expanded={merchantFocus && suggestions.length > 0}
        aria-controls="merchant-list"
        aria-autocomplete="list"
        enterkeyhint="done"
      />
      {#if merchantFocus && suggestions.length > 0}
        <div class="suggest" id="merchant-list" role="listbox">
          {#each suggestions as m, i (m.id)}
            <button
              type="button"
              role="option"
              aria-selected={i === highlighted}
              class="sugg-item"
              class:hl={i === highlighted}
              onmousedown={(e) => e.preventDefault()}
              onclick={() => selectMerchant(m)}
            >
              <Icon name="store" size={16} />
              <span>{m.name}</span>
              {#if m.defaults.categoryId}<span class="spacer"></span><span class="faint small">{repo.get<{ name: string } & Merchant>(m.defaults.categoryId)?.name}</span>{/if}
            </button>
          {/each}
        </div>
      {/if}
      {#if merchantText.trim() && !exactMerchant && !(merchantFocus && suggestions.length)}
        <span class="hint"><Icon name="plus" size={12} /> New merchant “{merchantText.trim()}” — its details will be remembered for next time</span>
      {/if}
      {#if attempted && errors.merchant}<span class="error-text">{errors.merchant}</span>{/if}
    </div>

    <!-- Category -->
    {#if !splits.length}
      <div class="field">
        <span class="label">Category</span>
        <CategoryPicker bind:value={categoryId} kind={kind === 'income' ? 'income' : 'expense'} onpick={() => touched.add('categoryId')} />
        {#if attempted && errors.category}<span class="error-text">{errors.category}</span>{/if}
      </div>
    {/if}

    <!-- Details -->
    <button type="button" class="details-toggle" aria-expanded={showDetails} onclick={() => (showDetails = !showDetails)}>
      <Icon name={showDetails ? 'chevronUp' : 'chevronDown'} size={18} />
      <span>Details</span>
      <span class="faint small summary">{detailSummary}</span>
    </button>

    {#if showDetails}
      <div class="details stack">
        <div class="field">
          <label for="item">What did you buy?</label>
          <input id="item" class="input" bind:value={name} oninput={() => touched.add('name')} placeholder="e.g. Coffee and a muffin" />
        </div>
        <div class="two">
          <div class="field">
            <label for="date">Date</label>
            <input id="date" type="date" class="input" bind:value={date} required />
          </div>
          <div class="field">
            <label for="time">Time</label>
            <input id="time" type="time" class="input" bind:value={time} />
          </div>
        </div>
        <div class="field">
          <span class="label">Payment method</span>
          <div class="chips">
            {#each methods as pm (pm.id)}
              <button type="button" class="chip" aria-pressed={paymentMethodId === pm.id} onclick={() => pickMethod(pm.id)}>
                <Icon name="card" size={15} />{pm.name}
              </button>
            {/each}
          </div>
        </div>
        <div class="field">
          <span class="label">Where</span>
          <div class="segmented" role="group" aria-label="Online or in person">
            <button type="button" aria-pressed={channel === 'in_person'} onclick={() => { touched.add('channel'); channel = channel === 'in_person' ? null : 'in_person'; }}>In person</button>
            <button type="button" aria-pressed={channel === 'online'} onclick={() => { touched.add('channel'); channel = channel === 'online' ? null : 'online'; }}>Online</button>
          </div>
        </div>
        <div class="field">
          <span class="label">Tags</span>
          <TagInput bind:value={tagIds} />
        </div>
        <div class="field">
          <label for="desc">Description</label>
          <textarea id="desc" class="textarea" bind:value={description} placeholder="Anything that will help you remember this later"></textarea>
        </div>
        <div class="field">
          <label for="purpose">Purpose</label>
          <input id="purpose" class="input" bind:value={purpose} placeholder="Why? e.g. Sam's birthday, work trip" />
        </div>

        <!-- Splits -->
        {#if splits.length}
          <div class="field">
            <span class="label">Split across categories</span>
            {#each splits as s, i (i)}
              <div class="split">
                <input class="input" inputmode="decimal" bind:value={s.amountText} aria-label={`Split ${i + 1} amount`} placeholder="0.00" />
                <select class="select" bind:value={s.categoryId} aria-label={`Split ${i + 1} category`}>
                  <option value={null}>Category…</option>
                  {#each repo.categories().filter((c) => c.kind === 'expense' && !c.parentId) as root (root.id)}
                    <optgroup label={root.name}>
                      <option value={root.id}>{root.icon} {root.name}</option>
                      {#each repo.categories().filter((c) => c.parentId === root.id) as c (c.id)}
                        <option value={c.id}>{c.icon} {c.name}</option>
                      {/each}
                    </optgroup>
                  {/each}
                </select>
                <input class="input" bind:value={s.note} placeholder="Note" aria-label={`Split ${i + 1} note`} />
                <button type="button" class="icon-btn" aria-label="Remove split" onclick={() => (splits = splits.filter((_, j) => j !== i))}><Icon name="x" size={18} /></button>
              </div>
            {/each}
            <div class="row">
              <button type="button" class="btn small" onclick={() => (splits = [...splits, { amountText: splitRemaining > 0 ? toDecimalString(splitRemaining, currency) : '', categoryId: null, tagIds: [], note: '' }])}>
                <Icon name="plus" size={16} /> Add split
              </button>
              <span class="spacer"></span>
              <span class="small num" class:status-bad={splitRemaining !== 0}>
                {splitRemaining === 0 ? 'Balanced ✓' : `${formatMoney(splitRemaining, currency)} unassigned`}
              </span>
            </div>
            {#if attempted && errors.splits}<span class="error-text">{errors.splits}</span>{/if}
          </div>
        {:else}
          <button type="button" class="btn small" onclick={startSplit}><Icon name="split" size={16} /> Split across categories</button>
        {/if}
      </div>
    {/if}
  </form>

  {#snippet footer()}
    {#if existing}
      <button type="button" class="icon-btn" onclick={remove} aria-label="Delete" title="Delete"><Icon name="trash" /></button>
      <button type="button" class="icon-btn" onclick={duplicate} aria-label="Duplicate" title="Duplicate"><Icon name="copy" /></button>
    {/if}
    <span class="spacer"></span>
    <button bind:this={saveEl} type="button" class="btn primary save" disabled={saving} onclick={save}>
      <Icon name="check" size={18} />
      {existing ? 'Save' : kind === 'income' ? 'Add income' : kind === 'refund' ? 'Add refund' : 'Add purchase'}
    </button>
  {/snippet}
</Sheet>

<style>
  .amount-row {
    display: flex;
    align-items: stretch;
    gap: var(--s2);
  }
  .currency {
    border: var(--border-w) solid var(--border);
    background: var(--surface2);
    border-radius: var(--radius);
    padding: 0 var(--s3);
    font-weight: 650;
    color: var(--text-muted);
    cursor: pointer;
    min-width: 64px;
  }
  .amount {
    flex: 1;
    min-width: 0;
    font-size: 2rem;
    font-weight: 650;
    font-family: var(--font-heading);
    padding: var(--s2) var(--s3);
    border-radius: var(--radius);
    border: max(1px, var(--border-w)) solid var(--border);
    background: var(--surface2);
    outline: none;
    font-variant-numeric: tabular-nums;
  }
  .amount:focus {
    border-color: var(--accent);
    background: var(--surface);
  }
  .combo {
    position: relative;
  }
  .suggest {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    z-index: 5;
    margin-top: 4px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 8px 24px var(--shadow);
    padding: 4px;
    max-height: 280px;
    overflow: auto;
  }
  .sugg-item {
    display: flex;
    align-items: center;
    gap: var(--s2);
    width: 100%;
    padding: 10px var(--s2);
    border: 0;
    background: transparent;
    border-radius: var(--radius-sm);
    cursor: pointer;
    text-align: left;
    color: var(--text);
  }
  .sugg-item.hl,
  .sugg-item:hover {
    background: var(--accent-soft);
  }
  
  .details-toggle {
    display: flex;
    align-items: center;
    gap: var(--s2);
    border: 0;
    background: transparent;
    padding: var(--s2) 0;
    cursor: pointer;
    color: var(--text);
    font-weight: 600;
    text-align: left;
  }
  .summary {
    margin-left: auto;
    font-weight: 400;
    text-align: right;
  }
  .details {
    padding-top: 0;
  }
  .two {
    display: grid;
    grid-template-columns: 1.4fr 1fr;
    gap: var(--s2);
  }
  .split {
    display: grid;
    grid-template-columns: 90px 1fr 1fr 40px;
    gap: var(--s2);
    align-items: center;
    margin-bottom: var(--s2);
  }
  @media (max-width: 520px) {
    .split {
      grid-template-columns: 90px 1fr 40px;
    }
    .split > input:nth-child(3) {
      grid-column: 1 / 3;
    }
  }
  .save {
    min-width: 160px;
    min-height: 46px;
  }
</style>
