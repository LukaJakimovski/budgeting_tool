import type { StyleDef } from '../types';

export default {
  id: 'paper',
  name: 'Paper',
  description: 'Warm ledger paper with book type.',
  seed: '#a0522d',
  tint: 0.022,
  radius: 4,
  density: 'cozy',
  font: 'serif',
  shadow: 'soft',
  borders: 'hairline',
  preferMode: 'light',
  overrides: {
    light: { bg: '#f4eee2', surface: '#fbf8f1', surface2: '#efe7d8', surface3: '#e6dccb', border: '#dccfb9' },
  },
  css: `
    h1, h2, .big-number { letter-spacing: 0.01em; }
  `,
} satisfies StyleDef;
