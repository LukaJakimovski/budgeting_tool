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
  /** Bumped when the user asks to install an app update. */
  updateReady = $state(false);

  openEntry(req: EntryRequest = {}): void {
    this.entry = req;
  }

  closeEntry(): void {
    this.entry = null;
  }
}

export const ui = new UIState();
