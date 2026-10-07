<!--
  Bank CSV import: pick file → check columns (CIBC detected automatically) →
  review rows (duplicates, already-entered purchases and card payments are
  skipped by default) → import.
-->
<script lang="ts">
  import { repo } from '$lib/db/repo.svelte';
  import { router } from '$lib/ui/router.svelte';
  import { toasts } from '$lib/ui/toast.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import { parseCSV, guessMapping, buildRows, cleanDescriptor, commitImport, type ImportRow, type Mapping } from '$lib/importers';
  import { formatMoney } from '$lib/core/money';
  import { date as fmtDate, merchantName, txTitle } from '$lib/ui/format';
  import type { Transaction, TxKind } from '$lib/core/types';

  let fileName = $state('');
  let raw = $state<string[][]>([]);
  let mapping = $state<Mapping | null>(null);
  let preset = $state<'cibc' | 'generic'>('generic');
  let rows = $state<ImportRow[]>([]);
  let newNames = $state<Record<number, string>>({});
  let step = $state<1 | 2 | 3>(1);
  let busy = $state(false);
  let show = $state<'all' | 'import' | 'skip'>('all');

  const cols = $derived(Math.max(0, ...raw.slice(0, 5).map((r) => r.length)));
  const sample = $derived(raw.slice(mapping?.hasHeader ? 1 : 0, (mapping?.hasHeader ? 1 : 0) + 3));
  const toImport = $derived(rows.filter((r) => r.action === 'import'));
  const totals = $derived({
    import: toImport.length,
    duplicate: rows.filter((r) => r.reason === 'duplicate').length,
    matches: rows.filter((r) => r.reason === 'matches-existing').length,
    payment: rows.filter((r) => r.reason === 'payment').length,
    invalid: rows.filter((r) => r.reason === 'invalid').length,
  });
  const visible = $derived(rows.filter((r) => show === 'all' || r.action === show));
  const expenseCats = $derived(repo.categories());

  async function pick(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    fileName = f.name;
    raw = parseCSV(await f.text());
    if (!raw.length) {
      toasts.error('That file looks empty.');
      return;
    }
    const g = guessMapping(raw, repo.setting('baseCurrency'));
    preset = g.preset;
    const { preset: _p, ...m } = g;
    mapping = m;
    step = 2;
  }

  function preview() {
    if (!mapping) return;
    rows = buildRows(raw, mapping);
    const names: Record<number, string> = {};
    for (const r of rows) if (!r.merchantId && r.action === 'import') names[r.index] = cleanDescriptor(r.description);
    newNames = names;
    step = 3;
  }

  async function commit() {
    if (!mapping) return;
    busy = true;
    try {
      const map = new Map<number, string>();
      for (const [k, v] of Object.entries(newNames)) if (v.trim()) map.set(Number(k), v.trim());
      const n = await commitImport(rows, mapping, map);
      toasts.show(`Imported ${n} transaction${n === 1 ? '' : 's'}`, { tone: 'success' });
      const dates = toImport.map((r) => r.date).sort();
      router.go('/history', dates.length ? { from: dates[0], to: '9999-12-31', unit: 'days' } : {});
    } catch (err) {
      toasts.error(`Import failed: ${(err as Error).message}`);
    } finally {
      busy = false;
    }
  }

  function colLabel(i: number) {
    const head = mapping?.hasHeader ? raw[0]?.[i] : '';
    const ex = sample[0]?.[i] ?? '';
    return `${String.fromCharCode(65 + i)}${head ? ` · ${head}` : ''} — ${ex.slice(0, 28)}`;
  }

  const REASON: Record<ImportRow['reason'], string> = {
    '': '',
    duplicate: 'Already imported',
    'matches-existing': 'You already logged this',
    payment: 'Card payment / transfer',
    invalid: "Couldn't read",
  };
</script>

