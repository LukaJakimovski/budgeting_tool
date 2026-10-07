/** "Nice" axis ticks: 0, 50, 100… rounded to 1/2/2.5/5 × 10ⁿ. */
export function niceTicks(max: number, count = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Math.round(v));
  if (ticks[ticks.length - 1] < max) ticks.push(Math.round(ticks[ticks.length - 1] + step));
  return ticks;
}

/** Pick roughly `n` evenly spaced indices for axis labels. */
export function sparseIndices(len: number, n: number): Set<number> {
  const out = new Set<number>();
  if (len <= n) {
    for (let i = 0; i < len; i++) out.add(i);
    return out;
  }
  const step = (len - 1) / (n - 1);
  for (let i = 0; i < n; i++) out.add(Math.round(i * step));
  return out;
}
