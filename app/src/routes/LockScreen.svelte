<script lang="ts">
  import Logo from '$lib/ui/Logo.svelte';
  import { lock } from '$lib/lock.svelte';
  import Icon from '$lib/ui/Icon.svelte';

  let pin = $state('');
  let error = $state(false);
  let checking = $state(false);

  async function press(d: string) {
    if (checking) return;
    error = false;
    pin = (pin + d).slice(0, 12);
    if (pin.length >= 4) {
      checking = true;
      const ok = await lock.unlock(pin);
      checking = false;
      if (!ok && pin.length >= 8) {
        error = true;
        pin = '';
      }
    }
  }
  async function submit() {
    checking = true;
    const ok = await lock.unlock(pin);
    checking = false;
    if (!ok) {
      error = true;
      pin = '';
    }
  }
  function key(e: KeyboardEvent) {
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') pin = pin.slice(0, -1);
    else if (e.key === 'Enter') submit();
  }
</script>

<svelte:window onkeydown={key} />

<div class="lock" role="dialog" aria-modal="true" aria-label="Tally is locked">
  <Logo size={56} />
  <h1>Tally is locked</h1>
  <div class="dots" class:error aria-live="polite" aria-label={`${pin.length} digits entered`}>
    {#each Array(Math.max(4, pin.length)) as _, i (i)}<span class:on={i < pin.length}></span>{/each}
  </div>
  {#if error}<p class="error-text">Wrong PIN</p>{/if}
  <div class="pad">
    {#each ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as d (d)}
      <button onclick={() => press(d)}>{d}</button>
    {/each}
    <button onclick={() => (pin = pin.slice(0, -1))} aria-label="Delete"><Icon name="chevronLeft" /></button>
    <button onclick={() => press('0')}>0</button>
    <button onclick={submit} aria-label="Unlock"><Icon name="check" /></button>
  </div>
  <p class="faint small">Forgot it? Clear this app's data and sync again from your server or restore a backup.</p>
</div>

<style>
  .lock {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: var(--bg);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--s4);
    padding: var(--s5);
    text-align: center;
  }
  .dots {
    display: flex;
    gap: 12px;
  }
  .dots span {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid var(--text-muted);
  }
  .dots span.on {
    background: var(--text);
    border-color: var(--text);
  }
  .dots.error span {
    border-color: var(--bad);
  }
  .pad {
    display: grid;
    grid-template-columns: repeat(3, 72px);
    gap: 14px;
  }
  .pad button {
    height: 72px;
    border-radius: 50%;
    border: 0;
    background: var(--surface2);
    font-size: 1.5rem;
    font-weight: 600;
    cursor: pointer;
    display: grid;
    place-items: center;
  }
  .pad button:active {
    background: var(--surface3);
  }
  p {
    max-width: 320px;
  }
</style>
