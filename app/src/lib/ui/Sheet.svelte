<!--
  Modal sheet: slides up from the bottom on phones, centred dialog on wide
  screens. Built on <dialog> for focus trapping, Escape and screen readers.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  let {
    open,
    title,
    onclose,
    children,
    footer,
    header,
    wide = false,
  }: {
    open: boolean;
    title: string;
    onclose: () => void;
    children: Snippet;
    footer?: Snippet;
    header?: Snippet;
    wide?: boolean;
  } = $props();

  let dlg: HTMLDialogElement | undefined = $state();

  $effect(() => {
    if (!dlg) return;
    if (open && !dlg.open) {
      dlg.showModal();
    } else if (!open && dlg.open) {
      dlg.close();
    }
  });

  function backdrop(e: MouseEvent) {
    if (e.target === dlg) onclose();
  }
</script>

<dialog
  bind:this={dlg}
  class:wide
  aria-label={title}
  onclose={() => open && onclose()}
  oncancel={(e) => {
    e.preventDefault();
    onclose();
  }}
  onclick={backdrop}
>
  {#if open}
    <div class="sheet">
      <div class="grabber" aria-hidden="true"></div>
      <header>
        {#if header}{@render header()}{:else}<h2>{title}</h2>{/if}
        <span class="spacer"></span>
        <button class="icon-btn" onclick={onclose} aria-label="Close"><Icon name="x" /></button>
      </header>
      <div class="body">
        {@render children()}
      </div>
      {#if footer}
        <footer>{@render footer()}</footer>
      {/if}
    </div>
  {/if}
</dialog>

<style>
  dialog {
    border: 0;
    padding: 0;
    margin: auto auto 0;
    width: 100%;
    max-width: 640px;
    max-height: 94dvh;
    background: transparent;
    color: var(--text);
    overflow: visible;
  }
  dialog.wide {
    max-width: 860px;
  }
  dialog::backdrop {
    background: rgba(0, 0, 0, 0.42);
    animation: fade 0.18s var(--ease);
  }
  .sheet {
    display: flex;
    flex-direction: column;
    max-height: 94dvh;
    background: var(--surface);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    box-shadow: 0 -8px 40px rgba(0, 0, 0, 0.18);
    animation: up 0.22s var(--ease);
    padding-bottom: env(safe-area-inset-bottom);
  }
  .grabber {
    width: 40px;
    height: 4px;
    border-radius: 2px;
    background: var(--border);
    margin: 8px auto 0;
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--s2);
    padding: var(--s2) var(--s3) var(--s2) var(--s4);
  }
  .body {
    overflow-y: auto;
    padding: var(--s2) var(--s4) var(--s4);
    overscroll-behavior: contain;
  }
  footer {
    display: flex;
    gap: var(--s2);
    padding: var(--s3) var(--s4);
    border-top: 1px solid var(--border);
    background: var(--surface);
  }
  @media (min-width: 700px) {
    dialog {
      margin: auto;
    }
    .sheet {
      border-radius: var(--radius-lg);
      max-height: 88dvh;
      animation: pop 0.18s var(--ease);
    }
    .grabber {
      display: none;
    }
    header {
      padding-top: var(--s3);
    }
  }
  @keyframes up {
    from {
      transform: translateY(40px);
      opacity: 0.4;
    }
  }
  @keyframes pop {
    from {
      transform: scale(0.97);
      opacity: 0;
    }
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
</style>
