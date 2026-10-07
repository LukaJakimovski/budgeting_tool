/**
 * App lock (PIN). This is a privacy screen for a shared or lost phone: it
 * stops casual access to the UI. The data itself is protected by the device's
 * own storage encryption — see docs/security.md.
 */
import { repo } from './db/repo.svelte';
import { slowHash } from './sync/crypto';
import { randomHex } from './core/ids';

interface PinMeta {
  salt: string;
  hash: string;
  /** Minutes in the background before locking again (0 = immediately). */
  timeout: number;
}

class Lock {
  enabled = $state(false);
  locked = $state(false);
  timeout = $state(1);
  private meta: PinMeta | null = null;
  private hiddenAt = 0;

  async init(): Promise<void> {
    this.meta = (await repo.db.getMeta<PinMeta>('pin')) ?? null;
    this.enabled = !!this.meta;
    this.timeout = this.meta?.timeout ?? 1;
    this.locked = this.enabled;
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (!this.enabled) return;
        if (document.visibilityState === 'hidden') this.hiddenAt = Date.now();
        else if (this.hiddenAt && Date.now() - this.hiddenAt >= this.timeout * 60_000) this.locked = true;
      });
    }
  }

  async setPin(pin: string, timeout = this.timeout): Promise<void> {
    const salt = randomHex(16);
    this.meta = { salt, hash: await slowHash(pin, salt), timeout };
    await repo.db.setMeta('pin', this.meta);
    this.enabled = true;
    this.timeout = timeout;
  }

  async setTimeout(minutes: number): Promise<void> {
    if (!this.meta) return;
    this.meta = { ...this.meta, timeout: minutes };
    this.timeout = minutes;
    await repo.db.setMeta('pin', this.meta);
  }

  async check(pin: string): Promise<boolean> {
    if (!this.meta) return true;
    return (await slowHash(pin, this.meta.salt)) === this.meta.hash;
  }

  async unlock(pin: string): Promise<boolean> {
    const ok = await this.check(pin);
    if (ok) this.locked = false;
    return ok;
  }

  async remove(): Promise<void> {
    await repo.db.deleteMeta('pin');
    this.meta = null;
    this.enabled = false;
    this.locked = false;
  }

  lockNow(): void {
    if (this.enabled) this.locked = true;
  }
}

export const lock = new Lock();