<div class="page wide">
  <div class="page-head">
    <a class="icon-btn" href="#/settings/data" aria-label="Back"><Icon name="chevronLeft" /></a>
    <h1>Import bank CSV</h1>
  </div>

  <ol class="steps">
    <li class:on={step >= 1}>File</li>
    <li class:on={step >= 2}>Columns</li>
    <li class:on={step >= 3}>Review</li>
  </ol>

  {#if step === 1}
    <section class="card stack">
      <p>Download a CSV from your bank's website and pick it here.</p>
      <p class="muted small"><strong>CIBC:</strong> online banking → choose the account → <em>Download transactions</em> → format “Spreadsheet (CSV)”. Do this for each card / account.</p>
      <label class="btn primary">
        <Icon name="upload" size={18} /> Choose CSV file
        <input type="file" accept=".csv,text/csv,.txt" class="sr-only" onchange={pick} />
      </label>
      <p class="faint small">The file never leaves this device except as normal synced transactions.</p>
    </section>
  {:else if step === 2 && mapping}
    <section class="card stack">
      <div class="row">
        <strong>{fileName}</strong>
        <span class="badge">{raw.length} rows</span>
        {#if preset === 'cibc'}<span class="badge good">CIBC format detected</span>{/if}
      </div>
      <label class="row"><input type="checkbox" bind:checked={mapping.hasHeader} /> First row is a header</label>
      <div class="grid2">
        <label class="field"><span class="label">Date column</span>
          <select class="select" bind:value={mapping.date}>{#each Array(cols) as _, i (i)}<option value={i}>{colLabel(i)}</option>{/each}</select>
        </label>
        <label class="field"><span class="label">Date order</span>
          <select class="select" bind:value={mapping.dateOrder}><option value="ymd">YYYY-MM-DD</option><option value="dmy">DD/MM/YYYY</option><option value="mdy">MM/DD/YYYY</option></select>
        </label>
        <label class="field"><span class="label">Description column</span>
          <select class="select" bind:value={mapping.description}>{#each Array(cols) as _, i (i)}<option value={i}>{colLabel(i)}</option>{/each}</select>
        </label>
        <div class="field">
          <span class="label">Amounts</span>
          <div class="segmented">
            <button aria-pressed={mapping.amount === null} onclick={() => mapping && ((mapping.amount = null), (mapping.debit = mapping.debit ?? 2), (mapping.credit = mapping.credit ?? 3))}>Debit + credit columns</button>
            <button aria-pressed={mapping.amount !== null} onclick={() => mapping && ((mapping.amount = mapping.amount ?? 2), (mapping.debit = null), (mapping.credit = null))}>One column</button>
          </div>
        </div>
        {#if mapping.amount === null}
          <label class="field"><span class="label">Money out (debit)</span>
            <select class="select" bind:value={mapping.debit}>{#each Array(cols) as _, i (i)}<option value={i}>{colLabel(i)}</option>{/each}</select>
          </label>
          <label class="field"><span class="label">Money in (credit)</span>
            <select class="select" bind:value={mapping.credit}>{#each Array(cols) as _, i (i)}<option value={i}>{colLabel(i)}</option>{/each}</select>
          </label>
        {:else}
          <label class="field"><span class="label">Amount column</span>
            <select class="select" bind:value={mapping.amount}>{#each Array(cols) as _, i (i)}<option value={i}>{colLabel(i)}</option>{/each}</select>
          </label>
          <label class="row"><input type="checkbox" bind:checked={mapping.negativeIsExpense} /> Purchases are negative numbers</label>
        {/if}
        <label class="field"><span class="label">Currency</span>
          <select class="select" bind:value={mapping.currency}>{#each repo.setting('currencies') as c (c)}<option value={c}>{c}</option>{/each}</select>
        </label>
        <label class="field"><span class="label">Paid with</span>
          <select class="select" bind:value={mapping.paymentMethodId}>
            <option value={null}>— (use merchant default)</option>
            {#each repo.paymentMethods() as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
          </select>
        </label>
      </div>
      <div class="row">
        <button class="btn" onclick={() => (step = 1)}>Back</button>
        <span class="spacer"></span>
        <button class="btn primary" onclick={preview}>Review rows <Icon name="chevronRight" size={16} /></button>
      </div>
    </section>
  {:else if step === 3}
    <section class="card stack">
      <div class="summary">
        <span><strong>{totals.import}</strong> to import</span>
        {#if totals.matches}<span>{totals.matches} already logged by you</span>{/if}
        {#if totals.duplicate}<span>{totals.duplicate} imported before</span>{/if}
        {#if totals.payment}<span>{totals.payment} card payments</span>{/if}
        {#if totals.invalid}<span class="status-bad">{totals.invalid} unreadable</span>{/if}
      </div>
      <p class="faint small">Rows you already entered by hand are linked to their bank line instead of being added twice. New merchant names are cleaned up from the bank text — edit them here and they'll be recognised automatically next time.</p>
      <div class="segmented">
        {#each [['all', 'All'], ['import', 'Importing'], ['skip', 'Skipped']] as [k, l] (k)}
          <button aria-pressed={show === k} onclick={() => (show = k as typeof show)}>{l}</button>
        {/each}
      </div>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th></th><th>Date</th><th>Bank text</th><th>Merchant</th><th>Category</th><th class="r">Amount</th></tr></thead>
          <tbody>
            {#each visible as r (r.index)}
              <tr class:skip={r.action === 'skip'}>
                <td><input type="checkbox" checked={r.action === 'import'} disabled={r.reason === 'invalid'} onchange={(e) => (r.action = (e.target as HTMLInputElement).checked ? 'import' : 'skip')} aria-label="Import this row" /></td>
                <td class="nowrap num">{r.date ? fmtDate(r.date) : '?'}</td>
                <td class="desc">
                  {r.description}
                  {#if r.reason}<span class="badge">{REASON[r.reason]}</span>{/if}
                  {#if r.matchId}
                    {@const t = repo.get<Transaction>(r.matchId)}
                    {#if t}<span class="faint tiny block">↔ {txTitle(t)}</span>{/if}
                  {/if}
                </td>
                <td>
                  {#if r.merchantId}
                    {merchantName(r.merchantId)}
                  {:else if r.action === 'import'}
                    <input class="input mini" bind:value={newNames[r.index]} placeholder="Merchant name" aria-label="New merchant name" />
                  {/if}
                </td>
                <td>
                  {#if r.action === 'import'}
                    <select class="select mini" bind:value={r.categoryId} aria-label="Category">
                      <option value={null}>—</option>
                      {#each expenseCats.filter((c) => c.kind === (r.kind === 'income' ? 'income' : 'expense')) as c (c.id)}<option value={c.id}>{c.parentId ? '  ' : ''}{c.icon} {c.name}</option>{/each}
                    </select>
                  {/if}
                </td>
                <td class="r num nowrap">
                  {#if r.action === 'import'}
                    <select class="select mini kind" bind:value={r.kind} aria-label="Type">
                      {#each [['expense', '−'], ['refund', '+ refund'], ['income', '+ income']] as [k, l] (k)}<option value={k as TxKind}>{l}</option>{/each}
                    </select>
                  {/if}
                  {formatMoney(r.amount, mapping?.currency ?? 'CAD')}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <div class="row">
        <button class="btn" onclick={() => (step = 2)}>Back</button>
        <span class="spacer"></span>
        <button class="btn primary" disabled={busy || !totals.import} onclick={commit}><Icon name="check" size={18} /> Import {totals.import}</button>
      </div>
    </section>
  {/if}
</div>

<style>
  .wide {
    --content-w: 1100px;
  }
  .steps {
    display: flex;
    gap: var(--s4);
    list-style: none;
    padding: 0;
    margin: 0 0 var(--s4);
    counter-reset: s;
    color: var(--text-faint);
    font-weight: 600;
    font-size: 0.85rem;
  }
  .steps li::before {
    counter-increment: s;
    content: counter(s);
    display: inline-grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    margin-right: 6px;
    background: var(--surface2);
  }
  .steps li.on {
    color: var(--text);
  }
  .steps li.on::before {
    background: var(--accent);
    color: var(--on-accent);
  }
  .grid2 {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: var(--s3);
  }
  .badge.good {
    background: color-mix(in srgb, var(--good) 18%, var(--surface));
    color: var(--text);
  }
  .summary {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s4);
  }
  .table-wrap {
    overflow-x: auto;
    max-height: 60vh;
  }
  .skip {
    opacity: 0.5;
  }
  .desc {
    min-width: 220px;
    font-size: 0.85rem;
  }
  .mini {
    min-height: 32px;
    padding: 2px 6px;
    font-size: 0.85rem;
    min-width: 120px;
  }
  .kind {
    min-width: 0;
    width: auto;
    margin-right: 6px;
  }
  .nowrap {
    white-space: nowrap;
  }
  .block {
    display: block;
  }
  label.btn {
    align-self: flex-start;
  }
</style>
