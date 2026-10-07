import type { StyleDef } from '../types';

export default {
  id: 'midnight',
  name: 'Midnight',
  description: 'Deep violet night with soft glow.',
  seed: '#8b7cf6',
  tint: 0.03,
  radius: 14,
  density: 'cozy',
  font: 'geometric',
  shadow: 'lifted',
  borders: 'none',
  preferMode: 'dark',
  css: `
    [data-mode='dark'] .fab { box-shadow: 0 6px 24px color-mix(in srgb, var(--accent) 45%, transparent); }
  `,
} satisfies StyleDef;
