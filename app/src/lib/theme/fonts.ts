/**
 * Font choices. Only fonts already on the device are used (no downloads), so
 * each option is a "stack" that falls back gracefully on Linux, Android and
 * browsers. Any CSS font-family string also works as a custom font.
 */
export interface FontOption {
  id: string;
  name: string;
  stack: string;
}

export const FONTS: FontOption[] = [
  { id: 'system', name: 'System', stack: 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", Cantarell, Ubuntu, sans-serif' },
  { id: 'humanist', name: 'Humanist', stack: 'Seravek, "Gill Sans Nova", Ubuntu, Calibri, "DejaVu Sans", source-sans-pro, sans-serif' },
  { id: 'geometric', name: 'Geometric', stack: 'Avenir, Montserrat, Corbel, "URW Gothic", "Century Gothic", source-sans-pro, sans-serif' },
  { id: 'rounded', name: 'Rounded', stack: 'ui-rounded, "Hiragino Maru Gothic ProN", Quicksand, Comfortaa, Manjari, "Arial Rounded MT", "Arial Rounded MT Bold", Calibri, source-sans-pro, sans-serif' },
  { id: 'serif', name: 'Book serif', stack: '"Iowan Old Style", "Palatino Linotype", "URW Palladio L", P052, "Noto Serif", Georgia, serif' },
  { id: 'slab', name: 'Slab', stack: 'Rockwell, "Rockwell Nova", "Roboto Slab", "DejaVu Serif", "Sitka Small", serif' },
  { id: 'mono', name: 'Monospace', stack: 'ui-monospace, "Cascadia Code", "JetBrains Mono", "Source Code Pro", Menlo, Consolas, "DejaVu Sans Mono", monospace' },
];

export function fontStack(idOrFamily: string | null | undefined): string {
  if (!idOrFamily) return FONTS[0].stack;
  const f = FONTS.find((x) => x.id === idOrFamily);
  if (f) return f.stack;
  // Custom family name: quote it if needed and fall back to the system stack.
  const custom = /[,"']/.test(idOrFamily) ? idOrFamily : `"${idOrFamily}"`;
  return `${custom}, ${FONTS[0].stack}`;
}
