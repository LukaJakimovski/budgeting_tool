<script lang="ts">
  import { repo } from '$lib/db/repo.svelte';
  import { toasts } from '$lib/ui/toast.svelte';
  import { COMMON_CURRENCIES } from '$lib/core/money';
  import { DATE_FORMAT_LABELS, WEEKDAYS_LONG, type DateFormat } from '$lib/core/dates';
  import Icon from '$lib/ui/Icon.svelte';

  const base = $derived(repo.setting('baseCurrency'));
  const currencies = $derived(repo.setting('currencies'));
  const rates = $derived(repo.setting('rates'));
  let addCode = $state('');

  async function setBase(code: string) {
    const n = repo.list('transaction').filter((t) => t.baseCurrency !== code).length;
    await repo.setSetting('baseCurrency', code);
    if (!currencies.includes(code)) await repo.setSetting('currencies', [code, ...currencies]);
    if (n) toasts.show(`Base currency is now ${code}. ${n} older transactions are converted with your saved rates when shown.`, { timeout: 7000 });
  }
  async function addCurrency() {
    const c = addCode.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(c) || currencies.includes(c)) return;
    await repo.setSetting('currencies', [...currencies, c]);
    addCode = '';
  }
  async function setRate(code: string, v: string) {
    const n = Number(v.replace(',', '.'));
    if (!(n > 0)) return;
    await repo.setSetting('rates', { ...rates, [code]: n });
  }
</script>

<div class="stack">
  <section class="card stack">
    <h2>Money</h2>
    <label class="field">
      <span class="label">Base currency</span>
      <select class="select" value={base} onchange={(e) => setBase((e.target as HTMLSelectElement).value)}>
        {#each Array.from(new Set([base, ...COMMON_CURRENCIES])) as c (c)}<option value={c}>{c}</option>{/each}
      </select>
      <span class="hint">Totals, budgets and charts are in this currency.</span>
    </label>

    <div class="field">
      <span class="label">Currencies in the entry form</span>
      <div class="chips">
        {#each currencies as c (c)}
          <span class="chip">{c}{#if c !== base}<button class="x-btn" aria-label={`Remove ${c}`} onclick={() => repo.setSetting('currencies', currencies.filter((x) => x !== c))}><Icon name="x" size={13} /></button>{/if}</span>
        {/each}
        <input class="input code" placeholder="Add (e.g. USD)" bind:value={addCode} maxlength="3" onkeydown={(e) => e.key === 'Enter' && addCurrency()} />
      </div>
    </div>

    {#if currencies.some((c) => c !== base)}
      <div class="field">
        <span class="label">Exchange rates (1 unit = ? {base})</span>
        {#each currencies.filter((c) => c !== base) as c (c)}
          <div class="row rate">
            <span>1 {c} =</span>
            <input class="input" inputmode="decimal" value={rates[c] ?? ''} onchange={(e) => setRate(c, (e.target as HTMLInputElement).value)} aria-label={`Rate for ${c}`} />
            <span>{base}</span>
          </div>
        {/each}
        <span class="hint">Used to estimate the {base} value of foreign purchases. When you know the exact amount from your card statement, enter it on the purchase instead.</span>
      </div>
    {/if}
  </section>

  <section class="card stack">
    <h2>Calendar</h2>
    <label class="field">
      <span class="label">Weeks start on</span>
      <select class="select" value={repo.setting('weekStart')} onchange={(e) => repo.setSetting('weekStart', Number((e.target as HTMLSelectElement).value))}>
        {#each WEEKDAYS_LONG as d, i (d)}<option value={i}>{d}</option>{/each}
      </select>
    </label>
    <label class="field">
      <span class="label">Months start on day</span>
      <input class="input" type="number" min="1" max="28" value={repo.setting('monthStartDay')} onchange={(e) => repo.setSetting('monthStartDay', Math.min(28, Math.max(1, Number((e.target as HTMLInputElement).value) || 1)))} />
      <span class="hint">Use your payday (e.g. 15) if you budget pay-to-pay.</span>
    </label>
    <label class="field">
      <span class="label">Date format</span>
      <select class="select" value={repo.setting('dateFormat')} onchange={(e) => repo.setSetting('dateFormat', (e.target as HTMLSelectElement).value as DateFormat)}>
        {#each Object.entries(DATE_FORMAT_LABELS) as [k, l] (k)}<option value={k}>{l}</option>{/each}
      </select>
      <span class="hint">Times are always 24-hour. Data is always stored as ISO 8601.</span>
    </label>
  </section>

  <section class="card stack">
    <h2>Reminders</h2>
    <label class="field">
      <span class="label">Remind me to back up every (days, 0 = never)</span>
      <input class="input" type="number" min="0" max="365" value={repo.setting('backupReminderDays')} onchange={(e) => repo.setSetting('backupReminderDays', Math.max(0, Number((e.target as HTMLInputElement).value) || 0))} />
      <span class="hint">Only shown when sync is off — the sync server backs up automatically.</span>
    </label>
  </section>
</div>

<style>
  .code {
    width: 130px;
    min-height: 34px;
    text-transform: uppercase;
  }
  .x-btn {
    border: 0;
    background: transparent;
    padding: 0;
    margin-left: 4px;
    color: inherit;
    cursor: pointer;
    display: inline-grid;
  }
  .rate .input {
    max-width: 140px;
  }
</style>
