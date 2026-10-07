<!--
  Home: the customisable dashboard. Minimal by default; "Customise" lets you
  add, remove, resize, reorder (drag or arrows) and configure widgets.
  The layout is a synced setting, so it follows you to every device.
-->
<script lang="ts">
  import { repo } from '$lib/db/repo.svelte';
  import { ui } from '$lib/ui/ui.svelte';
  import { sync } from '$lib/sync/sync.svelte';
  import { toasts } from '$lib/ui/toast.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import Sheet from '$lib/ui/Sheet.svelte';
  import WidgetConfigForm from '../widgets/WidgetConfigForm.svelte';
  import { allWidgets, getWidget, type WidgetConfig } from '../widgets/registry';
  import { pendingRecurring, confirmOccurrence, skipOccurrence } from '$lib/actions';
  import { DEFAULT_DASHBOARD, type DashboardLayout, type WidgetInstance } from '$lib/modules/dashboard-types';
  import { money, date as fmtDate } from '$lib/ui/format';
  import { formatMoney } from '$lib/core/money';
  import { newId } from '$lib/core/ids';
  import { backupStatus } from '$lib/backup';

  const saved = $derived(repo.setting('dashboard'));
  let draft = $state<DashboardLayout | null>(null);
  const layout = $derived(draft ?? saved);
  let picking = $state(false);
  let configuring = $state<WidgetInstance | null>(null);
  let configDraft = $state<WidgetConfig>({});
  let dragIndex = $state<number | null>(null);

  const due = $derived.by(() => {
    void repo.version;
    return pendingRecurring();
  });
  const backup = $derived(backupStatus());

  function startEdit() {
    draft = JSON.parse(JSON.stringify(saved));
    ui.editingDashboard = true;
  }
  async function finishEdit() {
    if (draft) await repo.setSetting('dashboard', draft);
    draft = null;
    ui.editingDashboard = false;
  }
  function cancelEdit() {
    draft = null;
    ui.editingDashboard = false;
  }
  function update(fn: (w: WidgetInstance[]) => WidgetInstance[]) {
    if (!draft) return;
    draft = { ...draft, widgets: fn([...draft.widgets]) };
  }
  function move(i: number, dir: number) {
    update((w) => {
      const j = i + dir;
      if (j < 0 || j >= w.length) return w;
      [w[i], w[j]] = [w[j], w[i]];
      return w;
    });
  }
  function add(type: string) {
    const def = getWidget(type);
    if (!def) return;
    update((w) => [...w, { id: newId('w-'), type, size: def.defaultSize, config: structuredClone(def.defaultConfig) }]);
    picking = false;
    setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 50);
  }

  // Pointer-based drag to reorder (works with touch and mouse).
  function dragStart(e: PointerEvent, i: number) {
    dragIndex = i;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function dragMove(e: PointerEvent) {
    if (dragIndex === null) return;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-widget-index]') as HTMLElement | null;
    if (!el) return;
    const target = Number(el.dataset.widgetIndex);
    if (target !== dragIndex) {
      const from = dragIndex;
      update((w) => {
        const [item] = w.splice(from, 1);
        w.splice(target, 0, item);
        return w;
      });
      dragIndex = target;
    }
  }
  function dragEnd() {
    dragIndex = null;
  }
</script>

