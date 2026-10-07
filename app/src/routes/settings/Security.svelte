<script lang="ts">
  import { lock } from '$lib/lock.svelte';
  import { sync } from '$lib/sync/sync.svelte';
  import { toasts } from '$lib/ui/toast.svelte';

  let pin = $state('');
  let pin2 = $state('');
  let current = $state('');

  async function setPin() {
    if (!/^\d{4,12}$/.test(pin)) return toasts.error('Use 4–12 digits');
    if (pin !== pin2) return toasts.error("PINs don't match");
    if (lock.enabled && !(await lock.check(current))) return toasts.error('Current PIN is wrong');
    await lock.setPin(pin);
    pin = pin2 = current = '';
    toasts.show('PIN set', { tone: 'success' });
  }
  async function removePin() {
    if (!(await lock.check(current))) return toasts.error('Current PIN is wrong');
    await lock.remove();
    current = '';
    toasts.show('PIN removed');
  }
</script>

<div class="stack">
  <section class="card stack">
    <h2>App PIN</h2>
    <p class="muted small">Locks Tally on this device when it's been in the background. It's a privacy screen against casual snooping — your phone's own lock and storage encryption protect the data itself.</p>
    {#if lock.enabled}
      <label class="field"><span class="label">Current PIN</span><input class="input" type="password" inputmode="numeric" bind:value={current} autocomplete="off" /></label>
    {/if}
    <label class="field"><span class="label">{lock.enabled ? 'New PIN' : 'PIN'}</span><input class="input" type="password" inputmode="numeric" bind:value={pin} autocomplete="off" /></label>
    <label class="field"><span class="label">Repeat</span><input class="input" type="password" inputmode="numeric" bind:value={pin2} autocomplete="off" /></label>
    <div class="row wrap">
      <button class="btn primary" onclick={setPin}>{lock.enabled ? 'Change PIN' : 'Set PIN'}</button>
      {#if lock.enabled}
        <button class="btn danger" onclick={removePin}>Remove PIN</button>
        <button class="btn" onclick={() => lock.lockNow()}>Lock now</button>
      {/if}
    </div>
    {#if lock.enabled}
      <label class="field">
        <span class="label">Lock after the app has been in the background for</span>
        <select class="select" value={lock.timeout} onchange={(e) => lock.setTimeout(Number((e.target as HTMLSelectElement).value))}>
          <option value={0}>Immediately</option>
          <option value={1}>1 minute</option>
          <option value={5}>5 minutes</option>
          <option value={15}>15 minutes</option>
          <option value={60}>1 hour</option>
        </select>
      </label>
    {/if}
  </section>

  <section class="card stack">
    <h2>Sync privacy</h2>
    {#if sync.config}
      <p class="muted small">
        Vault “{sync.config.vault}” is {sync.config.encrypted ? 'end-to-end encrypted: data is encrypted on this device with a key derived from your passphrase, and the server only stores ciphertext.' : 'not end-to-end encrypted: the server can read your data. Over Tailscale it is still encrypted in transit and never leaves your network.'}
      </p>
    {:else}
      <p class="muted small">Sync is off. When you create a vault you can choose end-to-end encryption.</p>
    {/if}
  </section>
</div>
