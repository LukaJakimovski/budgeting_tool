<!--
  Budget meter. Fill colour carries severity (accent → warning → danger) and
  is always paired with a text status; the tick marks the even-spending pace.
-->
<script lang="ts">
  let { ratio, pace = null, status = 'ok', label = '' }: { ratio: number; pace?: number | null; status?: 'ok' | 'warn' | 'over'; label?: string } = $props();
  const fill = $derived(Math.max(0, Math.min(1, ratio)));
</script>

<div
  class="meter {status}"
  role="meter"
  aria-valuemin={0}
  aria-valuemax={100}
  aria-valuenow={Math.round(Math.max(0, ratio) * 100)}
  aria-label={label}
>
  <div class="fill" style:width={`${fill * 100}%`}></div>
  {#if pace !== null && pace > 0 && pace < 1}
    <div class="pace" style:left={`${pace * 100}%`} title="Even pace for today"></div>
  {/if}
</div>

<style>
  .meter {
    position: relative;
    height: 10px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent) 16%, var(--surface2));
    overflow: visible;
  }
  .meter.warn {
    background: color-mix(in srgb, var(--warn) 22%, var(--surface2));
  }
  .meter.over {
    background: color-mix(in srgb, var(--bad) 22%, var(--surface2));
  }
  .fill {
    height: 100%;
    border-radius: 999px;
    background: var(--accent);
    transition: width 0.4s var(--ease);
  }
  .warn .fill {
    background: var(--warn);
  }
  .over .fill {
    background: var(--bad);
  }
  .pace {
    position: absolute;
    top: -3px;
    bottom: -3px;
    width: 2px;
    margin-left: -1px;
    background: var(--text);
    border-radius: 1px;
    box-shadow: 0 0 0 2px var(--surface);
  }
</style>