<div class="page">
  {#if sync.unsyncedWarning}
    <div class="banner warn" role="alert">
      <Icon name="cloudOff" />
      <div>
        <strong>{repo.pending} change{repo.pending === 1 ? '' : 's'} not synced yet.</strong>
        <span class="small">They're safe on this device. {sync.lastError ?? 'Waiting for a connection.'}</span>
      </div>
      <button class="btn small" onclick={() => sync.syncNow().catch(() => undefined)}>Retry</button>
    </div>
  {/if}

  {#if backup.due}
    <div class="banner" role="status">
      <Icon name="database" />
      <div>
        <strong>Time for a backup.</strong>
        <span class="small">{backup.message}</span>
      </div>
      <a class="btn small" href="#/settings/data">Back up</a>
    </div>
  {/if}

  {#if due.length}
    <section class="card due">
      <div class="card-title"><Icon name="repeat" size={16} /> Recurring · due</div>
      {#each due.slice(0, 5) as o (o.id)}
        <div class="due-row">
          <div class="grow">
            <strong>{o.rule.name}</strong>
            <span class="faint small">{fmtDate(o.date)} · {formatMoney(o.rule.template.amount, o.rule.template.currency)}</span>
          </div>
          <button class="btn small" onclick={() => skipOccurrence(o)}>Skip</button>
          <button class="btn small primary" onclick={() => confirmOccurrence(o).then(() => toasts.show(`Added ${o.rule.name}`, { tone: 'success' }))}>Add</button>
        </div>
      {/each}
      {#if due.length > 5}<p class="faint small">+{due.length - 5} more</p>{/if}
    </section>
  {/if}

  <div class="grid" class:editing={ui.editingDashboard}>
    {#each layout.widgets as w, i (w.id)}
      {@const def = getWidget(w.type)}
      {@const Widget = def?.component}
      <div class="cell" class:full={w.size === 'full'} class:dragging={dragIndex === i} data-widget-index={i}>
        {#if ui.editingDashboard}
          <div class="toolbar">
            <button class="icon-btn handle" aria-label="Drag to reorder" onpointerdown={(e) => dragStart(e, i)} onpointermove={dragMove} onpointerup={dragEnd} onpointercancel={dragEnd}><Icon name="grip" /></button>
            <span class="tname small">{def?.name ?? w.type}</span>
            <span class="spacer"></span>
            <button class="icon-btn" aria-label="Move up" onclick={() => move(i, -1)}><Icon name="arrowUp" size={18} /></button>
            <button class="icon-btn" aria-label="Move down" onclick={() => move(i, 1)}><Icon name="arrowDown" size={18} /></button>
            <button class="icon-btn" aria-label={w.size === 'full' ? 'Make half width' : 'Make full width'} title="Width" onclick={() => update((ws) => ws.map((x) => (x.id === w.id ? { ...x, size: x.size === 'full' ? 'half' : 'full' } : x)))}>
              <Icon name="layout" size={18} />
            </button>
            {#if def?.fields.length}
              <button class="icon-btn" aria-label="Widget settings" onclick={() => { configuring = w; configDraft = structuredClone($state.snapshot(w.config)); }}><Icon name="settings" size={18} /></button>
            {/if}
            <button class="icon-btn" aria-label="Remove widget" onclick={() => update((ws) => ws.filter((x) => x.id !== w.id))}><Icon name="x" size={18} /></button>
          </div>
        {/if}
        <div class="card widget" inert={ui.editingDashboard}>
          {#if Widget}
            <Widget config={w.config} size={w.size} />
          {:else}
            <p class="faint small">Unknown widget “{w.type}” (from a module that isn't enabled).</p>
          {/if}
        </div>
      </div>
    {/each}
  </div>

  {#if !layout.widgets.length && !ui.editingDashboard}
    <div class="empty">
      <p>Your dashboard is empty.</p>
      <button class="btn" onclick={startEdit}><Icon name="layout" size={18} /> Customise</button>
    </div>
  {/if}

  <div class="edit-bar">
    {#if ui.editingDashboard}
      <button class="btn" onclick={() => (picking = true)}><Icon name="plus" size={18} /> Add widget</button>
      <button class="btn ghost small" onclick={() => (draft = structuredClone(DEFAULT_DASHBOARD))}>Reset</button>
      <span class="spacer"></span>
      <button class="btn ghost" onclick={cancelEdit}>Cancel</button>
      <button class="btn primary" onclick={finishEdit}><Icon name="check" size={18} /> Done</button>
    {:else}
      <span class="spacer"></span>
      <button class="btn ghost small" onclick={startEdit}><Icon name="layout" size={16} /> Customise</button>
    {/if}
  </div>
</div>

<Sheet open={picking} title="Add a widget" onclose={() => (picking = false)}>
  <div class="list">
    {#each allWidgets() as def (def.type)}
      <button class="list-item" onclick={() => add(def.type)}>
        <span class="wicon"><Icon name={def.icon} /></span>
        <span class="grow">
          <strong>{def.name}</strong>
          <span class="faint small block">{def.description}</span>
        </span>
        <Icon name="plus" size={18} />
      </button>
    {/each}
  </div>
</Sheet>

{#if configuring}
  {@const def = getWidget(configuring.type)}
  <Sheet open={true} title={`${def?.name ?? 'Widget'} settings`} onclose={() => (configuring = null)}>
    {#if def}<WidgetConfigForm fields={def.fields} bind:value={configDraft} />{/if}
    {#snippet footer()}
      <span class="spacer"></span>
      <button class="btn" onclick={() => (configuring = null)}>Cancel</button>
      <button
        class="btn primary"
        onclick={() => {
          const id = configuring!.id;
          update((ws) => ws.map((x) => (x.id === id ? { ...x, config: $state.snapshot(configDraft) as WidgetConfig } : x)));
          configuring = null;
        }}>Apply</button
      >
    {/snippet}
  </Sheet>
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--s3);
  }
  .cell {
    grid-column: span 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .cell.full {
    grid-column: span 2;
  }
  .widget {
    flex: 1;
  }
  .editing .widget {
    opacity: 0.85;
    border-style: dashed;
    border-width: max(1px, var(--border-w));
    border-top-left-radius: 0;
    border-top-right-radius: 0;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 0;
    background: var(--surface2);
    border: max(1px, var(--border-w)) dashed var(--border);
    border-bottom: 0;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    padding: 2px 4px;
  }
  .toolbar .icon-btn {
    width: 34px;
    height: 34px;
  }
  .handle {
    cursor: grab;
    touch-action: none;
  }
  .dragging {
    opacity: 0.6;
  }
  .tname {
    font-weight: 600;
    color: var(--text-muted);
  }
  .edit-bar {
    display: flex;
    align-items: center;
    gap: var(--s2);
    margin-top: var(--s4);
    flex-wrap: wrap;
  }
  .banner {
    display: flex;
    align-items: center;
    gap: var(--s3);
    padding: var(--s3) var(--s4);
    border-radius: var(--radius-lg);
    background: var(--accent-soft);
    margin-bottom: var(--s3);
  }
  .banner.warn {
    background: color-mix(in srgb, var(--warn) 18%, var(--surface));
  }
  .banner > div {
    flex: 1;
    display: flex;
    flex-direction: column;
  }
  .due {
    margin-bottom: var(--s3);
  }
  .due-row {
    display: flex;
    align-items: center;
    gap: var(--s2);
    padding: var(--s2) 0;
  }
  .grow {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .block {
    display: block;
  }
  .wicon {
    width: 40px;
    height: 40px;
    border-radius: var(--radius);
    background: var(--accent-soft);
    color: var(--accent-text);
    display: grid;
    place-items: center;
  }
  @media (max-width: 420px) {
    .grid {
      gap: var(--s2);
    }
  }
</style>
