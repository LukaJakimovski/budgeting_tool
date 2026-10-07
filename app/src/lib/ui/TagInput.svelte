<!-- Tag picker: selected tags as removable chips + type-ahead that can create new tags. -->
<script lang="ts">
  import { repo } from '../db/repo.svelte';
  import { findOrCreateTag } from '../actions';
  import Icon from './Icon.svelte';
  import type { ID, Tag } from '../core/types';

  let { value = $bindable(), placeholder = 'Add tag…' }: { value: ID[]; placeholder?: string } = $props();
  let text = $state('');
  let focused = $state(false);

  const suggestions = $derived.by(() => {
    const q = text.trim().replace(/^#/, '').toLowerCase();
    return repo
      .tags()
      .filter((t) => !value.includes(t.id) && (!q || t.name.toLowerCase().includes(q)))
      .slice(0, 8);
  });
  const exact = $derived(repo.tags().some((t) => t.name.toLowerCase() === text.trim().replace(/^#/, '').toLowerCase()));

  async function add(name: string) {
    const clean = name.trim().replace(/^#/, '');
    if (!clean) return;
    const t = await findOrCreateTag(clean);
    if (!value.includes(t.id)) value = [...value, t.id];
    text = '';
  }

  function key(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (suggestions[0] && !exact && text && suggestions[0].name.toLowerCase().startsWith(text.toLowerCase())) add(suggestions[0].name);
      else add(text);
    } else if (e.key === 'Backspace' && !text && value.length) {
      value = value.slice(0, -1);
    }
  }
</script>

<div class="tags">
  <div class="chips">
    {#each value as id (id)}
      {@const t = repo.get<Tag>(id)}
      <button type="button" class="chip selected" onclick={() => (value = value.filter((x) => x !== id))} aria-label={`Remove tag ${t?.name ?? ''}`}>
        #{t?.name ?? '?'} <span class="x"><Icon name="x" size={14} /></span>
      </button>
    {/each}
    <input
      class="input tag-input"
      bind:value={text}
      {placeholder}
      onkeydown={key}
      onfocus={() => (focused = true)}
      onblur={() => setTimeout(() => (focused = false), 150)}
      aria-label="Add a tag"
      enterkeyhint="done"
    />
  </div>
  {#if focused && (suggestions.length || (text.trim() && !exact))}
    <div class="chips sugg">
      {#each suggestions as t (t.id)}
        <button type="button" class="chip" onmousedown={(e) => e.preventDefault()} onclick={() => add(t.name)}>#{t.name}</button>
      {/each}
      {#if text.trim() && !exact}
        <button type="button" class="chip" onmousedown={(e) => e.preventDefault()} onclick={() => add(text)}>
          <Icon name="plus" size={14} /> Create “{text.trim().replace(/^#/, '')}”
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .tag-input {
    flex: 1;
    min-width: 120px;
    width: auto;
    min-height: 34px;
    border-radius: 999px;
  }
  .sugg {
    margin-top: var(--s2);
  }
</style>
