import type { StyleDef } from '../types';

/** The default: quiet, flat and focused — in the spirit of Anki. */
export default {
  id: 'clean',
  name: 'Clean',
  description: 'Quiet and flat. Content first.',
  seed: '#3b7dd8',
  tint: 0.006,
  radius: 8,
  density: 'cozy',
  font: 'system',
  shadow: 'none',
  borders: 'hairline',
} satisfies StyleDef;
