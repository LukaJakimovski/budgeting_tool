import type { Filter } from '../core/types';
import { isFilterEmpty } from '../core/ledger';

/** Filters travel in the URL as compact JSON so views are linkable and survive reloads. */
export function filterToQuery(f: Filter): string | undefined {
  if (isFilterEmpty(f)) return undefined;
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    clean[k] = v;
  }
  return JSON.stringify(clean);
}

export function filterFromQuery(s: string | null): Filter {
  if (!s) return {};
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? (v as Filter) : {};
  } catch {
    return {};
  }
}
