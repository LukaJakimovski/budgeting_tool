<script lang="ts">
  import { repo } from '$lib/db/repo.svelte';
  import { availableModules } from '$lib/modules/registry';

  const enabled = $derived(repo.setting('modules'));
  const mods = availableModules();
</script>

<div class="stack">
  <p class="muted small">Modules add optional extras without cluttering the core app — for example a future gamification layer with quests and levels for staying under budget. Developers: see <code>docs/extending.md</code>.</p>
  {#each mods as m (m.id)}
    <label class="card row mod">
      <input type="checkbox" checked={!!enabled[m.id]} onchange={(e) => repo.setSetting('modules', { ...enabled, [m.id]: (e.target as HTMLInputElement).checked })} />
      <span class="grow"><strong>{m.name}</strong><span class="faint small">{m.description}</span></span>
    </label>
  {:else}
    <div class="card empty small">No modules installed yet.</div>
  {/each}
</div>

<style>
  .mod {
    cursor: pointer;
  }
  .mod input {
    width: 20px;
    height: 20px;
    accent-color: var(--accent);
  }
  .grow {
    flex: 1;
    display: flex;
    flex-direction: column;
  }
</style>
