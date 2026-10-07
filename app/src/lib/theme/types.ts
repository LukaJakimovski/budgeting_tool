/** Colour tokens every style resolves to (one set for light, one for dark). */
export interface Tokens {
  /** Page background. */
  bg: string;
  /** Cards, sheets. */
  surface: string;
  /** Inputs, hovered rows, chips. */
  surface2: string;
  /** Pressed / selected neutral. */
  surface3: string;
  border: string;
  text: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  /** Text/icon colour on top of `accent`. */
  onAccent: string;
  /** Subtle accent wash for selected chips, highlights. */
  accentSoft: string;
  /** Text in accent colour that is readable on surfaces. */
  accentText: string;
  focus: string;
  good: string;
  warn: string;
  bad: string;
  /** Chart gridlines and baselines. */
  grid: string;
  shadow: string;
}

export type TokenName = keyof Tokens;
export type Mode = 'light' | 'dark';
export type Density = 'compact' | 'cozy' | 'comfortable';

/**
 * A style ("theme preset"). To add one, drop a file in src/lib/theme/styles/
 * that default-exports a StyleDef — it is picked up automatically.
 * See docs/theming.md.
 */
export interface StyleDef {
  id: string;
  name: string;
  description?: string;
  /** Accent colour the palette is generated from (any CSS hex). */
  seed: string;
  /** How strongly neutrals are tinted towards the accent hue (0 = pure grey, ~0.03 = noticeable). */
  tint: number;
  /** Base corner radius in px. */
  radius: number;
  density: Density;
  /** Font id from fonts.ts or any CSS font-family list. */
  font: string;
  /** Optional separate font for headings and big numbers. */
  headingFont?: string;
  shadow: 'none' | 'soft' | 'lifted';
  borders: 'none' | 'hairline' | 'bold';
  /** Mode used when the user picks "auto" and the OS has no preference. */
  preferMode?: Mode;
  /** Hand-tuned token overrides on top of the generated palette. */
  overrides?: { light?: Partial<Tokens>; dark?: Partial<Tokens> };
  /** Extra CSS scoped to this style (textures, borders, ornaments…). */
  css?: string;
}

export interface Appearance {
  styleId: string;
  mode: 'auto' | Mode;
  /** User-picked accent; null = the style's seed. */
  seed: string | null;
  font: string | null;
  fontScale: number;
  radius: number | null;
  density: Density | null;
  overrides: { light: Partial<Tokens>; dark: Partial<Tokens> };
  /** Styles the user saved or imported. */
  customStyles: StyleDef[];
  reduceMotion: boolean;
}

export const DEFAULT_APPEARANCE: Appearance = {
  styleId: 'clean',
  mode: 'auto',
  seed: null,
  font: null,
  fontScale: 1,
  radius: null,
  density: null,
  overrides: { light: {}, dark: {} },
  customStyles: [],
  reduceMotion: false,
};
