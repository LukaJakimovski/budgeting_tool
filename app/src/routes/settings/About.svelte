<script lang="ts">
  import Logo from '$lib/ui/Logo.svelte';
  import { platform } from '$lib/platform';
  import { repo } from '$lib/db/repo.svelte';
  const DOCS = 'https://github.com/LukaJakimovski/budgeting_tool/blob/main/docs';
</script>

<div class="stack">
  <section class="card stack">
    <div class="row"><Logo size={40} /><div><h2>Tally {__APP_VERSION__}</h2><span class="faint small">{platform()} · device {repo.deviceId}</span></div></div>
    <p class="muted small">Local-first budgeting. Your data is stored on your devices and, if you choose, synced through your own server.</p>
  </section>
  <section class="card stack">
    <h2>Guides</h2>
    <ul class="links">
      <li><a href={`${DOCS}/user-guide.md`} target="_blank" rel="noreferrer">User guide</a></li>
      <li><a href={`${DOCS}/self-hosting.md`} target="_blank" rel="noreferrer">Self-hosting the sync server (Raspberry Pi + Tailscale)</a></li>
      <li><a href={`${DOCS}/data-format.md`} target="_blank" rel="noreferrer">Data format (for scripts)</a></li>
      <li><a href={`${DOCS}/theming.md`} target="_blank" rel="noreferrer">Making your own styles</a></li>
      <li><a href={`${DOCS}/architecture.md`} target="_blank" rel="noreferrer">How it works</a></li>
    </ul>
  </section>
  <section class="card stack">
    <h2>Keyboard</h2>
    <table class="data small">
      <tbody>
        <tr><td><kbd>N</kbd></td><td>New purchase</td></tr>
        <tr><td><kbd>Enter</kbd> in amount</td><td>Jump to merchant</td></tr>
        <tr><td><kbd>↑</kbd> <kbd>↓</kbd> <kbd>Enter</kbd> in merchant</td><td>Pick a suggestion (fills defaults)</td></tr>
        <tr><td><kbd>Ctrl</kbd>+<kbd>Enter</kbd></td><td>Save from anywhere in the form</td></tr>
        <tr><td><kbd>Esc</kbd></td><td>Close</td></tr>
        <tr><td><kbd>←</kbd> <kbd>→</kbd> on a chart</td><td>Read values</td></tr>
      </tbody>
    </table>
  </section>
</div>

<style>
  .links {
    margin: 0;
    padding-left: 1.2em;
    line-height: 2;
  }
  kbd {
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    border-radius: 4px;
    padding: 0 5px;
    font-family: inherit;
    font-size: 0.85em;
  }
</style>
