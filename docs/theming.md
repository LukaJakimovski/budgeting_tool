# Themes and styles

Every colour, font, corner radius and spacing in Tally comes from **CSS custom
properties** set by the theme engine (`app/src/lib/theme/`). Components only
use `var(--accent)`, `var(--surface)`, `var(--radius)` and so on, so adding a
new look never means touching components.

## How a theme is built

1. A **style** (a small object, see below) names an accent colour and some
   shape/typography choices.
2. `generate.ts` turns the accent into a full **token set for light and dark
   mode**, working in OKLCH (a perceptual colour space, so lightness changes
   don't shift the hue):
   * neutrals (background, cards, borders, text) are greys tinted towards the
     accent's hue by the style's `tint`;
   * the accent is clamped to a usable lightness and pushed until it has at
     least **3:1** contrast with cards; link/accent text gets **4.5:1**;
   * text colour on top of the accent is white or near-black, whichever
     reads better.
3. The style's hand-tuned `overrides`, then the **user's own overrides**
   (Settings → Appearance → Fine-tune colours), are applied on top.
4. `apply.ts` writes the result as CSS variables on `:root` (light) and
   `:root[data-mode='dark']` (dark), plus radius, density, fonts and the
   style's extra CSS.

The unit tests check that every built-in style meets the contrast targets in
both modes, and that any colour a user picks produces readable text.

### Tokens

| Token | Used for |
|---|---|
| `--bg` | page background |
| `--surface`, `--surface2`, `--surface3` | cards; inputs/hover; pressed/selected |
| `--border` | borders and dividers |
| `--text`, `--text-muted`, `--text-faint` | primary, secondary, tertiary text |
| `--accent`, `--on-accent` | primary buttons, selected states; text on them |
| `--accent-soft`, `--accent-text` | selected-chip wash; links and accent-coloured text |
| `--focus` | keyboard focus ring |
| `--good`, `--warn`, `--bad` | budget status (always paired with an icon + label) |
| `--grid`, `--shadow` | chart gridlines; shadows |
| `--radius`, `--radius-sm`, `--radius-lg` | corners |
| `--sp` | spacing scale (density): 0.8 compact, 1 cozy, 1.2 roomy |
| `--font`, `--font-heading`, `--font-scale` | typefaces and text size |
| `--card-shadow`, `--border-w` | card elevation and border weight |

Chart series colours are a separate, colour-blind-checked palette
(`theme/chart.ts`) so categories stay distinguishable in every style.

## Adding a style (developers)

Create one file in `app/src/lib/theme/styles/`. It's picked up automatically —
no registration needed.

```ts
// app/src/lib/theme/styles/nord.ts
import type { StyleDef } from '../types';

export default {
  id: 'nord',
  name: 'Nord',
  description: 'Arctic blues.',
  seed: '#5e81ac',        // the accent everything is generated from
  tint: 0.02,             // 0 = pure grey neutrals, ~0.03 = clearly tinted
  radius: 10,             // px
  density: 'cozy',        // 'compact' | 'cozy' | 'comfortable'
  font: 'humanist',       // id from fonts.ts, or any CSS font-family list
  headingFont: 'geometric',
  shadow: 'soft',         // 'none' | 'soft' | 'lifted'
  borders: 'hairline',    // 'none' | 'hairline' | 'bold'
  preferMode: 'dark',     // optional: switch to this mode when picked
  overrides: {            // optional: hand-tune generated tokens
    dark: { bg: '#2e3440', surface: '#3b4252' },
  },
  css: `                  /* optional: anything else, e.g. textures */
    [data-style='nord'] .card { backdrop-filter: blur(6px); }
  `,
} satisfies StyleDef;
```

Rebuild and it appears in the style gallery. Keep `overrides` small; the
generator already handles contrast.

**Fonts:** only fonts already installed on the device are used (no downloads,
so it works offline and fast). Add more stacks in `theme/fonts.ts`. A style that
needs a specific web font can bundle it (put the `.woff2` in `app/public/fonts/`
and declare `@font-face` in the style's `css`).

**Bigger visual themes** (e.g. a RuneScape-like look with textures, pixel
borders and a custom font) fit the same model: a style with a strong `css`
block scoped to `[data-style='<id>']`. Modules can also register styles at
runtime — see [extending.md](extending.md).

## Making a style without code (users)

*Settings → Appearance*:

1. pick the closest built-in style;
2. pick an accent colour (swatches or any colour);
3. adjust font, text size, roundness and density;
4. optionally open *Fine-tune colours* and override individual tokens per mode;
5. *Save current look* — it becomes your own style, synced to all your devices.

*Export* saves a style as a small JSON file (the same `StyleDef` shape as
above), which you can share or *Import* on another vault.
