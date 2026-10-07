/**
 * Optional modules ("plugins").
 *
 * A module bundles extra behaviour — e.g. a future RuneScape-style
 * gamification layer — without the core knowing about it. It can listen to
 * domain events, add dashboard widgets, add styles and store its own state in
 * a synced setting. Users switch modules on/off in Settings → Modules.
 * See docs/extending.md for a walkthrough.
 */
import { on, emit, type TallyEvents } from './events';
import { registerWidget, type WidgetDef } from '../../widgets/registry';
import { registerStyle } from '../theme/registry';
import { repo } from '../db/repo.svelte';
import { toasts } from '../ui/toast.svelte';
import type { StyleDef } from '../theme/types';

export interface ModuleAPI {
  on: typeof on;
  emit: typeof emit;
  registerWidget(def: WidgetDef): void;
  registerStyle(style: StyleDef): void;
  /** Read-only access to the data (use the repo methods). */
  repo: typeof repo;
  toast: (message: string) => void;
  /** Per-module synced state, stored as a setting document. */
  getState<T>(fallback: T): T;
  setState<T>(value: T): Promise<void>;
}

export interface TallyModule {
  id: string;
  name: string;
  description: string;
  setup(api: ModuleAPI): void | (() => void);
}

const modules = new Map<string, TallyModule>();
const running = new Map<string, () => void>();

export function defineModule(m: TallyModule): TallyModule {
  modules.set(m.id, m);
  return m;
}

export function availableModules(): TallyModule[] {
  return [...modules.values()];
}

function apiFor(m: TallyModule): ModuleAPI {
  const key = `module:${m.id}`;
  return {
    on,
    emit,
    registerWidget: (def) => registerWidget({ ...def, module: m.id }),
    registerStyle,
    repo,
    toast: (message) => toasts.show(message),
    getState: <T,>(fallback: T) => (repo.get<{ value: T } & import('../core/types').Setting>(`setting:${key}`)?.value as T) ?? fallback,
    setState: async <T,>(value: T) => {
      const id = `setting:${key}`;
      const cur = repo.raw(id);
      await repo.save([{ id, type: 'setting', key, value: JSON.parse(JSON.stringify(value)), rev: '', createdAt: cur?.createdAt ?? new Date().toISOString() }]);
    },
  };
}

/** Start/stop modules to match the enabled map from settings. */
export function syncModules(enabled: Record<string, boolean>): void {
  for (const m of modules.values()) {
    const want = !!enabled[m.id];
    if (want && !running.has(m.id)) {
      try {
        const stop = m.setup(apiFor(m));
        running.set(m.id, typeof stop === 'function' ? stop : () => undefined);
      } catch (err) {
        console.error(`[tally] module ${m.id} failed to start`, err);
      }
    } else if (!want && running.has(m.id)) {
      running.get(m.id)!();
      running.delete(m.id);
    }
  }
}

export type { TallyEvents };
