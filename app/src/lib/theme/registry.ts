/**
 * Style registry. Built-in styles are every file in ./styles (picked up
 * automatically), plus styles registered by modules at runtime, plus the
 * user's own saved/imported styles from settings.
 */
import type { StyleDef } from './types';

const builtIn: StyleDef[] = Object.values(
  import.meta.glob<{ default: StyleDef }>('./styles/*.ts', { eager: true }),
).map((m) => m.default);

const ORDER = ['clean', 'paper', 'midnight', 'forest', 'sakura', 'ocean', 'ember', 'mono'];
builtIn.sort((a, b) => {
  const ia = ORDER.indexOf(a.id);
  const ib = ORDER.indexOf(b.id);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.name.localeCompare(b.name);
});

const fromModules: StyleDef[] = [];

/** Let an optional module (e.g. a game theme) contribute styles. */
export function registerStyle(style: StyleDef): void {
  if (!fromModules.some((s) => s.id === style.id)) fromModules.push(style);
}

export function allStyles(custom: StyleDef[] = []): StyleDef[] {
  return [...builtIn, ...fromModules, ...custom];
}

export function findStyle(id: string, custom: StyleDef[] = []): StyleDef {
  return allStyles(custom).find((s) => s.id === id) ?? builtIn[0];
}

/** Validate a style loaded from JSON (import / settings). */
export function sanitizeStyle(raw: unknown): StyleDef | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<StyleDef>;
  if (typeof s.id !== 'string' || typeof s.name !== 'string' || typeof s.seed !== 'string') return null;
  return {
    id: s.id.slice(0, 60),
    name: s.name.slice(0, 60),
    description: typeof s.description === 'string' ? s.description.slice(0, 200) : undefined,
    seed: s.seed,
    tint: Math.min(0.06, Math.max(0, Number(s.tint) || 0)),
    radius: Math.min(28, Math.max(0, Number(s.radius) || 0)),
    density: s.density === 'compact' || s.density === 'comfortable' ? s.density : 'cozy',
    font: typeof s.font === 'string' ? s.font : 'system',
    headingFont: typeof s.headingFont === 'string' ? s.headingFont : undefined,
    shadow: s.shadow === 'soft' || s.shadow === 'lifted' ? s.shadow : 'none',
    borders: s.borders === 'none' || s.borders === 'bold' ? s.borders : 'hairline',
    preferMode: s.preferMode === 'dark' || s.preferMode === 'light' ? s.preferMode : undefined,
    overrides: typeof s.overrides === 'object' ? s.overrides : undefined,
    css: typeof s.css === 'string' ? s.css.slice(0, 20_000) : undefined,
  };
}
