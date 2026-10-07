<!--
  Appearance: pick a style, then tweak colour, font, shape and individual
  colour tokens. Any look can be saved as your own style and exported/imported
  as a small JSON file.
-->
<script lang="ts">
  import { repo } from '$lib/db/repo.svelte';
  import { toasts } from '$lib/ui/toast.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import { allStyles, findStyle, sanitizeStyle } from '$lib/theme/registry';
  import { resolveTokens } from '$lib/theme/generate';
  import { resolvedMode } from '$lib/theme/apply';
  import { FONTS } from '$lib/theme/fonts';
  import { isHex, contrast } from '$lib/theme/color';
  import { saveFile } from '$lib/platform';
  import { newId } from '$lib/core/ids';
  import type { Appearance, Density, StyleDef, TokenName, Tokens } from '$lib/theme/types';

  const a = $derived(repo.setting('appearance'));
  const style = $derived(findStyle(a.styleId, a.customStyles));
  const mode = $derived(resolvedMode(a));
  const tokens = $derived(resolveTokens(style, mode, a.seed, a.overrides[mode]));
  let hexText = $state('');
  let customFont = $state('');
  let showAdvanced = $state(false);
  let newStyleName = $state('');
  let importText = $state('');

  const SWATCHES = ['#3b7dd8', '#5b5bd6', '#8b5cf6', '#c026d3', '#d9468a', '#e5484d', '#e8590c', '#d4a017', '#2f8f5b', '#0e8f9c', '#0284c7', '#64748b'];

  function set(patch: Partial<Appearance>) {
    return repo.setSetting('appearance', { ...a, ...patch });
  }
  function pickStyle(s: StyleDef) {
    set({ styleId: s.id, seed: null, overrides: { light: {}, dark: {} }, radius: null, density: null, font: null, mode: a.mode === 'auto' && s.preferMode ? s.preferMode : a.mode });
  }
  function setSeed(hex: string) {
    if (isHex(hex)) set({ seed: hex.startsWith('#') ? hex : '#' + hex });
  }
  function setToken(name: TokenName, value: string) {
    set({ overrides: { ...a.overrides, [mode]: { ...a.overrides[mode], [name]: value } } });
  }
  function resetToken(name: TokenName) {
    const next = { ...a.overrides[mode] };
    delete next[name];
    set({ overrides: { ...a.overrides, [mode]: next } });
  }

  function currentAsStyle(name: string): StyleDef {
    return {
      id: `custom-${newId().slice(-8)}`,
      name,
      description: `Based on ${style.name}`,
      seed: a.seed ?? style.seed,
      tint: style.tint,
      radius: a.radius ?? style.radius,
      density: a.density ?? style.density,
      font: a.font ?? style.font,
      headingFont: a.font ? undefined : style.headingFont,
      shadow: style.shadow,
      borders: style.borders,
      preferMode: style.preferMode,
      overrides: {
        light: { ...(a.seed ? {} : style.overrides?.light), ...a.overrides.light },
        dark: { ...(a.seed ? {} : style.overrides?.dark), ...a.overrides.dark },
      },
      css: style.css,
    };
  }
  async function saveStyle() {
    const name = newStyleName.trim() || 'My style';
    const s = currentAsStyle(name);
    await set({ customStyles: [...a.customStyles, s], styleId: s.id, seed: null, overrides: { light: {}, dark: {} }, radius: null, density: null, font: null });
    newStyleName = '';
    toasts.show(`Saved “${name}”`, { tone: 'success' });
  }
  async function exportStyle(s: StyleDef) {
    await saveFile(`tally-style-${s.name.toLowerCase().replace(/\W+/g, '-')}.json`, JSON.stringify(s, null, 2), 'application/json');
  }
  async function importStyle(text: string) {
    try {
      const s = sanitizeStyle(JSON.parse(text));
      if (!s) throw new Error('missing id, name or seed');
      const id = a.customStyles.some((x) => x.id === s.id) || allStyles().some((x) => x.id === s.id) ? `${s.id}-${newId().slice(-4)}` : s.id;
      await set({ customStyles: [...a.customStyles, { ...s, id }], styleId: id, seed: null });
      importText = '';
      toasts.show(`Imported “${s.name}”`, { tone: 'success' });
    } catch (err) {
      toasts.error(`Not a valid style: ${(err as Error).message}`);
    }
  }

  const TOKEN_LABELS: [TokenName, string][] = [
    ['accent', 'Accent'],
    ['onAccent', 'Text on accent'],
    ['accentText', 'Accent text / links'],
    ['accentSoft', 'Accent wash'],
    ['bg', 'Background'],
    ['surface', 'Cards'],
    ['surface2', 'Inputs & hover'],
    ['surface3', 'Pressed'],
    ['border', 'Borders'],
    ['text', 'Text'],
    ['textMuted', 'Secondary text'],
    ['textFaint', 'Faint text'],
    ['good', 'Good'],
    ['warn', 'Warning'],
    ['bad', 'Danger'],
    ['grid', 'Chart grid'],
  ];
