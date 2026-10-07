import { describe, expect, it } from 'vitest';
import { allStyles, sanitizeStyle } from '../src/lib/theme/registry';
import { resolveTokens, generateTokens } from '../src/lib/theme/generate';
import { contrast, hexToOklch, oklchToHex } from '../src/lib/theme/color';
import { themeCSS } from '../src/lib/theme/apply';
import { DEFAULT_APPEARANCE } from '../src/lib/theme/types';

describe('colour maths', () => {
  it('round-trips hex through OKLCH', () => {
    for (const hex of ['#3b7dd8', '#ffffff', '#000000', '#e8590c', '#808080']) {
      expect(oklchToHex(hexToOklch(hex))).toBe(hex);
    }
  });
});

describe('every built-in style is readable in both modes', () => {
  const styles = allStyles();
  it('has the expected styles', () => {
    expect(styles.map((s) => s.id)).toEqual(['clean', 'paper', 'midnight', 'forest', 'sakura', 'ocean', 'ember', 'mono']);
  });
  for (const style of styles) {
    for (const mode of ['light', 'dark'] as const) {
      it(`${style.id} / ${mode}`, () => {
        const t = resolveTokens(style, mode, null);
        expect(contrast(t.text, t.bg)).toBeGreaterThanOrEqual(7);
        expect(contrast(t.text, t.surface)).toBeGreaterThanOrEqual(7);
        expect(contrast(t.textMuted, t.bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t.accentText, t.surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t.accent, t.surface)).toBeGreaterThanOrEqual(3);
        expect(contrast(t.onAccent, t.accent)).toBeGreaterThanOrEqual(3);
      });
    }
  }
});

describe('any picked colour produces a usable theme', () => {
  const seeds = ['#ffff00', '#00ffff', '#ff00ff', '#111111', '#fafafa', '#7fff00', '#ff0000', '#0000ff'];
  for (const seed of seeds) {
    for (const mode of ['light', 'dark'] as const) {
      it(`${seed} / ${mode}`, () => {
        const t = generateTokens(seed, 0.02, mode);
        expect(contrast(t.accentText, t.surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t.onAccent, t.accent)).toBeGreaterThanOrEqual(3);
      });
    }
  }
});

it('emits CSS variables and sanitizes imported styles', () => {
  const css = themeCSS(DEFAULT_APPEARANCE);
  expect(css).toContain('--accent:');
  expect(css).toContain("[data-mode='dark']");
  expect(sanitizeStyle({ id: 'x', name: 'X', seed: '#123456', tint: 9, radius: 100 })).toMatchObject({ tint: 0.06, radius: 28 });
  expect(sanitizeStyle({ name: 'no id' })).toBeNull();
});
