/**
 * Palette generation: one accent colour in, a full light + dark token set out.
 *
 * Neutrals take the accent's hue at a low chroma (the style's `tint`), so a
 * green style gets subtly green-grey surfaces. Accent-derived colours are
 * pushed until they meet WCAG contrast against the surfaces they sit on.
 */
import { contrast, ensureContrast, hexToOklch, oklchToHex, withAlpha } from './color';
import { STATUS } from './chart';
import type { Mode, StyleDef, Tokens } from './types';

interface Ramp {
  bg: number;
  surface: number;
  surface2: number;
  surface3: number;
  border: number;
  text: number;
  textMuted: number;
  textFaint: number;
  grid: number;
}

const LIGHT: Ramp = { bg: 0.972, surface: 0.995, surface2: 0.948, surface3: 0.915, border: 0.885, text: 0.22, textMuted: 0.46, textFaint: 0.6, grid: 0.91 };
const DARK: Ramp = { bg: 0.165, surface: 0.205, surface2: 0.25, surface3: 0.29, border: 0.315, text: 0.95, textMuted: 0.74, textFaint: 0.6, grid: 0.28 };

export function generateTokens(seed: string, tint: number, mode: Mode): Tokens {
  const s = hexToOklch(seed);
  const ramp = mode === 'light' ? LIGHT : DARK;
  const n = (l: number, k = 1) => oklchToHex({ l, c: tint * k, h: s.h });

  const surface = n(ramp.surface, 0.5);
  const bg = n(ramp.bg);

  // Accent: keep the user's colour where possible, clamp lightness so it works as a fill.
  const accentL = mode === 'light' ? Math.min(0.68, Math.max(0.42, s.l)) : Math.min(0.8, Math.max(0.6, s.l));
  let accent = oklchToHex({ l: accentL, c: s.c, h: s.h });
  accent = ensureContrast(accent, surface, 3);
  const onAccent = contrast('#ffffff', accent) >= 4.5 || contrast('#ffffff', accent) >= contrast('#111111', accent) ? '#ffffff' : '#111111';
  const accentText = ensureContrast(accent, surface, 4.5);
  const accentSoft = oklchToHex({ l: mode === 'light' ? 0.94 : 0.3, c: Math.min(s.c, mode === 'light' ? 0.045 : 0.06), h: s.h });

  const text = n(ramp.text, 1.5);
  return {
    bg,
    surface,
    surface2: n(ramp.surface2),
    surface3: n(ramp.surface3),
    border: n(ramp.border, 1.2),
    text,
    textMuted: ensureContrast(n(ramp.textMuted, 1.5), bg, 4.5),
    textFaint: ensureContrast(n(ramp.textFaint), bg, 3),
    accent,
    onAccent,
    accentSoft,
    accentText,
    focus: accentText,
    good: STATUS.good,
    warn: STATUS.warn,
    bad: STATUS.bad,
    grid: n(ramp.grid),
    shadow: mode === 'light' ? withAlpha(n(0.2), 0.12) : 'rgba(0, 0, 0, 0.45)',
  };
}

export function resolveTokens(style: StyleDef, mode: Mode, seedOverride: string | null, userOverrides: Partial<Tokens> = {}): Tokens {
  const base = generateTokens(seedOverride ?? style.seed, style.tint, mode);
  return { ...base, ...(seedOverride ? {} : style.overrides?.[mode] ?? {}), ...userOverrides };
}
