/** "Nice" axis ticks: 0, 50, 100… rounded to 1/2/2.5/5 × 10ⁿ. */
export function niceTicks(max: number, count = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  // Values are whole minor units, so a step below 1 would repeat ticks (0, 0, 1, 1…).
  const step = Math.max(1, [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag);
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Math.round(v));
  if (ticks[ticks.length - 1] < max) ticks.push(Math.round(ticks[ticks.length - 1] + step));
  return ticks;
}

/** Pick at most `n` evenly spaced indices for axis labels (never adjacent ones). */
export function sparseIndices(len: number, n: number): Set<number> {
  const out = new Set<number>();
  if (len <= n) {
    for (let i = 0; i < len; i++) out.add(i);
    return out;
  }
  const step = Math.ceil(len / Math.max(1, n));
  for (let i = 0; i < len; i += step) out.add(i);
  return out;
}
