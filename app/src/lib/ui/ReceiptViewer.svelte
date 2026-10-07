<!-- Full-size view of a receipt, with save/share and (in the editor) remove. -->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import Sheet from './Sheet.svelte';
  import Icon from './Icon.svelte';
  import { loadAttachment, formatBytes } from '../attachments';
  import { saveFile } from '../platform';
  import { toasts } from './toast.svelte';
  import type { Attachment } from '../core/types';

  let { att, onclose, onremove }: { att: Attachment; onclose: () => void; onremove?: () => void } = $props();

  let blob = $state<Blob | null>(null);
  let url = $state<string | null>(null);
  let status = $state<'loading' | 'ready' | 'missing'>('loading');
  let zoom = $state(false);

  $effect(() => {
    loadAttachment(att)
      .then((b) => {
        blob = b;
        if (b) {
          url = URL.createObjectURL(b);
          status = 'ready';
        } else status = 'missing';
      })
      .catch(() => (status = 'missing'));
  });
  onDestroy(() => url && URL.revokeObjectURL(url));

  async function save() {
    if (!blob) return;
    try {
      await saveFile(att.name, new Uint8Array(await blob.arrayBuffer()), att.mime);
    } catch (err) {
      toasts.error((err as Error).message);
    }
  }
</script>

<Sheet open={true} title={att.name} {onclose} wide>
  <div class="viewer" class:zoom>
    {#if status === 'loading'}
      <p class="muted">Loading…</p>
    {:else if status === 'missing'}
      <div class="empty">
        <Icon name="cloudOff" size={28} />
        <p>This file isn't on this device, and the sync server doesn't have it (yet). If it was added on another device, it appears once that device syncs.</p>
      </div>
    {:else if att.mime.startsWith('image/') && url}
      <button type="button" class="imgbtn" onclick={() => (zoom = !zoom)} aria-label={zoom ? 'Fit to screen' : 'Zoom in'}>
        <img src={url} alt={att.name} />
      </button>
    {:else if att.mime === 'application/pdf' && url}
      <object data={url} type="application/pdf" title={att.name}>
        <div class="empty"><Icon name="file" size={32} /><p>PDF preview isn't available here — use Save to open it.</p></div>
      </object>
    {/if}
  </div>
  <p class="faint small meta">{formatBytes(att.size)}{att.width ? ` · ${att.width}×${att.height}` : ''} · added {att.addedAt.slice(0, 10)}</p>
  {#snippet footer()}
    {#if onremove}
      <button type="button" class="btn danger" onclick={onremove}><Icon name="trash" size={16} /> Remove</button>
    {/if}
    <span class="spacer"></span>
    <button type="button" class="btn" disabled={!blob} onclick={save}><Icon name="download" size={16} /> Save</button>
    <button type="button" class="btn primary" onclick={onclose}>Done</button>
  {/snippet}
</Sheet>

<style>
  .viewer {
    display: flex;
    justify-content: center;
    min-height: 200px;
  }
  .imgbtn {
    border: 0;
    padding: 0;
    background: transparent;
    cursor: zoom-in;
    max-width: 100%;
  }
  img {
    max-width: 100%;
    max-height: 70dvh;
    object-fit: contain;
    border-radius: var(--radius);
    display: block;
  }
  .zoom .imgbtn {
    cursor: zoom-out;
    overflow: auto;
  }
  .zoom img {
    max-width: none;
    max-height: none;
  }
  object {
    width: 100%;
    height: 70dvh;
    border: 0;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s2);
    text-align: center;
    color: var(--text-muted);
    padding: var(--s5);
  }
  .meta {
    text-align: center;
    margin-top: var(--s2);
  }
</style>
