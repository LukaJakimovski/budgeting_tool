/**
 * Colour maths in OKLCH — a perceptual colour space where changing lightness
 * doesn't shift the hue, which makes generated palettes look even.
 */

export interface OKLCH {
  l: number; // 0..1
  c: number; // 0..~0.37
  h: number; // degrees
}

type RGB = [number, number, number]; // 0..1, gamma-encoded sRGB

export function parseHex(hex: string): RGB | null {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map((c) => c + c).join('');
  if (h.length === 8) h = h.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGB;
}

export function toHex([r, g, b]: RGB): string {
  const c = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const fromLinear = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

export function rgbToOklch(rgb: RGB): OKLCH {
  const [r, g, b] = rgb.map(toLinear);
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const c = Math.sqrt(A * A + B * B);
  let h = (Math.atan2(B, A) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h: c < 1e-4 ? 0 : h };
}

function oklchToLinear({ l, c, h }: OKLCH): RGB {
  const hr = (h * Math.PI) / 180;
  const A = c * Math.cos(hr);
  const B = c * Math.sin(hr);
  const l_ = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m_ = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s_ = (l - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

const inGamut = (rgb: RGB) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/** OKLCH → hex, reducing chroma until the colour fits in sRGB. */
export function oklchToHex(col: OKLCH): string {
  const l = Math.min(1, Math.max(0, col.l));
  let c = Math.max(0, col.c);
  let lin = oklchToLinear({ l, c, h: col.h });
  if (!inGamut(lin)) {
    let lo = 0;
    let hi = c;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear({ l, c: mid, h: col.h }))) lo = mid;
      else hi = mid;
    }
    c = lo;
    lin = oklchToLinear({ l, c, h: col.h });
  }
  return toHex(lin.map(fromLinear) as RGB);
}

export function hexToOklch(hex: string): OKLCH {
  return rgbToOklch(parseHex(hex) ?? [0.5, 0.5, 0.5]);
}

export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex) ?? [0, 0, 0];
  const [r, g, b] = rgb.map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio (1..21). */
export function contrast(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Move a colour's lightness (keeping hue/chroma) until it reaches `ratio`
 * contrast against `bg`. Goes darker on light backgrounds, lighter on dark.
 */
export function ensureContrast(fg: string, bg: string, ratio: number): string {
  if (contrast(fg, bg) >= ratio) return fg;
  const col = hexToOklch(fg);
  const darker = relativeLuminance(bg) > 0.18;
  let out = fg;
  for (let i = 1; i <= 60; i++) {
    const l = darker ? col.l - i * 0.01 : col.l + i * 0.01;
    out = oklchToHex({ ...col, l: Math.min(1, Math.max(0, l)) });
    if (contrast(out, bg) >= ratio) return out;
  }
  return darker ? '#000000' : '#ffffff';
}

export function withAlpha(hex: string, alpha: number): string {
  const rgb = parseHex(hex) ?? [0, 0, 0];
  return `rgba(${rgb.map((v) => Math.round(v * 255)).join(', ')}, ${alpha})`;
}

export function isHex(s: string): boolean {
  return parseHex(s) !== null;
}
