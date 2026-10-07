/**
 * Domain event bus.
 *
 * Core code announces what happened; optional modules (future gamification,
 * notifications, automations…) listen without the core knowing about them.
 * Add new events to `TallyEvents` — listeners are fully typed.
 */
import type { BudgetState } from '../core/budgets';
import type { Doc, Transaction } from '../core/types';

export interface TallyEvents {
  /** Any document written, locally or from sync. */
  'doc:saved': { doc: Doc; previous: Doc | undefined; origin: 'local' | 'remote' };
  /** A new purchase/income/refund entered on this device. */
  'transaction:created': { tx: Transaction; budgets: BudgetState[] };
  'transaction:updated': { tx: Transaction; previous: Transaction };
  'transaction:deleted': { tx: Transaction };
  /** A budget crossed its warning threshold or limit because of a local change. */
  'budget:threshold': { state: BudgetState; crossed: 'warn' | 'over' };
  'sync:completed': { pulled: number; pushed: number };
  'backup:created': { kind: 'local' | 'server'; at: string };
  'app:ready': Record<string, never>;
}

type Handler<K extends keyof TallyEvents> = (payload: TallyEvents[K]) => void;

const handlers = new Map<keyof TallyEvents, Set<Handler<any>>>();

export function on<K extends keyof TallyEvents>(event: K, fn: Handler<K>): () => void {
  let set = handlers.get(event);
  if (!set) handlers.set(event, (set = new Set()));
  set.add(fn);
  return () => set!.delete(fn);
}

export function emit<K extends keyof TallyEvents>(event: K, payload: TallyEvents[K]): void {
  const set = handlers.get(event);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(payload);
    } catch (err) {
      console.error(`[tally] listener for ${event} failed`, err);
    }
  }
}
