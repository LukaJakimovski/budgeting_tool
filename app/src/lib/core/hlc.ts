/**
 * Hybrid logical clock.
 *
 * A revision looks like "0mfx1a2b3-0000-d7k2p9" =
 *   <wall-clock ms, base36, 9 chars>-<counter, base36, 4 chars>-<device id>
 * Plain string comparison orders revisions: later wall time wins, the counter
 * breaks ties within a millisecond (or when a device clock runs behind), and
 * the device id makes every revision unique.
 */

export const SEED_REV = '000000000-0000-seed';

export interface ParsedRev {
  ms: number;
  counter: number;
  device: string;
}

export function encodeRev(ms: number, counter: number, device: string): string {
  return `${ms.toString(36).padStart(9, '0')}-${counter.toString(36).padStart(4, '0')}-${device}`;
}

export function parseRev(rev: string): ParsedRev {
  const [ms, counter, ...rest] = rev.split('-');
  return { ms: parseInt(ms, 36) || 0, counter: parseInt(counter, 36) || 0, device: rest.join('-') };
}

export function revTime(rev: string): Date {
  return new Date(parseRev(rev).ms);
}

export class Clock {
  private ms = 0;
  private counter = 0;
  constructor(
    public device: string,
    private now: () => number = () => Date.now(),
  ) {}

  /** A new revision for a local change. */
  tick(): string {
    const now = this.now();
    if (now > this.ms) {
      this.ms = now;
      this.counter = 0;
    } else {
      this.counter++;
    }
    return encodeRev(this.ms, this.counter, this.device);
  }

  /** Advance past a revision seen from elsewhere so later local edits sort after it. */
  observe(rev: string): void {
    if (rev === SEED_REV) return;
    const r = parseRev(rev);
    if (r.ms > this.ms || (r.ms === this.ms && r.counter > this.counter)) {
      this.ms = r.ms;
      this.counter = r.counter;
    }
  }
}

/** True when `a` should replace `b` (last writer wins). */
export function newer(a: string, b: string | undefined): boolean {
  return b === undefined || a > b;
}
