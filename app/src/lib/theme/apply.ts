/**
 * Applies an Appearance to the document: CSS custom properties for both
 * modes, the style's extra CSS, font, radius, density and the light/dark mode.
 * Components only ever use the CSS variables (var(--accent) etc.), so a new
 * style never needs component changes.
 */
import { fontStack } from './fonts';
import { resolveTokens } from './generate';
import { findStyle } from './registry';
import type { Appearance, Mode, StyleDef, Tokens } from './types';

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()).replace(/(\d+)/g, '$1');

function vars(t: Tokens): string {
  return Object.entries(t)
    .map(([k, v]) => `--${kebab(k)}: ${v};`)
    .join(' ');
}

const SHADOWS: Record<StyleDef['shadow'], string> = {
  none: 'none',
  soft: '0 1px 2px var(--shadow), 0 2px 10px var(--shadow)',
  lifted: '0 2px 6px var(--shadow), 0 10px 28px var(--shadow)',
};
const BORDERS: Record<StyleDef['borders'], string> = { none: '0px', hairline: '1px', bold: '2px' };
const DENSITY = { compact: 0.8, cozy: 1, comfortable: 1.2 };

let media: MediaQueryList | null = null;
let current: Appearance | null = null;

export function resolvedMode(a: Appearance): Mode {
  if (a.mode !== 'auto') return a.mode;
  const style = findStyle(a.styleId, a.customStyles);
  if (typeof window !== 'undefined' && window.matchMedia) {
    const m = window.matchMedia('(prefers-color-scheme: dark)');
    if (m.matches) return 'dark';
    if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
  }
  return style.preferMode ?? 'light';
}

export function themeCSS(a: Appearance): string {
  const style = findStyle(a.styleId, a.customStyles);
  const light = resolveTokens(style, 'light', a.seed, a.overrides.light);
  const dark = resolveTokens(style, 'dark', a.seed, a.overrides.dark);
  const radius = a.radius ?? style.radius;
  const density = a.density ?? style.density;
  const font = fontStack(a.font ?? style.font);
  const heading = a.font ? font : fontStack(style.headingFont ?? style.font);
  const common = [
    `--radius: ${radius}px;`,
    `--radius-sm: ${Math.round(radius * 0.6)}px;`,
    `--radius-lg: ${Math.round(radius * 1.5)}px;`,
    `--sp: ${DENSITY[density]};`,
    `--font: ${font};`,
    `--font-heading: ${heading};`,
    `--font-scale: ${a.fontScale || 1};`,
    `--card-shadow: ${SHADOWS[style.shadow]};`,
    `--border-w: ${BORDERS[style.borders]};`,
  ].join(' ');
  return [
    `:root { ${vars(light)} ${common} color-scheme: light; }`,
    `:root[data-mode='dark'] { ${vars(dark)} color-scheme: dark; }`,
    style.css ?? '',
  ].join('\n');
}

export function applyAppearance(a: Appearance): void {
  if (typeof document === 'undefined') return;
  current = a;
  let el = document.getElementById('tally-theme') as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = 'tally-theme';
    document.head.appendChild(el);
  }
  el.textContent = themeCSS(a);
  const root = document.documentElement;
  root.dataset.style = a.styleId;
  root.dataset.mode = resolvedMode(a);
  root.dataset.reduceMotion = String(a.reduceMotion);
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
  let meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  if (bg) meta.content = bg;
  try {
    // Lets index.html paint the right background before the app loads.
    localStorage.setItem('tally-theme-boot', JSON.stringify({ css: el.textContent, mode: root.dataset.mode }));
  } catch {
    /* storage unavailable */
  }
  if (!media && window.matchMedia) {
    media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', () => current && current.mode === 'auto' && applyAppearance(current));
  }
}
