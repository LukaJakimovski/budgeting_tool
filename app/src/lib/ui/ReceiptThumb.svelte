<!-- Small preview of an attachment; loads (and if needed downloads) the bytes lazily. -->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { loadAttachment } from '../attachments';
  import Icon from './Icon.svelte';
  import type { Attachment } from '../core/types';

  let { att, onopen, onremove, size = 72 }: { att: Attachment; onopen?: () => void; onremove?: () => void; size?: number } = $props();

  let url = $state<string | null>(null);
  let status = $state<'loading' | 'ready' | 'missing' | 'error'>('loading');

  $effect(() => {
    let cancelled = false;
    status = 'loading';
    if (att.mime.startsWith('image/')) {
      loadAttachment(att)
        .then((blob) => {
          if (cancelled) return;
          if (!blob) status = 'missing';
          else {
            url = URL.createObjectURL(blob);
            status = 'ready';
          }
        })
        .catch(() => !cancelled && (status = 'error'));
    } else status = 'ready';
    return () => {
      cancelled = true;
    };
  });
  onDestroy(() => url && URL.revokeObjectURL(url));
</script>

<div class="thumb" style:width={`${size}px`} style:height={`${size}px`}>
  <button type="button" class="open" onclick={onopen} aria-label={`Open ${att.name}`} title={att.name}>
    {#if att.mime.startsWith('image/') && url}
      <img src={url} alt={att.name} />
    {:else if att.mime.startsWith('image/') && status === 'loading'}
      <span class="spin" aria-hidden="true"></span>
    {:else if status === 'missing' || status === 'error'}
      <Icon name="cloudOff" size={22} /><span class="tiny">not here yet</span>
    {:else}
      <Icon name="file" size={24} /><span class="tiny ext">{att.name.split('.').pop()?.toUpperCase()}</span>
    {/if}
  </button>
  {#if onremove}
    <button type="button" class="rm" onclick={onremove} aria-label={`Remove ${att.name}`}><Icon name="x" size={14} stroke={3} /></button>
  {/if}
</div>

<style>
  .thumb {
    position: relative;
    flex-shrink: 0;
  }
  .open {
    width: 100%;
    height: 100%;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--surface2);
    overflow: hidden;
    padding: 0;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    color: var(--text-muted);
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .rm {
    position: absolute;
    top: -6px;
    right: -6px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2px solid var(--surface);
    background: var(--text);
    color: var(--bg);
    display: grid;
    place-items: center;
    cursor: pointer;
    padding: 0;
  }
  .spin {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    animation: spin 0.8s linear infinite;
  }
  .ext {
    font-weight: 700;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