</script>

<div class="stack">
  <section class="card stack">
    <h2>Style</h2>
    <div class="styles">
      {#each allStyles(a.customStyles) as s (s.id)}
        {@const t = resolveTokens(s, mode, null)}
        <button class="style" aria-pressed={a.styleId === s.id} onclick={() => pickStyle(s)} style:border-radius={`${Math.min(16, s.radius + 4)}px`}>
          <span class="preview" style:background={t.bg} style:border-radius={`${Math.min(12, s.radius)}px`}>
            <span class="pcard" style:background={t.surface} style:border-color={t.border} style:border-radius={`${Math.min(10, s.radius)}px`}>
              <span class="pline" style:background={t.text}></span>
              <span class="pline short" style:background={t.textFaint}></span>
              <span class="pbar" style:background={t.accent}></span>
            </span>
          </span>
          <strong>{s.name}</strong>
          {#if s.description}<span class="faint tiny">{s.description}</span>{/if}
        </button>
      {/each}
    </div>
    <div class="field">
      <span class="label">Mode</span>
      <div class="segmented" role="group" aria-label="Light or dark">
        {#each [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']] as [m, l] (m)}
          <button aria-pressed={a.mode === m} onclick={() => set({ mode: m as Appearance['mode'] })}>{l}</button>
        {/each}
      </div>
    </div>
  </section>

  <section class="card stack">
    <h2>Colour</h2>
    <p class="muted small">Pick one colour — the whole theme is generated from it, for light and dark mode, with readable contrast guaranteed.</p>
    <div class="swatches">
      {#each SWATCHES as c (c)}
        <button class="swatch" style:background={c} aria-label={`Use ${c}`} aria-pressed={(a.seed ?? style.seed).toLowerCase() === c} onclick={() => setSeed(c)}></button>
      {/each}
      <label class="swatch picker" title="Any colour">
        <input type="color" value={a.seed ?? style.seed} oninput={(e) => setSeed((e.target as HTMLInputElement).value)} aria-label="Pick any colour" />
        <Icon name="palette" size={18} />
      </label>
    </div>
    <div class="row">
      <input class="input hex" placeholder={a.seed ?? style.seed} bind:value={hexText} onchange={() => setSeed(hexText.trim())} aria-label="Hex colour" />
      {#if a.seed}<button class="btn small ghost" onclick={() => set({ seed: null })}>Use {style.name}'s colour</button>{/if}
    </div>
  </section>

  <section class="card stack">
    <h2>Text & shape</h2>
    <label class="field">
      <span class="label">Font</span>
      <select class="select" value={a.font && !FONTS.some((f) => f.id === a.font) ? '__custom' : (a.font ?? '')} onchange={(e) => {
        const v = (e.target as HTMLSelectElement).value;
        if (v !== '__custom') set({ font: v || null });
      }}>
        <option value="">Style default ({FONTS.find((f) => f.id === style.font)?.name ?? style.font})</option>
        {#each FONTS as f (f.id)}<option value={f.id}>{f.name}</option>{/each}
        <option value="__custom">Custom…</option>
      </select>
    </label>
    <div class="row">
      <input class="input" placeholder="Any installed font, e.g. Inter" bind:value={customFont} aria-label="Custom font name" />
      <button class="btn small" onclick={() => customFont.trim() && set({ font: customFont.trim() })}>Use</button>
    </div>
    <label class="field">
      <span class="label">Text size · {Math.round(a.fontScale * 100)}%</span>
      <input type="range" min="0.85" max="1.3" step="0.05" value={a.fontScale} oninput={(e) => set({ fontScale: Number((e.target as HTMLInputElement).value) })} />
    </label>
    <label class="field">
      <span class="label">Corner roundness · {a.radius ?? style.radius}px</span>
      <input type="range" min="0" max="24" step="1" value={a.radius ?? style.radius} oninput={(e) => set({ radius: Number((e.target as HTMLInputElement).value) })} />
    </label>
    <div class="field">
      <span class="label">Density</span>
      <div class="segmented" role="group" aria-label="Density">
        {#each [['compact', 'Compact'], ['cozy', 'Cozy'], ['comfortable', 'Roomy']] as [d, l] (d)}
          <button aria-pressed={(a.density ?? style.density) === d} onclick={() => set({ density: d as Density })}>{l}</button>
        {/each}
      </div>
    </div>
    <label class="row toggle">
      <input type="checkbox" checked={a.reduceMotion} onchange={(e) => set({ reduceMotion: (e.target as HTMLInputElement).checked })} />
      Reduce motion
    </label>
  </section>

  <section class="card stack">
    <button class="adv" aria-expanded={showAdvanced} onclick={() => (showAdvanced = !showAdvanced)}>
      <h2>Fine-tune colours ({mode} mode)</h2>
      <span class="spacer"></span>
      <Icon name={showAdvanced ? 'chevronUp' : 'chevronDown'} />
    </button>
    {#if showAdvanced}
      <p class="muted small">Override any generated colour. Changes apply to {mode} mode only — switch mode above to edit the other.</p>
      <div class="tokens">
        {#each TOKEN_LABELS as [name, label] (name)}
          {@const overridden = name in a.overrides[mode]}
          <div class="token">
            <input type="color" value={(tokens as Tokens)[name].startsWith('#') ? (tokens as Tokens)[name].slice(0, 7) : '#888888'} onchange={(e) => setToken(name, (e.target as HTMLInputElement).value)} aria-label={label} />
            <span class="small">{label}</span>
            <span class="spacer"></span>
            {#if name === 'text' || name === 'accentText'}
              <span class="tiny faint" title="Contrast against cards">{contrast((tokens as Tokens)[name], tokens.surface).toFixed(1)}:1</span>
            {/if}
            {#if overridden}<button class="icon-btn" aria-label={`Reset ${label}`} onclick={() => resetToken(name)}><Icon name="refresh" size={16} /></button>{/if}
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <section class="card stack">
    <h2>Your styles</h2>
    <div class="row wrap">
      <input class="input name-input" placeholder="Name this look" bind:value={newStyleName} />
      <button class="btn" onclick={saveStyle}><Icon name="plus" size={16} /> Save current look</button>
    </div>
    {#each a.customStyles as s (s.id)}
      <div class="row custom">
        <span class="dotc" style:background={s.seed}></span>
        <strong>{s.name}</strong>
        <span class="spacer"></span>
        <button class="btn small ghost" onclick={() => exportStyle(s)}><Icon name="download" size={16} /> Export</button>
        <button class="icon-btn" aria-label={`Delete ${s.name}`} onclick={() => set({ customStyles: a.customStyles.filter((x) => x.id !== s.id), styleId: a.styleId === s.id ? 'clean' : a.styleId })}><Icon name="trash" size={18} /></button>
      </div>
    {/each}
    <details>
      <summary class="small">Import a style</summary>
      <div class="stack" style="margin-top: 8px">
        <input
          type="file"
          accept=".json,application/json"
          onchange={async (e) => {
            const f = (e.target as HTMLInputElement).files?.[0];
            if (f) importStyle(await f.text());
          }}
        />
        <textarea class="textarea" placeholder="…or paste style JSON" bind:value={importText}></textarea>
        <button class="btn small" disabled={!importText.trim()} onclick={() => importStyle(importText)}>Import</button>
      </div>
    </details>
  </section>
</div>

<style>
  .styles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: var(--s2);
  }
  .style {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: var(--s2);
    border: 2px solid var(--border);
    background: var(--surface);
    color: var(--text);
    text-align: left;
    cursor: pointer;
  }
  .style[aria-pressed='true'] {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .preview {
    height: 70px;
    padding: 10px;
    display: flex;
    margin-bottom: 4px;
  }
  .pcard {
    flex: 1;
    border: 1px solid;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .pline {
    height: 5px;
    width: 70%;
    border-radius: 3px;
  }
  .pline.short {
    width: 45%;
  }
  .pbar {
    margin-top: auto;
    height: 7px;
    width: 55%;
    border-radius: 4px;
  }
  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .swatch {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: 3px solid var(--surface);
    box-shadow: 0 0 0 1px var(--border);
    cursor: pointer;
    position: relative;
    display: grid;
    place-items: center;
    color: var(--text-muted);
  }
  .swatch[aria-pressed='true'] {
    box-shadow: 0 0 0 2px var(--text);
  }
  .picker {
    background: conic-gradient(red, yellow, lime, cyan, blue, magenta, red);
    color: #fff;
    overflow: hidden;
  }
  .picker input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }
  .hex {
    max-width: 140px;
  }
  .name-input {
    flex: 1 1 180px;
    width: auto;
  }
  input[type='range'] {
    accent-color: var(--accent);
    width: 100%;
  }
  .toggle {
    cursor: pointer;
  }
  .toggle input {
    width: 18px;
    height: 18px;
    accent-color: var(--accent);
  }
  .adv {
    display: flex;
    align-items: center;
    border: 0;
    background: transparent;
    padding: 0;
    color: var(--text);
    cursor: pointer;
    text-align: left;
  }
  .tokens {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 4px var(--s3);
  }
  .token {
    display: flex;
    align-items: center;
    gap: var(--s2);
    min-height: 40px;
  }
  .token input[type='color'] {
    width: 32px;
    height: 32px;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0;
    background: none;
    cursor: pointer;
  }
  .custom {
    padding: 4px 0;
  }
  .dotc {
    width: 16px;
    height: 16px;
    border-radius: 50%;
  }
  summary {
    cursor: pointer;
    color: var(--accent-text);
  }
</style>
