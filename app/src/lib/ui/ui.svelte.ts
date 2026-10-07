/** Global UI state: the entry sheet, other sheets, and the app lock. */
import type { ID, TxKind } from '../core/types';

export interface EntryRequest {
  /** Edit an existing transaction. */
  id?: ID;
  /** Prefill for a new one (duplicate, quick-add from a merchant…). */
  prefill?: Partial<{ kind: TxKind; merchantId: ID; categoryId: ID; date: string; copyOf: ID }>;
}

class UIState {
  entry = $state<EntryRequest | null>(null);
  locked = $state(false);
  /** Dashboard edit mode. */
  editingDashboard = $state(false);
  /** A new app version is installed and waiting. */
  updateReady = $state(false);
  /** The user clicked "Reload" to switch to the new version. */
  updateRequested = false;

  openEntry(req: EntryRequest = {}): void {
    this.entry = req;
  }

  closeEntry(): void {
    this.entry = null;
  }
}

export const ui = new UIState();
