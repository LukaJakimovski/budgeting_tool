/** Formatting helpers bound to the user's settings. */
import { repo } from '../db/repo.svelte';
import { formatMoney } from '../core/money';
import { formatDate, formatDayHeading, formatRange, formatShortDate, type DateRange } from '../core/dates';
import { categoryPath } from '../core/ledger';
import type { Category, ID, LocalDate, Minor, Transaction } from '../core/types';

export function money(amount: Minor, currency?: string, opts?: { compact?: boolean; sign?: boolean }): string {
  return formatMoney(amount, currency ?? repo.setting('baseCurrency'), opts);
}

export function date(d: LocalDate): string {
  return formatDate(d, repo.setting('dateFormat'));
}

export function shortDate(d: LocalDate): string {
  return formatShortDate(d, repo.setting('dateFormat'));
}

export function dayHeading(d: LocalDate): string {
  return formatDayHeading(d, repo.setting('dateFormat'));
}

export function range(r: DateRange): string {
  return formatRange(r, repo.setting('dateFormat'));
}

export function categoryLabel(id: ID | null | undefined): string {
  if (!id) return 'Uncategorised';
  const c = repo.get<Category>(id);
  return c ? c.name : 'Unknown category';
}

export function categoryIcon(id: ID | null | undefined): string {
  if (!id) return '•';
  const c = repo.get<Category>(id);
  if (!c) return '•';
  if (c.icon) return c.icon;
  const parent = c.parentId ? repo.get<Category>(c.parentId) : undefined;
  return parent?.icon || '•';
}

export function categoryFullPath(id: ID | null | undefined): string {
  return id ? categoryPath(id, repo.lookup().categories) : 'Uncategorised';
}

/** Title for a transaction row: "Name" or merchant name. */
export function txTitle(t: Transaction): string {
  const merchant = t.merchantId ? repo.get<{ name: string } & Transaction>(t.merchantId)?.name : '';
  return t.name || merchant || t.bankDescription || categoryLabel(t.categoryId);
}

export function merchantName(id: ID | null | undefined): string {
  if (!id) return '';
  return (repo.get(id) as { name?: string } | undefined)?.name ?? '';
}

export function pct(x: number): string {
  if (!Number.isFinite(x)) return '—';
  return `${Math.round(x * 100)}%`;
}

export function relativeTime(ms: number | null): string {
  if (!ms) return 'never';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
